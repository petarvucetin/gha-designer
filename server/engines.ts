import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import type { EngineInfo, EnginesReport, ExecFn } from './types';
import { buildSshBase, type VmConfig } from './vmTransport';

export type ResolveActOpts = {
  /** Directory to search for a co-located `act` binary (defaults to the running exe's dir). */
  exeDir?: string;
  /** Existence probe (injectable for tests; defaults to fs.existsSync). */
  fileExists?: (p: string) => boolean;
};

export async function resolveActBinary(
  exec: ExecFn,
  envOverride?: string,
  opts: ResolveActOpts = {},
): Promise<string | null> {
  if (envOverride) return envOverride; // required to be absolute by contract
  // 1) Prefer an `act` bundled next to our own executable (packaged Tauri app).
  const exeDir = opts.exeDir ?? dirname(process.execPath);
  const fileExists = opts.fileExists ?? existsSync;
  const bundledNames = process.platform === 'win32' ? ['act.exe'] : ['act'];
  for (const name of bundledNames) {
    const cand = join(exeDir, name);
    if (fileExists(cand)) return cand;
  }
  // 2) Fall back to a PATH lookup.
  const lookup = process.platform === 'win32' ? ['where', ['act']] as const : ['which', ['act']] as const;
  const res = await exec(lookup[0], [...lookup[1]]).catch(() => ({ code: 1, stdout: '', stderr: '' }));
  if (res.code !== 0) return null;
  const first = res.stdout.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
  return first ?? null;
}

async function detectAct(exec: ExecFn): Promise<EngineInfo & { path?: string }> {
  const path = await resolveActBinary(exec, process.env.ACT_BINARY);
  if (!path) return { available: false, hint: 'Install act: winget install nektos.act' };
  const v = await exec(path, ['--version']).catch(() => null);
  if (!v || v.code !== 0) return { available: false, hint: 'Install act: winget install nektos.act' };
  return { available: true, version: v.stdout.trim(), path };
}

async function detectDocker(exec: ExecFn): Promise<EngineInfo> {
  const res = await exec('docker', ['version', '--format', '{{.Server.Version}}']).catch(() => null);
  if (!res || res.code !== 0) {
    return { available: false, hint: 'Start Docker Desktop (or install docker).' };
  }
  return { available: true, version: res.stdout.trim() };
}

type MachineInspect = {
  State?: string;
  ConnectionInfo?: { PodmanPipe?: { Path?: string }; PodmanSocket?: { Path?: string } };
};

async function detectPodman(exec: ExecFn, platform: NodeJS.Platform): Promise<EngineInfo & { socket?: string }> {
  const version = await exec('podman', ['--version']).catch(() => null);
  if (!version || version.code !== 0) {
    return { available: false, hint: 'Install podman (podman.io) to use it as an engine.' };
  }
  const ver = version.stdout.trim();
  // IMPORTANT: never `machine inspect --format json` — podman 5.x prints the literal string "json".
  const inspect = await exec('podman', ['machine', 'inspect']).catch(() => null);
  if (inspect && inspect.code === 0) {
    try {
      const arr = JSON.parse(inspect.stdout) as MachineInspect[];
      const m = arr[0];
      if (!m || m.State !== 'running') {
        return { available: false, version: ver, hint: 'Run: podman machine start' };
      }
      const pipe = m.ConnectionInfo?.PodmanPipe?.Path;
      if (platform === 'win32' && pipe) {
        const name = pipe.split('\\').filter(Boolean).pop() as string;
        return { available: true, version: ver, socket: `npipe:////./pipe/${name}` };
      }
      const sock = m.ConnectionInfo?.PodmanSocket?.Path;
      if (sock) return { available: true, version: ver, socket: `unix://${sock}` };
    } catch {
      /* fall through to info fallback */
    }
  } else if (platform === 'win32') {
    return { available: false, version: ver, hint: 'Run: podman machine init && podman machine start' };
  }
  if (platform !== 'win32') {
    const info = await exec('podman', ['info', '--format', 'json']).catch(() => null);
    if (info && info.code === 0) {
      try {
        const parsed = JSON.parse(info.stdout) as { host?: { remoteSocket?: { path?: string } } };
        const p = parsed.host?.remoteSocket?.path;
        if (p) return { available: true, version: ver, socket: p.startsWith('unix://') ? p : `unix://${p}` };
      } catch { /* ignore */ }
    }
  }
  return { available: false, version: ver, hint: 'Could not resolve the podman socket.' };
}

export async function detectVm(exec: ExecFn, cfg: VmConfig | null): Promise<EngineInfo> {
  if (!cfg) return { available: false, hint: 'Set VM_SSH_TARGET and VM_SSH_KEY to enable the VM engine.' };
  const res = await exec('ssh', [...buildSshBase(cfg), 'act --version']).catch(() => null);
  if (!res || res.code !== 0) {
    return { available: false, hint: `VM unreachable at ${cfg.target} (check the VM is up and the key is authorized).` };
  }
  return { available: true, version: res.stdout.trim() };
}

export async function detectEngines(exec: ExecFn, platform: NodeJS.Platform = process.platform, vmCfg: VmConfig | null = null): Promise<EnginesReport> {
  const [act, docker, podman, vm] = await Promise.all([
    detectAct(exec), detectDocker(exec), detectPodman(exec, platform), detectVm(exec, vmCfg),
  ]);
  return { act, docker, podman, vm };
}

export function createEngineCache(detect: () => Promise<EnginesReport>, ttlMs = 10_000) {
  let cached: { at: number; value: EnginesReport } | null = null;
  return {
    async get(): Promise<EnginesReport> {
      if (cached && Date.now() - cached.at < ttlMs) return cached.value;
      const value = await detect();
      cached = { at: Date.now(), value };
      return value;
    },
  };
}
