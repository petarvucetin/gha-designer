import type { Concurrency, Container, JobEnvironment, MatrixStrategy, Permissions, RunDefaults, RunsOn } from './types';

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const PERM_VALUES = ['read', 'write', 'none'];

export function parsePermissions(raw: unknown): Permissions | undefined {
  if (raw === 'read-all' || raw === 'write-all') return raw;
  if (!isRecord(raw)) return undefined;
  const out: Record<string, 'read' | 'write' | 'none'> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== 'string' || !PERM_VALUES.includes(v)) return undefined;
    out[k] = v as 'read' | 'write' | 'none';
  }
  return out;
}

export function permissionsToYaml(p: Permissions): unknown {
  return typeof p === 'string' ? p : { ...p };
}

export function parseConcurrency(raw: unknown): Concurrency | undefined {
  if (typeof raw === 'string') return { group: raw };
  if (!isRecord(raw) || typeof raw.group !== 'string') return undefined;
  const keys = Object.keys(raw);
  if (keys.some((k) => k !== 'group' && k !== 'cancel-in-progress')) return undefined;
  const c: Concurrency = { group: raw.group };
  const cip = raw['cancel-in-progress'];
  if (typeof cip === 'boolean' || typeof cip === 'string') c.cancelInProgress = cip;
  return c;
}

export function concurrencyToYaml(c: Concurrency): unknown {
  const out: Record<string, unknown> = { group: c.group };
  if (c.cancelInProgress !== undefined) out['cancel-in-progress'] = c.cancelInProgress;
  return out;
}

export function parseDefaults(raw: unknown): RunDefaults | undefined {
  if (!isRecord(raw)) return undefined;
  if (Object.keys(raw).some((k) => k !== 'run')) return undefined;
  const run = raw.run;
  if (!isRecord(run)) return undefined;
  if (Object.keys(run).some((k) => k !== 'shell' && k !== 'working-directory')) return undefined;
  const d: RunDefaults = {};
  if (typeof run.shell === 'string') d.shell = run.shell;
  if (typeof run['working-directory'] === 'string') d.workingDirectory = run['working-directory'] as string;
  return d;
}

export function defaultsToYaml(d: RunDefaults): unknown {
  const run: Record<string, unknown> = {};
  if (d.shell) run.shell = d.shell;
  if (d.workingDirectory) run['working-directory'] = d.workingDirectory;
  return { run };
}

export function parseRunsOn(raw: unknown): RunsOn | undefined {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && raw.every((x) => typeof x === 'string')) return raw as string[];
  if (isRecord(raw) && typeof raw.group === 'string'
      && Object.keys(raw).every((k) => k === 'group' || k === 'labels')) {
    const r: RunsOn = { group: raw.group };
    if (Array.isArray(raw.labels)) (r as { labels?: string[] }).labels = raw.labels.map(String);
    return r;
  }
  return undefined;
}

export function runsOnToYaml(r: RunsOn): unknown {
  if (typeof r === 'string' || Array.isArray(r)) return r;
  const out: Record<string, unknown> = { group: r.group };
  if (r.labels?.length) out.labels = r.labels;
  return out;
}

export function runsOnLabel(r: RunsOn): string {
  if (typeof r === 'string') return r;
  if (Array.isArray(r)) return r.join(', ');
  return `group:${r.group}`;
}

export function isRunsOnEmpty(r: RunsOn): boolean {
  if (typeof r === 'string') return !r.trim();
  if (Array.isArray(r)) return r.length === 0;
  return !r.group.trim();
}

export function parseEnvironment(raw: unknown): JobEnvironment | undefined {
  if (typeof raw === 'string') return raw;
  if (isRecord(raw) && typeof raw.name === 'string'
      && Object.keys(raw).every((k) => k === 'name' || k === 'url')) {
    const e: JobEnvironment = { name: raw.name };
    if (typeof raw.url === 'string') (e as { url?: string }).url = raw.url;
    return e;
  }
  return undefined;
}

export function environmentToYaml(e: JobEnvironment): unknown {
  if (typeof e === 'string') return e;
  const out: Record<string, unknown> = { name: e.name };
  if (e.url) out.url = e.url;
  return out;
}

const CONTAINER_KEYS = ['image', 'credentials', 'env', 'ports', 'volumes', 'options'];

export function parseContainer(raw: unknown): Container | undefined {
  if (typeof raw === 'string') return { image: raw };
  if (!isRecord(raw) || typeof raw.image !== 'string') return undefined;
  if (Object.keys(raw).some((k) => !CONTAINER_KEYS.includes(k))) return undefined;
  const c: Container = { image: raw.image };
  if (isRecord(raw.credentials)) {
    c.credentials = {};
    if (typeof raw.credentials.username === 'string') c.credentials.username = raw.credentials.username;
    if (typeof raw.credentials.password === 'string') c.credentials.password = raw.credentials.password;
  }
  if (isRecord(raw.env)) c.env = Object.fromEntries(Object.entries(raw.env).map(([k, v]) => [k, String(v)]));
  if (Array.isArray(raw.ports)) c.ports = raw.ports.map(String);
  if (Array.isArray(raw.volumes)) c.volumes = raw.volumes.map(String);
  if (typeof raw.options === 'string') c.options = raw.options;
  return c;
}

export function containerToYaml(c: Container): unknown {
  const onlyImage = !c.credentials && !c.env && !c.ports?.length && !c.volumes?.length && !c.options;
  if (onlyImage) return c.image;
  const out: Record<string, unknown> = { image: c.image };
  if (c.credentials) out.credentials = { ...c.credentials };
  if (c.env && Object.keys(c.env).length) out.env = c.env;
  if (c.ports?.length) out.ports = c.ports;
  if (c.volumes?.length) out.volumes = c.volumes;
  if (c.options) out.options = c.options;
  return out;
}

export function parseStrategy(raw: unknown): MatrixStrategy | undefined {
  if (!isRecord(raw)) return undefined;
  if (Object.keys(raw).some((k) => !['matrix', 'fail-fast', 'max-parallel'].includes(k))) return undefined;
  const s: MatrixStrategy = {};
  if (raw.matrix !== undefined) {
    if (!isRecord(raw.matrix)) return undefined; // expression form stays in extra
    const vars: Record<string, unknown[]> = {};
    let include: Record<string, unknown>[] | undefined;
    let exclude: Record<string, unknown>[] | undefined;
    for (const [k, v] of Object.entries(raw.matrix)) {
      if (k === 'include' || k === 'exclude') {
        if (!Array.isArray(v) || !v.every(isRecord)) return undefined;
        if (k === 'include') include = v as Record<string, unknown>[];
        else exclude = v as Record<string, unknown>[];
      } else if (Array.isArray(v)) {
        vars[k] = v;
      } else {
        return undefined;
      }
    }
    s.matrix = { vars };
    if (include) s.matrix.include = include;
    if (exclude) s.matrix.exclude = exclude;
  }
  if (raw['fail-fast'] !== undefined) {
    if (typeof raw['fail-fast'] !== 'boolean') return undefined; // expression/junk: whole strategy stays in extra
    s.failFast = raw['fail-fast'];
  }
  if (raw['max-parallel'] !== undefined) {
    if (typeof raw['max-parallel'] !== 'number') return undefined; // expression/junk: whole strategy stays in extra
    s.maxParallel = raw['max-parallel'];
  }
  return s;
}

export function strategyToYaml(s: MatrixStrategy): unknown {
  const out: Record<string, unknown> = {};
  if (s.matrix) {
    const m: Record<string, unknown> = { ...s.matrix.vars };
    if (s.matrix.include?.length) m.include = s.matrix.include;
    if (s.matrix.exclude?.length) m.exclude = s.matrix.exclude;
    out.matrix = m;
  }
  if (s.failFast !== undefined) out['fail-fast'] = s.failFast;
  if (s.maxParallel != null) out['max-parallel'] = s.maxParallel;
  return out;
}

export function coerceScalar(s: string): unknown {
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s.trim() !== '' && !Number.isNaN(Number(s)) && String(Number(s)) === s) return Number(s);
  return s;
}

export function uniqueName(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  let i = 2;
  while (set.has(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}
