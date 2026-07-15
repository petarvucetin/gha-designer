import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { detectVm, detectEngines, resolveActBinary } from './engines';
import type { ExecFn } from './types';

const PODMAN_INSPECT = JSON.stringify([{
  Name: 'podman-machine-default',
  State: 'running',
  ConnectionInfo: { PodmanPipe: { Path: '\\\\.\\pipe\\podman-machine-default' }, PodmanSocket: { Path: '/run/user/1000/podman/podman.sock' } },
}]);

const mkExec = (table: Record<string, { code: number; stdout: string; stderr?: string }>): ExecFn =>
  async (cmd, args) => {
    const key = `${cmd} ${args.join(' ')}`;
    const hit = Object.entries(table).find(([k]) => key.startsWith(k));
    return hit ? { code: hit[1].code, stdout: hit[1].stdout, stderr: hit[1].stderr ?? '' } : { code: 1, stdout: '', stderr: 'not found' };
  };

describe('detectEngines', () => {
  it('reports all three available with podman npipe socket (Windows shapes)', async () => {
    const exec = mkExec({
      'where act': { code: 0, stdout: 'C:\\Users\\x\\act.exe\r\n' },
      'C:\\Users\\x\\act.exe --version': { code: 0, stdout: 'act version 0.2.89' },
      'docker version': { code: 0, stdout: '29.4.1' },
      'podman --version': { code: 0, stdout: 'podman version 5.8.2' },
      'podman machine inspect': { code: 0, stdout: PODMAN_INSPECT },
    });
    const r = await detectEngines(exec, 'win32');
    expect(r.act.available).toBe(true);
    expect(r.act.version).toContain('0.2.89');
    expect(r.docker).toMatchObject({ available: true, version: '29.4.1' });
    expect(r.podman.available).toBe(true);
    expect(r.podman.socket).toBe('npipe:////./pipe/podman-machine-default');
  });

  it('literal-"json" regression: never parses machine inspect with --format json', async () => {
    const exec: ExecFn = async (cmd, args) => {
      if (cmd === 'podman' && args.join(' ').includes('--format')) {
        throw new Error('test: --format must not be used with machine inspect');
      }
      if (cmd === 'podman' && args[0] === 'machine') return { code: 0, stdout: PODMAN_INSPECT, stderr: '' };
      if (cmd === 'podman') return { code: 0, stdout: 'podman version 5.8.2', stderr: '' };
      return { code: 1, stdout: '', stderr: '' };
    };
    const r = await detectEngines(exec, 'win32');
    expect(r.podman.available).toBe(true);
  });

  it('stopped machine -> unavailable with start hint; no machine -> init hint', async () => {
    const stopped = JSON.stringify([{ State: 'stopped', ConnectionInfo: { PodmanPipe: { Path: '\\\\.\\pipe\\p' } } }]);
    const r1 = await detectEngines(mkExec({
      'podman --version': { code: 0, stdout: 'podman version 5.8.2' },
      'podman machine inspect': { code: 0, stdout: stopped },
    }), 'win32');
    expect(r1.podman.available).toBe(false);
    expect(r1.podman.hint).toMatch(/podman machine start/);
    const r2 = await detectEngines(mkExec({
      'podman --version': { code: 0, stdout: 'podman version 5.8.2' },
      'podman machine inspect': { code: 1, stdout: '', stderr: 'no machine' },
    }), 'win32');
    expect(r2.podman.hint).toMatch(/podman machine init/);
  });

  it('docker down and act missing degrade with hints', async () => {
    const r = await detectEngines(mkExec({}), 'win32');
    expect(r.act.available).toBe(false);
    expect(r.act.hint).toMatch(/winget install nektos.act/);
    expect(r.docker.available).toBe(false);
  });

  it('linux uses podman info remoteSocket fallback', async () => {
    const r = await detectEngines(mkExec({
      'podman --version': { code: 0, stdout: 'podman version 5.0.0' },
      'podman machine inspect': { code: 1, stdout: '', stderr: 'no machine' },
      'podman info': { code: 0, stdout: JSON.stringify({ host: { remoteSocket: { path: '/run/user/1000/podman/podman.sock', exists: true } } }) },
    }), 'linux');
    expect(r.podman.available).toBe(true);
    expect(r.podman.socket).toBe('unix:///run/user/1000/podman/podman.sock');
  });
});

describe('resolveActBinary', () => {
  it('prefers an absolute ACT_BINARY override', async () => {
    expect(await resolveActBinary(mkExec({}), 'C:\\tools\\mock-act.cmd')).toBe('C:\\tools\\mock-act.cmd');
  });
  it('falls back to where/which lookup', async () => {
    const p = await resolveActBinary(mkExec({ 'where act': { code: 0, stdout: 'C:\\a\\act.exe\r\nC:\\b\\act.exe' } }));
    expect(p).toBe('C:\\a\\act.exe');
  });
});

describe('resolveActBinary next-to-exe', () => {
  const exeDir = dirname(process.execPath);

  it('returns the co-located act.exe when it exists, without calling where/which', async () => {
    const exec: ExecFn = async () => {
      throw new Error('exec must not be called when a bundled act is found');
    };
    const fileExists = (p: string) => p === join(exeDir, 'act.exe');
    const p = await resolveActBinary(exec, undefined, { exeDir, fileExists });
    expect(p).toBe(join(exeDir, 'act.exe'));
  });

  it('falls through to the where/which lookup when no co-located file exists', async () => {
    const exec = mkExec({ 'where act': { code: 0, stdout: 'C:\\a\\act.exe\r\nC:\\b\\act.exe' } });
    const fileExists = () => false;
    const p = await resolveActBinary(exec, undefined, { exeDir, fileExists });
    expect(p).toBe('C:\\a\\act.exe');
  });

  it('ACT_BINARY override still wins and short-circuits before the fs probe', async () => {
    const exec: ExecFn = async () => {
      throw new Error('exec must not be called when ACT_BINARY is set');
    };
    const fileExists = () => {
      throw new Error('fileExists must not be called when ACT_BINARY is set');
    };
    const p = await resolveActBinary(exec, 'C:\\tools\\mock-act.cmd', { exeDir, fileExists });
    expect(p).toBe('C:\\tools\\mock-act.cmd');
  });
});

describe('detectVm', () => {
  const cfg = { target: 'runner@h', keyPath: 'k', runScript: '/opt/vm/run/act-run.sh', remoteBase: '/home/runner' };
  it('unavailable when not configured', async () => {
    const exec: ExecFn = async () => ({ code: 0, stdout: '', stderr: '' });
    expect((await detectVm(exec, null)).available).toBe(false);
  });
  it('available with version when ssh reaches act', async () => {
    const exec: ExecFn = async (cmd, args) => {
      expect(cmd).toBe('ssh');
      expect(args).not.toContain('k'.repeat(999)); // sanity: no secret
      return { code: 0, stdout: 'act version 0.2.89', stderr: '' };
    };
    const r = await detectVm(exec, cfg);
    expect(r).toEqual({ available: true, version: 'act version 0.2.89' });
  });
  it('unavailable with hint when ssh fails', async () => {
    const exec: ExecFn = async () => ({ code: 255, stdout: '', stderr: 'timeout' });
    const r = await detectVm(exec, cfg);
    expect(r.available).toBe(false);
    expect(r.hint).toBeTruthy();
  });
});
