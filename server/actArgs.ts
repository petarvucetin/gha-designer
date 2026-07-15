import { parse } from 'yaml';
import type { RunRequest } from './types';

export const FILE_NAME_RE = /^[A-Za-z0-9._-]+\.(yml|yaml)$/;
const DEVICE_RE = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])\./i;

export function validateFileNames(workflows: { fileName: string; yaml?: string }[]): string | null {
  const seen = new Set<string>();
  for (const { fileName } of workflows) {
    if (DEVICE_RE.test(fileName)) return `"${fileName}" is a reserved Windows device name.`;
    if (!FILE_NAME_RE.test(fileName) || /[. ]\.(yml|yaml)$/.test(fileName)) {
      return `"${fileName}" is an invalid workflow file name.`;
    }
    const lower = fileName.toLowerCase();
    if (seen.has(lower)) return `Duplicate workflow file name "${fileName}".`;
    seen.add(lower);
  }
  return null;
}

export function ubuntuLabelsOf(workflows: { yaml: string }[]): string[] {
  const labels = new Set<string>();
  for (const { yaml } of workflows) {
    let doc: unknown;
    try { doc = parse(yaml); } catch { continue; }
    if (!doc || typeof doc !== 'object') continue;
    const jobs = (doc as Record<string, unknown>).jobs;
    if (!jobs || typeof jobs !== 'object') continue;
    for (const job of Object.values(jobs as Record<string, unknown>)) {
      if (!job || typeof job !== 'object') continue;
      const ro = (job as Record<string, unknown>)['runs-on'];
      const candidates = typeof ro === 'string'
        ? [ro]
        : Array.isArray(ro)
          ? ro
          : ro && typeof ro === 'object' && Array.isArray((ro as Record<string, unknown>).labels)
            ? (ro as { labels: unknown[] }).labels
            : [];
      for (const c of candidates) {
        if (typeof c === 'string' && c.startsWith('ubuntu-')) labels.add(c);
      }
    }
  }
  return [...labels];
}

export function buildActArgs(req: RunRequest): string[] {
  const args: string[] = [req.event, '-W', `.github/workflows/${req.target}`, '--json'];
  if (req.job) args.push('-j', req.job);
  for (const [k, v] of Object.entries(req.inputs ?? {})) args.push('--input', `${k}=${v}`);
  for (const [k, v] of Object.entries(req.vars ?? {})) args.push('--var', `${k}=${v}`);
  for (const name of Object.keys(req.secrets ?? {})) args.push('-s', name);
  args.push(`--pull=${req.pull}`);
  const labels = new Set(['ubuntu-latest', ...ubuntuLabelsOf(req.workflows)]);
  for (const label of labels) args.push('-P', `${label}=${req.image}`);
  if (req.engine === 'podman') args.push('--container-daemon-socket', '-');
  args.push('--artifact-server-path', '_artifacts');
  return args;
}

export function buildChildEnv(
  req: RunRequest,
  base: NodeJS.ProcessEnv,
  podmanSocket?: string,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  delete env.DOCKER_HOST;
  delete env.DOCKER_CONTEXT;
  delete env.CONTAINER_HOST;
  if (req.engine === 'podman' && podmanSocket) env.DOCKER_HOST = podmanSocket;
  const RESERVED = new Set(['DOCKER_HOST', 'DOCKER_CONTEXT', 'CONTAINER_HOST']);
  for (const [name, value] of Object.entries(req.secrets ?? {})) {
    if (RESERVED.has(name)) continue; // a secret must not reintroduce a stripped engine var
    env[name] = value;
  }
  return env;
}
