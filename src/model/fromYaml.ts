import { parse } from 'yaml';
import type {
  Container, GraphEdge, GraphNode, GraphSnapshot, JobData, Step, TriggerData, WorkflowInput, WorkflowOutput, WorkflowSecret,
} from './types';
import { freshId } from './types';
import { isRecord, parsePermissions, parseConcurrency, parseDefaults, parseRunsOn, parseEnvironment, parseContainer, parseStrategy } from './mapping';

const FILTER_IMPORT: [string, 'branches' | 'branchesIgnore' | 'paths' | 'pathsIgnore' | 'tags' | 'tagsIgnore'][] = [
  ['branches', 'branches'],
  ['branches-ignore', 'branchesIgnore'],
  ['tags', 'tags'],
  ['tags-ignore', 'tagsIgnore'],
  ['paths', 'paths'],
  ['paths-ignore', 'pathsIgnore'],
];
function rest(obj: Record<string, unknown>, known: readonly string[]): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!known.includes(k)) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

const INPUT_TYPES = ['string', 'number', 'boolean', 'choice', 'environment'];

function parseInputs(raw: unknown): WorkflowInput[] | undefined {
  if (!isRecord(raw)) return undefined;
  const list: WorkflowInput[] = [];
  for (const [id, cfg] of Object.entries(raw)) {
    const i: WorkflowInput = { id };
    if (isRecord(cfg)) {
      if (typeof cfg.description === 'string') i.description = cfg.description;
      if (typeof cfg.required === 'boolean') i.required = cfg.required;
      if (typeof cfg.type === 'string' && INPUT_TYPES.includes(cfg.type)) i.type = cfg.type as WorkflowInput['type'];
      if (cfg.default !== undefined) i.default = cfg.default;
      if (Array.isArray(cfg.options)) i.options = cfg.options.map(String);
    }
    list.push(i);
  }
  return list.length ? list : undefined;
}

function parseCallOutputs(raw: unknown): WorkflowOutput[] | undefined {
  if (!isRecord(raw)) return undefined;
  const list: WorkflowOutput[] = [];
  for (const [id, cfg] of Object.entries(raw)) {
    const o: WorkflowOutput = { id };
    if (isRecord(cfg)) {
      if (typeof cfg.description === 'string') o.description = cfg.description;
      if (typeof cfg.value === 'string') o.value = cfg.value;
    }
    list.push(o);
  }
  return list.length ? list : undefined;
}

function parseSecretsDecl(raw: unknown): WorkflowSecret[] | undefined {
  if (!isRecord(raw)) return undefined;
  const list: WorkflowSecret[] = [];
  for (const [id, cfg] of Object.entries(raw)) {
    const s: WorkflowSecret = { id };
    if (isRecord(cfg)) {
      if (typeof cfg.description === 'string') s.description = cfg.description;
      if (typeof cfg.required === 'boolean') s.required = cfg.required;
    }
    list.push(s);
  }
  return list.length ? list : undefined;
}

function parseTriggerNodes(on: unknown): GraphNode[] {
  const nodes: GraphNode[] = [];
  const add = (trigger: string, cfg: unknown) => {
    if (trigger === 'schedule' && Array.isArray(cfg)) {
      cfg.forEach((entry, i) => {
        const cron = isRecord(entry) && typeof entry.cron === 'string' ? entry.cron : undefined;
        const data: TriggerData = { kind: 'trigger', trigger: 'schedule', cron };
        if (isRecord(entry)) {
          if (typeof entry.timezone === 'string') data.timezone = entry.timezone;
          const ex = rest(entry, ['cron', 'timezone']);
          if (ex) data.extra = ex;
        }
        nodes.push({
          id: i === 0 ? 'trigger:schedule' : `trigger:schedule:${i}`,
          type: 'trigger', position: { x: 0, y: 0 }, data,
        });
      });
      return;
    }
    const data: TriggerData = { kind: 'trigger', trigger };
    if (isRecord(cfg)) {
      const consumed: string[] = [];
      for (const [key, field] of FILTER_IMPORT) {
        if (Array.isArray(cfg[key])) { data[field] = cfg[key] as string[]; consumed.push(key); }
      }
      if (Array.isArray(cfg.types)) { data.types = cfg.types as string[]; consumed.push('types'); }
      if (trigger === 'workflow_run' && Array.isArray(cfg.workflows)) {
        data.workflows = cfg.workflows.map(String);
        consumed.push('workflows');
      }
      if (trigger === 'workflow_dispatch' || trigger === 'workflow_call') {
        const inputs = parseInputs(cfg.inputs);
        if (inputs) { data.inputs = inputs; consumed.push('inputs'); }
      }
      if (trigger === 'workflow_call') {
        const outputs = parseCallOutputs(cfg.outputs);
        if (outputs) { data.outputs = outputs; consumed.push('outputs'); }
        const secrets = parseSecretsDecl(cfg.secrets);
        if (secrets) { data.secretsDecl = secrets; consumed.push('secrets'); }
      }
      const ex = rest(cfg, consumed);
      if (ex) data.extra = ex;
    }
    nodes.push({ id: `trigger:${trigger}`, type: 'trigger', position: { x: 0, y: 0 }, data });
  };

  if (typeof on === 'string') add(on, undefined);
  else if (Array.isArray(on)) on.forEach((t) => typeof t === 'string' && add(t, undefined));
  else if (isRecord(on)) Object.entries(on).forEach(([t, cfg]) => add(t, cfg));
  return nodes;
}

function parseStep(raw: unknown): Step {
  const s: Step = { id: freshId('step') };
  if (!isRecord(raw)) return s;
  const consumed: string[] = [];
  if (typeof raw.id === 'string') { s.stepId = raw.id; consumed.push('id'); }
  if (typeof raw.name === 'string') { s.name = raw.name; consumed.push('name'); }
  if (typeof raw.uses === 'string') { s.uses = raw.uses; consumed.push('uses'); }
  if (typeof raw.run === 'string') { s.run = raw.run; consumed.push('run'); }
  if (typeof raw.if === 'string') { s.if = raw.if; consumed.push('if'); }
  if (typeof raw.shell === 'string') { s.shell = raw.shell; consumed.push('shell'); }
  if (typeof raw['working-directory'] === 'string') {
    s.workingDirectory = raw['working-directory'] as string;
    consumed.push('working-directory');
  }
  if (isRecord(raw.with)) {
    s.with = Object.fromEntries(Object.entries(raw.with).map(([k, v]) => [k, String(v)]));
    consumed.push('with');
  }
  if (isRecord(raw.env)) {
    s.env = Object.fromEntries(Object.entries(raw.env).map(([k, v]) => [k, String(v)]));
    consumed.push('env');
  }
  if (typeof raw['continue-on-error'] === 'boolean' || typeof raw['continue-on-error'] === 'string') {
    s.continueOnError = raw['continue-on-error'] as boolean | string;
    consumed.push('continue-on-error');
  }
  if (typeof raw['timeout-minutes'] === 'number') {
    s.timeoutMinutes = raw['timeout-minutes'] as number;
    consumed.push('timeout-minutes');
  }
  const ex = rest(raw, consumed);
  if (ex) s.extra = ex;
  return s;
}

export function fromYaml(yamlText: string): GraphSnapshot {
  let doc: unknown;
  try {
    doc = parse(yamlText);
  } catch (err) {
    throw new Error(`Invalid YAML: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!isRecord(doc)) throw new Error('Not a workflow file: expected a YAML mapping at the top level.');

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  nodes.push(...parseTriggerNodes(doc.on));

  const jobsRaw = isRecord(doc.jobs) ? doc.jobs : {};
  const needsByJob = new Map<string, string[]>();

  for (const [jobId, rawJob] of Object.entries(jobsRaw)) {
    if (!isRecord(rawJob)) continue;
    const consumed = ['needs', 'steps'];
    const steps = Array.isArray(rawJob.steps) ? rawJob.steps.map(parseStep) : [];
    const ro = parseRunsOn(rawJob['runs-on']);
    const data: JobData = { kind: 'job', jobId, runsOn: ro ?? '', steps };
    if (ro !== undefined) consumed.push('runs-on'); // unparseable: leave raw in extra
    if (typeof rawJob.name === 'string') { data.name = rawJob.name; consumed.push('name'); }
    if (typeof rawJob.if === 'string') { data.if = rawJob.if; consumed.push('if'); }
    if (typeof rawJob['timeout-minutes'] === 'number') {
      data.timeoutMinutes = rawJob['timeout-minutes'] as number;
      consumed.push('timeout-minutes');
    }
    if (isRecord(rawJob.env)) {
      data.env = Object.fromEntries(Object.entries(rawJob.env).map(([k, v]) => [k, String(v)]));
      consumed.push('env');
    }
    if (rawJob.permissions !== undefined) {
      const p = parsePermissions(rawJob.permissions);
      if (p !== undefined) { data.permissions = p; consumed.push('permissions'); }
    }
    if (rawJob.environment !== undefined) {
      const e = parseEnvironment(rawJob.environment);
      if (e !== undefined) { data.environment = e; consumed.push('environment'); }
    }
    if (rawJob.concurrency !== undefined) {
      const c = parseConcurrency(rawJob.concurrency);
      if (c) { data.concurrency = c; consumed.push('concurrency'); }
    }
    if (isRecord(rawJob.outputs)) {
      data.outputs = Object.fromEntries(Object.entries(rawJob.outputs).map(([k, v]) => [k, String(v)]));
      consumed.push('outputs');
    }
    if (typeof rawJob['continue-on-error'] === 'boolean' || typeof rawJob['continue-on-error'] === 'string') {
      data.continueOnError = rawJob['continue-on-error'] as boolean | string;
      consumed.push('continue-on-error');
    }
    if (rawJob.defaults !== undefined) {
      const d = parseDefaults(rawJob.defaults);
      if (d) { data.defaults = d; consumed.push('defaults'); }
    }
    if (typeof rawJob.uses === 'string') {
      data.uses = rawJob.uses;
      consumed.push('uses');
      if (isRecord(rawJob.with)) { data.with = { ...rawJob.with }; consumed.push('with'); }
      if (rawJob.secrets === 'inherit') { data.secrets = 'inherit'; consumed.push('secrets'); }
      else if (isRecord(rawJob.secrets)) {
        data.secrets = Object.fromEntries(Object.entries(rawJob.secrets).map(([k, v]) => [k, String(v)]));
        consumed.push('secrets');
      }
    }
    if (rawJob.strategy !== undefined) {
      const st = parseStrategy(rawJob.strategy);
      if (st) { data.strategy = st; consumed.push('strategy'); }
    }
    if (rawJob.container !== undefined) {
      const c = parseContainer(rawJob.container);
      if (c) { data.container = c; consumed.push('container'); }
    }
    if (isRecord(rawJob.services)) {
      const services: Record<string, Container> = {};
      let ok = true;
      for (const [k, v] of Object.entries(rawJob.services)) {
        const c = parseContainer(v);
        if (!c) { ok = false; break; }
        services[k] = c;
      }
      if (ok && Object.keys(services).length) { data.services = services; consumed.push('services'); }
    }
    const ex = rest(rawJob, consumed);
    if (ex) data.extra = ex;
    nodes.push({ id: `job:${jobId}`, type: 'job', position: { x: 0, y: 0 }, data });

    const needs = rawJob.needs;
    const needsListRaw = typeof needs === 'string' ? [needs] : Array.isArray(needs) ? needs.filter((n): n is string => typeof n === 'string') : [];
    const needsList = [...new Set(needsListRaw)];
    needsByJob.set(jobId, needsList);
  }

  for (const [jobId, needsList] of needsByJob) {
    for (const dep of needsList) {
      if (jobsRaw[dep] !== undefined) {
        edges.push({ id: `needs:${dep}->${jobId}`, source: `job:${dep}`, target: `job:${jobId}` });
      }
    }
  }

  // Visual edges: every trigger points at every entry job (no needs).
  const triggerIds = nodes.filter((n) => n.type === 'trigger').map((n) => n.id);
  for (const [jobId, needsList] of needsByJob) {
    if (needsList.length) continue;
    for (const tid of triggerIds) {
      edges.push({ id: `vis:${tid}->${jobId}`, source: tid, target: `job:${jobId}` });
    }
  }

  const meta: GraphSnapshot['meta'] = {
    name: typeof doc.name === 'string' ? doc.name : 'workflow',
  };
  const consumedTop = ['name', 'on', 'jobs'];
  if (typeof doc['run-name'] === 'string') {
    meta.runName = doc['run-name'] as string;
    consumedTop.push('run-name');
  }
  if (doc.permissions !== undefined) {
    const p = parsePermissions(doc.permissions);
    if (p !== undefined) { meta.permissions = p; consumedTop.push('permissions'); }
  }
  if (isRecord(doc.env)) {
    meta.env = Object.fromEntries(Object.entries(doc.env).map(([k, v]) => [k, String(v)]));
    consumedTop.push('env');
  }
  if (doc.concurrency !== undefined) {
    const c = parseConcurrency(doc.concurrency);
    if (c) { meta.concurrency = c; consumedTop.push('concurrency'); }
  }
  if (doc.defaults !== undefined) {
    const d = parseDefaults(doc.defaults);
    if (d) { meta.defaults = d; consumedTop.push('defaults'); }
  }
  const ex = rest(doc, consumedTop);
  if (ex) meta.extra = ex;

  return { meta, nodes, edges };
}
