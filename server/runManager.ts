import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { createInterface } from 'node:readline';
import { buildActArgs, buildChildEnv } from './actArgs';
import { createParser } from './logParser';
import type { ExecFn, RunEvent, RunRequest, RunSummary } from './types';
import { buildRemoteCleanup, buildRemoteScript, buildScpArgs, buildSshBase, remoteWorkspace } from './vmTransport';
import { cleanupWorkspace, writeWorkspace } from './workspace';

const MAX_EVENTS = 5000;
const MAX_BYTES = 16 * 1024 * 1024;
const KEEP_RUNS = 20;

type RunRecord = {
  summary: RunSummary;
  events: RunEvent[];
  bytes: number;
  subscribers: Set<(e: RunEvent) => void>;
  proc?: import('node:child_process').ChildProcess;
  parser?: ReturnType<typeof createParser>;
  engineEnv: NodeJS.ProcessEnv;
  cancelled: boolean;
  remoteWs?: string;
};

export type RunManagerDeps = {
  actPath: string;
  actPrefixArgs?: string[];          // test hook: [mock-act.mjs]
  exec: ExecFn;                       // used for taskkill + container sweep
  podmanSocket?: () => Promise<string | undefined>;
  mockEnv?: Record<string, string>;   // test hook merged into child env
  ssh?: string;                       // default 'ssh'
  scp?: string;                       // default 'scp'
  vmConfig?: import('./vmTransport').VmConfig;
};

export function createRunManager(deps: RunManagerDeps) {
  const runs = new Map<string, RunRecord>();
  let activeId: string | null = null;

  const emit = (rec: RunRecord, e: RunEvent): void => {
    rec.events.push(e);
    // +16 padding: events can be mutated in place after being counted (e.g. the parser's
    // repeat-collapsing bumps `repeat` on an already-pushed 'line' event), so the length
    // recorded at push time can undercount what's actually dropped later. Over-counting
    // at push keeps `bytes` a conservative (safe) upper bound instead of drifting low and
    // letting the buffer grow past MAX_BYTES unnoticed.
    rec.bytes += JSON.stringify(e).length + 16;
    while (rec.events.length > MAX_EVENTS || rec.bytes > MAX_BYTES) {
      const dropped = rec.events.shift();
      if (!dropped) break;
      rec.bytes = Math.max(0, rec.bytes - JSON.stringify(dropped).length);
    }
    for (const sub of rec.subscribers) sub(e);
  };

  const evictOld = (): void => {
    const finished = [...runs.values()].filter((r) => r.summary.status !== 'running');
    while (runs.size > KEEP_RUNS && finished.length) {
      const oldest = finished.shift();
      if (!oldest) break;
      runs.delete(oldest.summary.id);
      void cleanupWorkspace(oldest.summary.id);
    }
  };

  // Single terminal-transition path: both the process 'close' handler and cancel()'s
  // 150ms fallback route through here, so a job that never got a terminal status line
  // (act killed mid-job, close event lagging) is still force-resolved via parser.finish()
  // instead of being left stuck at 'running' in the ring buffer forever.
  const finishRun = (rec: RunRecord, status: RunSummary['status'], exitCode?: number): void => {
    if (rec.summary.status !== 'running') return; // already finished via the other path
    for (const e of rec.parser?.finish(status === 'success' ? 'success' : status === 'cancelled' ? 'cancelled' : 'failure') ?? []) {
      emit(rec, e);
    }
    rec.summary.status = status;
    rec.summary.finishedAt = Date.now();
    emit(rec, { kind: 'phase', status, exitCode });
    if (activeId === rec.summary.id) activeId = null;
    // Remote workspace cleanup runs on every terminal transition (success/failure/cancelled/
    // error) rather than only in cancel(), since spec §6 requires the temp dir cleaned on
    // completion, not just on cancellation. Fire-and-forget — best-effort, doesn't block or
    // fail the run.
    if (rec.summary.engine === 'vm' && deps.vmConfig && rec.remoteWs) {
      void deps.exec(deps.ssh ?? 'ssh', [...buildSshBase(deps.vmConfig), buildRemoteCleanup(rec.remoteWs)]).catch(() => undefined);
    }
    evictOld();
  };

  const start = async (req: RunRequest): Promise<{ runId: string }> => {
    if (activeId && runs.get(activeId)?.summary.status === 'running') {
      if (!req.cancelPrevious) {
        const err = { code: 409 as const, activeRunId: activeId };
        throw err;
      }
      await cancel(activeId);
    }
    const runId = randomUUID();
    const dir = await writeWorkspace(runId, req.workflows, { sourceRoot: req.sourceRoot });
    // engineEnv starts empty and is filled in by the non-vm branch below (sweepEnv, built from
    // a secret-stripped request — see the comment there). The vm branch has no analogous
    // container sweep, so it leaves engineEnv empty and relies on rec.remoteWs for cleanup.
    const rec: RunRecord = {
      summary: { id: runId, status: 'running', event: req.event, engine: req.engine, target: req.target, startedAt: Date.now() },
      events: [], bytes: 0, subscribers: new Set(), engineEnv: {}, cancelled: false,
    };
    runs.set(runId, rec);
    activeId = runId;
    const parser = createParser();
    rec.parser = parser;
    emit(rec, { kind: 'phase', status: 'running' });

    // Both branches spawn without overriding stdio, so stdin/stdout/stderr are always pipes
    // (never null) — ChildProcessWithoutNullStreams keeps that non-null guarantee in the types.
    let proc: import('node:child_process').ChildProcessWithoutNullStreams;
    if (req.engine === 'vm') {
      if (!deps.vmConfig) {
        await cleanupWorkspace(runId);
        finishRun(rec, 'error');
        throw new Error('VM engine not configured (set VM_SSH_TARGET / VM_SSH_KEY).');
      }
      const cfg = deps.vmConfig;
      const remoteWs = remoteWorkspace(cfg, basename(dir));
      rec.remoteWs = remoteWs;
      const ssh = deps.ssh ?? 'ssh';
      const scp = deps.scp ?? 'scp';
      // 1) ensure remote dir, 2) sync the local workspace up (await both, in order).
      await deps.exec(ssh, [...buildSshBase(cfg), `mkdir -p ${remoteWs}`]);
      const sync = await deps.exec(scp, buildScpArgs(cfg, remoteWs), undefined, dir);
      if (sync.code !== 0) { finishRun(rec, 'error'); return { runId }; }
      // 3) run act over ssh; the bootstrap (with secret VALUES) goes to stdin, never argv/disk,
      // and is built fresh in this closure each time — never stored on rec.
      const sshArgs = [...(deps.actPrefixArgs ?? []), ...buildSshBase(cfg), 'bash', '-s'];
      proc = spawn(ssh, sshArgs, { env: { ...process.env, ...deps.mockEnv }, windowsHide: true });
      proc.stdin?.end(buildRemoteScript(req, remoteWs, cfg.runScript));
    } else {
      const podmanSocket = req.engine === 'podman' ? await deps.podmanSocket?.() : undefined;
      if (req.engine === 'podman' && !podmanSocket && !deps.mockEnv) {
        await cleanupWorkspace(runId);
        finishRun(rec, 'error');
        throw new Error('Podman socket could not be resolved — is the podman machine running?');
      }
      // childEnv (with secret VALUES) is spawn-only and stays in this closure — it must never
      // be stored on the run record. rec.engineEnv is built from a secret-stripped request and
      // is what's persisted on the record for the cancel-path docker ps/rm exec calls, so a
      // finished run's record never retains secret values (see spec: secrets live only in the
      // spawn closure).
      const childEnv = { ...buildChildEnv(req, process.env, podmanSocket), ...deps.mockEnv };
      rec.engineEnv = { ...buildChildEnv({ ...req, secrets: undefined }, process.env, podmanSocket), ...deps.mockEnv };
      const args = [...(deps.actPrefixArgs ?? []), ...buildActArgs(req)];
      proc = spawn(deps.actPath, args, { cwd: dir, env: childEnv, windowsHide: true, detached: process.platform !== 'win32' });
    }
    rec.proc = proc;

    const wire = (stream: NodeJS.ReadableStream) => {
      createInterface({ input: stream }).on('line', (line) => {
        for (const e of parser.push(line)) emit(rec, e);
      });
    };
    wire(proc.stdout);
    wire(proc.stderr);
    proc.on('error', () => finishRun(rec, 'error'));
    proc.on('close', (code) => {
      finishRun(rec, rec.cancelled ? 'cancelled' : code === 0 ? 'success' : 'failure', code ?? undefined);
    });
    return { runId };
  };

  const cancel = async (runId: string): Promise<void> => {
    const rec = runs.get(runId);
    if (!rec || rec.summary.status !== 'running' || !rec.proc?.pid) return;
    rec.cancelled = true;
    if (process.platform === 'win32') {
      await deps.exec('taskkill', ['/PID', String(rec.proc.pid), '/T', '/F']).catch(() => undefined);
    } else {
      try { process.kill(-rec.proc.pid, 'SIGKILL'); } catch { rec.proc.kill('SIGKILL'); }
    }
    if (rec.summary.engine !== 'vm') {
      // container sweep on the same engine — same child env the run was spawned with. (No
      // analogous sweep for vm: its remote workspace cleanup is handled by finishRun, which
      // this cancel() call routes through below, so it fires for every terminal transition.)
      const ps = await deps.exec('docker', ['ps', '-q', '--filter', 'name=^act-'], rec.engineEnv).catch(() => null);
      const ids = ps && ps.code === 0 ? ps.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : [];
      if (ids.length) await deps.exec('docker', ['rm', '-f', ...ids], rec.engineEnv).catch(() => undefined);
    }
    // mark finished if close doesn't arrive promptly — routes through finishRun so a job
    // stuck at 'running' still gets force-resolved (see finishRun's guard for the race
    // against the close handler winning first).
    await new Promise((r) => setTimeout(r, 150));
    finishRun(rec, 'cancelled');
  };

  return {
    start,
    cancel,
    // Replay is deferred to a microtask so `subscribe()` always returns its unsubscribe
    // function to the caller BEFORE any buffered (or terminal) event is delivered. Callers
    // that write `const unsub = manager.subscribe(...)` and reference `unsub()` from inside
    // the event callback would otherwise hit a TDZ ReferenceError when replaying a finished
    // run's terminal event synchronously, since the callback can fire before the assignment
    // to `unsub` completes. The events-length snapshot ensures anything appended to the ring
    // buffer during the microtask gap is neither replayed twice nor dropped: it's simply
    // delivered live once this subscriber is added to `rec.subscribers` at the end of the
    // same microtask (replay first, live after).
    subscribe(runId: string, onEvent: (e: RunEvent) => void): () => void {
      const rec = runs.get(runId);
      if (!rec) return () => undefined;
      let unsubscribed = false;
      const snapshotLen = rec.events.length;
      queueMicrotask(() => {
        if (unsubscribed) return;
        for (let i = 0; i < snapshotLen; i++) onEvent(rec.events[i]);
        if (!unsubscribed) rec.subscribers.add(onEvent);
      });
      return () => {
        unsubscribed = true;
        rec.subscribers.delete(onEvent);
      };
    },
    list: (): RunSummary[] => [...runs.values()].map((r) => r.summary).sort((a, b) => b.startedAt - a.startedAt),
    get: (runId: string) => runs.get(runId)?.summary,
  };
}
