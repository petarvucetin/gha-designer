import { describe, expect, it, vi } from 'vitest';
import { applyRunEvent, emptyRun, useRun } from './runStore';
import { useEditor } from './store';
import { useUi } from './uiStore';

describe('applyRunEvent', () => {
  it('tracks job and step statuses and appends lines', () => {
    let run = emptyRun('run1', 'tab1');
    run = applyRunEvent(run, { kind: 'status', scope: 'job', jobId: 'build', status: 'running' });
    run = applyRunEvent(run, { kind: 'line', jobId: 'build', step: 'Hello', level: 'info', msg: 'hi' });
    run = applyRunEvent(run, { kind: 'status', scope: 'step', jobId: 'build', step: 'Hello', status: 'success' });
    run = applyRunEvent(run, { kind: 'status', scope: 'job', jobId: 'build', status: 'success' });
    run = applyRunEvent(run, { kind: 'phase', status: 'success', exitCode: 0 });
    expect(run.jobs.build.status).toBe('success');
    expect(run.jobs.build.steps).toEqual([{ name: 'Hello', status: 'success' }]);
    expect(run.lines).toHaveLength(1);
    expect(run.status).toBe('success');
  });

  it('caps stored lines at 4000', () => {
    let run = emptyRun('run1', 'tab1');
    for (let i = 0; i < 4100; i++) {
      run = applyRunEvent(run, { kind: 'line', level: 'info', msg: `l${i}` });
    }
    expect(run.lines).toHaveLength(4000);
    expect(run.lines[0].msg).toBe('l100');
  });
});

describe('startRun', () => {
  it('includes engine and mode in the request body', async () => {
    const bodies: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: any) => {
      bodies.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ runId: 'r1' }) };
    }));
    vi.stubGlobal('EventSource', class {
      close() {}
      addEventListener() {}
      set onopen(_f: any) {}
      set onmessage(_f: any) {}
      set onerror(_f: any) {}
    });
    // Default (pristine) editor state — new-workflow.yml, no source binding — is enough
    // for composeRunWorkflows to succeed (see store.test.ts and effectiveName.test.ts).
    const result = await useRun.getState().startRun({
      event: 'push', inputs: {}, secrets: {}, vars: {},
      engine: 'vm', mode: 'container', image: 'localhost/act-runner:latest', pull: false,
    });
    expect(result).toBe('started');
    expect(bodies.at(-1)).toMatchObject({ engine: 'vm', mode: 'container' });
    expect(bodies.at(-1).sourceRoot).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it('switches the ui view to run on start, and back to workflow on clear', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, json: async () => ({ runId: 'r-view' }),
    })));
    vi.stubGlobal('EventSource', class {
      close() {}
      addEventListener() {}
      set onopen(_f: any) {}
      set onmessage(_f: any) {}
      set onerror(_f: any) {}
    });
    useUi.getState().showWorkflow();
    const result = await useRun.getState().startRun({
      event: 'push', inputs: {}, secrets: {}, vars: {},
      engine: 'vm', mode: 'container', image: 'localhost/act-runner:latest', pull: false,
    });
    expect(result).toBe('started');
    expect(useUi.getState().activeView).toBe('run');
    useRun.getState().clear();
    expect(useUi.getState().activeView).toBe('workflow');
    vi.unstubAllGlobals();
  });

  it('includes sourceRoot from the active folder-bound doc', async () => {
    const CI = 'name: CI\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ls\n';
    useEditor.getState().openFromFile('/repo', 'workflows/ci.yml', CI, 100);

    const bodies: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: any) => {
      bodies.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ runId: 'r2' }) };
    }));
    vi.stubGlobal('EventSource', class {
      close() {}
      addEventListener() {}
      set onopen(_f: any) {}
      set onmessage(_f: any) {}
      set onerror(_f: any) {}
    });
    const result = await useRun.getState().startRun({
      event: 'push', inputs: {}, secrets: {}, vars: {},
      engine: 'vm', mode: 'container', image: 'localhost/act-runner:latest', pull: false,
    });
    expect(result).toBe('started');
    expect(bodies.at(-1).sourceRoot).toBe('/repo');
    vi.unstubAllGlobals();
  });
});
