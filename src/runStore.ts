import { create } from 'zustand';
import { composeRunWorkflows, effectiveNameOf, runTargetError } from './model/effectiveName';
import { useEditor } from './store';
import { useUi } from './uiStore';
import { apiUrl } from './lib/apiBase';

// keep in sync with server/types.ts
export type JobStatus = 'running' | 'success' | 'failure' | 'cancelled' | 'skipped';
export type RunEvent =
  | { kind: 'line'; jobId?: string; step?: string; level: string; msg: string; repeat?: number }
  | { kind: 'status'; scope: 'job' | 'step'; jobId: string; step?: string; status: JobStatus }
  | { kind: 'phase'; status: 'running' | 'success' | 'failure' | 'cancelled' | 'error'; exitCode?: number };
export type EngineInfo = { available: boolean; version?: string; hint?: string };
export type EnginesReport = {
  act: EngineInfo & { path?: string };
  docker: EngineInfo;
  podman: EngineInfo & { socket?: string };
  vm: EngineInfo;
};

export type ActiveRun = {
  id: string;
  tabId: string;
  status: 'running' | 'success' | 'failure' | 'cancelled' | 'error';
  startedAt: number;
  jobs: Record<string, { status: JobStatus; steps: { name: string; status: JobStatus }[] }>;
  lines: { jobId?: string; step?: string; level: string; msg: string; repeat?: number }[];
};

export type DialogChoices = {
  event: string;
  job?: string;
  inputs: Record<string, string>;
  secrets: Record<string, string>;
  vars: Record<string, string>;
  engine: 'docker' | 'podman' | 'vm';
  mode?: 'self-hosted' | 'container';
  image: string;
  pull: boolean;
  cancelPrevious?: boolean;
};

const MAX_LINES = 4000;

export function emptyRun(id: string, tabId: string): ActiveRun {
  return { id, tabId, status: 'running', startedAt: Date.now(), jobs: {}, lines: [] };
}

export function applyRunEvent(run: ActiveRun, e: RunEvent): ActiveRun {
  if (e.kind === 'phase') {
    return { ...run, status: e.status };
  }
  if (e.kind === 'status') {
    const job = run.jobs[e.jobId] ?? { status: 'running' as JobStatus, steps: [] };
    if (e.scope === 'job') {
      return { ...run, jobs: { ...run.jobs, [e.jobId]: { ...job, status: e.status } } };
    }
    const steps = job.steps.some((s) => s.name === e.step)
      ? job.steps.map((s) => (s.name === e.step ? { ...s, status: e.status } : s))
      : [...job.steps, { name: e.step ?? '?', status: e.status }];
    return { ...run, jobs: { ...run.jobs, [e.jobId]: { ...job, steps } } };
  }
  const lines = run.lines.length >= MAX_LINES
    ? [...run.lines.slice(run.lines.length - MAX_LINES + 1), e]
    : [...run.lines, e];
  return { ...run, lines };
}

type RunState = {
  server: 'unknown' | 'up' | 'down';
  engines?: EnginesReport;
  activeRun: ActiveRun | null;
  lastDialog?: DialogChoices;
  refreshEngines(): Promise<void>;
  startRun(choices: DialogChoices): Promise<'started' | { error: string; conflict?: boolean }>;
  cancel(): Promise<void>;
  clear(): void;
};

let source: EventSource | null = null;

export const useRun = create<RunState>((set, get) => ({
  server: 'unknown',
  engines: undefined,
  activeRun: null,
  lastDialog: undefined,

  refreshEngines: async () => {
    try {
      const res = await fetch(apiUrl('/api/engines'));
      if (!res.ok) throw new Error(String(res.status));
      set({ engines: (await res.json()) as EnginesReport, server: 'up' });
    } catch {
      set({ server: 'down' });
    }
  },

  startRun: async (choices) => {
    const editor = useEditor.getState();
    const storage = editor.composeStorage();
    const composed = composeRunWorkflows(storage.workflows);
    if ('error' in composed) return { error: composed.error };
    const activeDoc = storage.workflows.find((w) => w.id === editor.activeId);
    if (activeDoc) {
      const targetError = runTargetError(activeDoc);
      if (targetError) return { error: targetError };
    }
    const target = (activeDoc ? effectiveNameOf(activeDoc) : null) ?? editor.activeFileName;
    const body = {
      workflows: composed.workflows,
      target,
      sourceRoot: activeDoc?.source?.root,
      event: choices.event,
      job: choices.job,
      inputs: choices.inputs,
      secrets: choices.secrets,
      vars: choices.vars,
      engine: choices.engine,
      mode: choices.mode,
      image: choices.image,
      pull: choices.pull,
      cancelPrevious: choices.cancelPrevious,
    };
    let res: Response;
    try {
      res = await fetch(apiUrl('/api/runs'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      set({ server: 'down' });
      return { error: 'Runner server is not reachable — start it with: npm run server' };
    }
    if (res.status === 409) {
      return { error: 'A run is already active.', conflict: true };
    }
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return { error: data.error ?? `Run failed to start (${res.status}).` };
    }
    const { runId } = (await res.json()) as { runId: string };
    set({ activeRun: emptyRun(runId, editor.activeId), lastDialog: choices, server: 'up' });
    useUi.getState().showRun();
    source?.close();
    source = new EventSource(apiUrl(`/api/runs/${runId}/events`));
    // The browser's native EventSource auto-reconnects on a dropped connection and the
    // server replays its full ring buffer to the new subscriber (see runManager.subscribe).
    // Without resetting local state first, that replay would be appended on top of what's
    // already rendered, duplicating every line. `onopen` fires on the *first* connect too,
    // but resetting to an empty run there is harmless — the very same replay immediately
    // rebuilds it. Preserve startedAt across the reset so the elapsed-time display doesn't
    // jump on reconnect.
    source.onopen = () => {
      set((s) => (s.activeRun && s.activeRun.id === runId
        ? { activeRun: { ...emptyRun(runId, s.activeRun.tabId), startedAt: s.activeRun.startedAt } }
        : {}));
    };
    source.onmessage = (msg) => {
      const event = JSON.parse(msg.data) as RunEvent;
      set((s) => (s.activeRun ? { activeRun: applyRunEvent(s.activeRun, event) } : {}));
    };
    source.addEventListener('end', () => { source?.close(); source = null; });
    source.onerror = () => {
      set((s) => (s.activeRun && s.activeRun.status === 'running'
        ? { activeRun: { ...s.activeRun, status: 'error' } }
        : {}));
    };
    return 'started';
  },

  cancel: async () => {
    const run = get().activeRun;
    if (!run) return;
    await fetch(apiUrl(`/api/runs/${run.id}/cancel`), { method: 'POST', headers: { 'content-type': 'application/json' } }).catch(() => undefined);
  },

  clear: () => {
    source?.close();
    source = null;
    set({ activeRun: null });
    useUi.getState().showWorkflow();
  },
}));
