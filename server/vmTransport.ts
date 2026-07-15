import type { RunRequest } from './types';
import { ubuntuLabelsOf } from './actArgs';

export type VmConfig = { target: string; keyPath: string; runScript: string; remoteBase: string };

export function loadVmConfig(env: NodeJS.ProcessEnv): VmConfig | null {
  const target = env.VM_SSH_TARGET;
  const keyPath = env.VM_SSH_KEY;
  if (!target || !keyPath) return null;
  return {
    target,
    keyPath,
    runScript: env.VM_RUN_SCRIPT ?? '/opt/vm/run/act-run.sh',
    remoteBase: env.VM_REMOTE_BASE ?? '/home/runner',
  };
}

export function buildSshBase(cfg: VmConfig): string[] {
  return ['-i', cfg.keyPath, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=10', cfg.target];
}

export function remoteWorkspace(cfg: VmConfig, runId: string): string {
  return `${cfg.remoteBase}/ws-${runId}`;
}

// Copy the local workspace dir's *contents* into remoteWs (scp -r . target:remoteWs, run with
// cwd=localDir). Using '.' as the source — rather than embedding the absolute localDir path —
// avoids scp on Windows misparsing a `C:\...` path's drive letter as a `host:` prefix.
export function buildScpArgs(cfg: VmConfig, remoteWs: string): string[] {
  return ['-r', '-i', cfg.keyPath, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '.', `${cfg.target}:${remoteWs}`];
}

// POSIX single-quote escaping: wrap in single quotes, replace ' with '\''.
function sq(v: string): string {
  return `'${v.replace(/'/g, "'\\''")}'`;
}

// The bootstrap script piped to `ssh … bash -s` stdin. Contains secret VALUES — this
// string is spawn-only (built in the runManager closure) and must never be stored.
export function buildRemoteScript(req: RunRequest, remoteWs: string, runScript: string): string {
  for (const k of Object.keys(req.secrets ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) throw new Error(`Invalid secret name for VM run: ${JSON.stringify(k)}`);
  }
  const names = Object.keys(req.secrets ?? {});
  const lines = ['set -euo pipefail'];
  if (names.length) lines.push(`export ACT_SECRETS=${sq(names.join(' '))}`);
  for (const [k, v] of Object.entries(req.secrets ?? {})) lines.push(`export ${k}=${sq(v)}`);
  const mode = req.mode ?? 'container';
  const parts = [
    `exec bash ${runScript}`, `--workspace ${sq(remoteWs)}`, `--mode ${mode}`,
    `--workflow ${sq(`.github/workflows/${req.target}`)}`,
    `--event-name ${sq(req.event)}`, `--pull ${req.pull ? 'true' : 'false'}`,
  ];
  if (mode === 'container') parts.push(`--image ${sq(req.image)}`);
  parts.push(`--artifact-path ${sq(`${remoteWs}/_artifacts`)}`);
  if (req.job) parts.push(`--job ${sq(req.job)}`);
  for (const [k, v] of Object.entries(req.inputs ?? {})) parts.push(`--input ${sq(`${k}=${v}`)}`);
  for (const [k, v] of Object.entries(req.vars ?? {})) parts.push(`--var ${sq(`${k}=${v}`)}`);
  const labels = new Set(['ubuntu-latest', ...ubuntuLabelsOf(req.workflows)]);
  for (const label of labels) parts.push(`--label ${sq(label)}`);
  lines.push(parts.join(' '));
  return lines.join('\n') + '\n';
}

export function buildRemoteCleanup(remoteWs: string): string {
  return `rm -rf ${sq(remoteWs)}`;
}
