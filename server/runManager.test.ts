import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRunManager } from './runManager';
import type { ExecFn, RunEvent, RunRequest } from './types';

const NODE = process.execPath;
const MOCK = join(__dirname, 'mock-act.mjs');
const FIXTURE = join(__dirname, 'fixtures', 'dryrun.jsonl');
const STUCK_FIXTURE = join(__dirname, 'fixtures', 'dryrun-stuck.jsonl');

const req = (over: Partial<RunRequest> = {}): RunRequest => ({
  workflows: [{ fileName: 'ci.yml', yaml: 'on: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ls' }],
  target: 'ci.yml', event: 'push', engine: 'docker',
  image: 'node:20-bookworm-slim', pull: false, ...over,
});

const collect = async (mgr: ReturnType<typeof createRunManager>, runId: string): Promise<RunEvent[]> => {
  const events: RunEvent[] = [];
  await new Promise<void>((resolve) => {
    mgr.subscribe(runId, (e) => {
      events.push(e);
      if (e.kind === 'phase' && e.status !== 'running') resolve();
    });
  });
  return events;
};

const swept: string[] = [];
const sweptEnvs: NodeJS.ProcessEnv[] = [];
const exec: ExecFn = async (cmd, args, env) => {
  swept.push(`${cmd} ${args.join(' ')}`);
  if (env) sweptEnvs.push(env);
  if (args.includes('ps')) return { code: 0, stdout: 'abc123\n', stderr: '' };
  return { code: 0, stdout: '', stderr: '' };
};

// The manager spawns `${actPath}` — pointing it at node + mock via actPath/actArgsPrefix.
const mkMgr = (env: Record<string, string> = {}) =>
  createRunManager({
    actPath: NODE,
    actPrefixArgs: [MOCK],
    exec,
    mockEnv: { MOCK_ACT_FIXTURE: FIXTURE, ...env },
  });

describe('runManager', () => {
  it('streams parsed events and finishes with the exit status', async () => {
    const mgr = mkMgr();
    const { runId } = await mgr.start(req());
    const events = await collect(mgr, runId);
    expect(events.some((e) => e.kind === 'status' && e.jobId === 'build' && e.status === 'success')).toBe(true);
    expect(events.at(-1)).toMatchObject({ kind: 'phase', status: 'success' });
    expect(mgr.get(runId)?.status).toBe('success');
  });

  it('replays the ring buffer to late subscribers', async () => {
    const mgr = mkMgr();
    const { runId } = await mgr.start(req());
    await collect(mgr, runId); // run to completion
    const replay: RunEvent[] = [];
    mgr.subscribe(runId, (e) => replay.push(e));
    await Promise.resolve(); // subscribe()'s replay is deferred to a microtask
    expect(replay.length).toBeGreaterThan(5);
    expect(replay.at(-1)?.kind).toBe('phase');
  });

  it('enforces single active run: 409 without cancelPrevious, cancel+start with it', async () => {
    const mgr = mkMgr({ MOCK_ACT_HOLD: '1' });
    const { runId: first } = await mgr.start(req());
    await expect(mgr.start(req())).rejects.toMatchObject({ code: 409, activeRunId: first });
    const { runId: second } = await mgr.start(req({ cancelPrevious: true }));
    expect(second).not.toBe(first);
    expect(mgr.get(first)?.status).toBe('cancelled');
    await mgr.cancel(second);
  });

  it('cancel kills the process and sweeps act containers via the engine exec', async () => {
    const mgr = mkMgr({ MOCK_ACT_HOLD: '1' });
    const { runId } = await mgr.start(req());
    swept.length = 0;
    await mgr.cancel(runId);
    expect(mgr.get(runId)?.status).toBe('cancelled');
    expect(swept.some((c) => c.includes('ps') && c.includes('name=^act-'))).toBe(true);
    expect(swept.some((c) => c.includes('rm -f abc123'))).toBe(true);
  });

  it('secret VALUES never reach the sweep exec env, only the name-stripped record env does', async () => {
    const mgr = mkMgr({ MOCK_ACT_HOLD: '1' });
    const { runId } = await mgr.start(req({ secrets: { TOKEN: 'supersecret' } }));
    swept.length = 0;
    sweptEnvs.length = 0;
    await mgr.cancel(runId);
    expect(mgr.get(runId)?.status).toBe('cancelled');
    expect(sweptEnvs.length).toBeGreaterThan(0);
    for (const env of sweptEnvs) {
      expect(env.TOKEN).toBeUndefined();
      expect(JSON.stringify(env)).not.toContain('supersecret');
    }
  });

  it('exit code != 0 -> failure phase; running jobs force-resolved', async () => {
    const mgr = mkMgr({ MOCK_ACT_EXIT: '1' });
    const { runId } = await mgr.start(req());
    const events = await collect(mgr, runId);
    expect(events.at(-1)).toMatchObject({ kind: 'phase', status: 'failure' });
  });

  it('cancel force-resolves a job still "running" when it gets cut off mid-job (fallback path)', async () => {
    // dryrun-stuck.jsonl only streams the "Set up job" lines for job `build` and never a
    // jobResult, so the parser's jobStates map has `build` pinned at 'running' when cancel
    // fires. This exercises the invariant regardless of whether the close handler or the
    // 150ms cancel() fallback wins the race to finish the run.
    const mgr = mkMgr({ MOCK_ACT_HOLD: '1', MOCK_ACT_FIXTURE: STUCK_FIXTURE });
    const { runId } = await mgr.start(req());
    await new Promise((r) => setTimeout(r, 30)); // let the two stuck-fixture lines stream in
    await mgr.cancel(runId);
    expect(mgr.get(runId)?.status).toBe('cancelled');

    const replay: RunEvent[] = [];
    mgr.subscribe(runId, (e) => replay.push(e));
    await Promise.resolve(); // subscribe()'s replay is deferred to a microtask
    const lastJobStatus = new Map<string, string>();
    for (const e of replay) {
      if (e.kind === 'status' && e.scope === 'job') lastJobStatus.set(e.jobId, e.status);
    }
    expect(lastJobStatus.size).toBeGreaterThan(0);
    for (const [jobId, status] of lastJobStatus) {
      expect(status, `job ${jobId} left at 'running' after cancel`).not.toBe('running');
    }
  });

  it('vm engine: syncs then runs act over ssh, streaming parsed events', async () => {
    const calls: string[][] = [];
    const exec = async (cmd: string, args: string[]) => { calls.push([cmd, ...args]); return { code: 0, stdout: '', stderr: '' }; };
    const mgr = createRunManager({
      actPath: 'unused', exec,
      ssh: process.execPath, scp: process.execPath,
      // mock-ssh reads the stdin bootstrap and prints an act --json job-success fixture
      vmConfig: { target: 'runner@h', keyPath: 'k', runScript: '/opt/vm/run/act-run.sh', remoteBase: '/home/runner' },
      actPrefixArgs: [join(__dirname, 'mock-ssh.mjs')], // reused as the ssh arg-prefix hook (see Step 3)
    } as any);
    const events: any[] = [];
    const { runId } = await mgr.start({
      workflows: [{ fileName: 'ci.yml', yaml: 'on: push\njobs:\n  b:\n    runs-on: ubuntu-latest\n    steps: [{run: echo hi}]' }],
      target: 'ci.yml', event: 'push', engine: 'vm', mode: 'self-hosted', image: 'x', pull: false,
    });
    await new Promise<void>((r) => { const u = mgr.subscribe(runId, (e) => { events.push(e); if (e.kind === 'phase' && e.status !== 'running') { u(); r(); } }); });
    expect(events.at(-1)).toMatchObject({ kind: 'phase', status: 'success' });
    expect(events.some((e) => e.kind === 'line' && String(e.msg).includes('hi'))).toBe(true);

    // finishRun (not cancel) owns vm remote workspace cleanup, so it fires on every terminal
    // transition including a plain successful completion — not just on cancel.
    const cleanupCall = calls.find((c) => c.some((a) => a.includes('rm -rf')));
    expect(cleanupCall).toBeDefined();
    expect(cleanupCall!.some((a) => a.includes('ws-'))).toBe(true);
  });
});
