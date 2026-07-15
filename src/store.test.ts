import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditor } from './store';
import { hashText } from './model/hash';

// zustand stores work without React; call actions via useEditor.getState().

beforeEach(() => {
  // reset() only clears the active tab by design (see 'multi-workflow tabs' below),
  // so close every other tab first to give each test a single, pristine starting tab.
  const { workflows, activeId, closeWorkflow, reset } = useEditor.getState();
  workflows.filter((w) => w.id !== activeId).forEach((w) => closeWorkflow(w.id));
  reset();
});

describe('editor store', () => {
  it('starts with an empty workflow named "new-workflow"', () => {
    const s = useEditor.getState();
    expect(s.meta.name).toBe('new-workflow');
    expect(s.nodes).toEqual([]);
    expect(s.edges).toEqual([]);
  });

  it('addNode adds a node and returns its id; unique job ids are enforced', () => {
    const s = useEditor.getState();
    const id1 = s.addNode({ kind: 'job', jobId: 'build', runsOn: 'ubuntu-latest', steps: [] }, { x: 1, y: 2 });
    const id2 = useEditor.getState().addNode({ kind: 'job', jobId: 'build', runsOn: 'ubuntu-latest', steps: [] }, { x: 0, y: 0 });
    const nodes = useEditor.getState().nodes;
    expect(nodes).toHaveLength(2);
    expect(nodes[0].id).toBe(id1);
    const second = nodes.find((n) => n.id === id2)!;
    expect(second.data.kind === 'job' && second.data.jobId).toBe('build-2');
  });

  it('onConnect adds a needs edge but rejects cycles', () => {
    const s = useEditor.getState();
    const a = s.addNode({ kind: 'job', jobId: 'a', runsOn: 'x', steps: [] }, { x: 0, y: 0 });
    const b = useEditor.getState().addNode({ kind: 'job', jobId: 'b', runsOn: 'x', steps: [] }, { x: 0, y: 0 });
    expect(useEditor.getState().onConnect({ source: a, target: b, sourceHandle: null, targetHandle: null })).toBe(true);
    expect(useEditor.getState().onConnect({ source: b, target: a, sourceHandle: null, targetHandle: null })).toBe(false);
    expect(useEditor.getState().edges).toHaveLength(1);
  });

  it('updateNodeData patches data', () => {
    const s = useEditor.getState();
    const id = s.addNode({ kind: 'job', jobId: 'a', runsOn: 'x', steps: [] }, { x: 0, y: 0 });
    useEditor.getState().updateNodeData(id, { runsOn: 'windows-latest' });
    const n = useEditor.getState().nodes.find((nn) => nn.id === id)!;
    expect(n.data.kind === 'job' && n.data.runsOn).toBe('windows-latest');
  });

  it('addActionStep appends to the selected job', () => {
    const jobId = useEditor.getState().addNode({ kind: 'job', jobId: 'build', runsOn: 'ubuntu-latest', steps: [] }, { x: 0, y: 0 });
    useEditor.getState().setSelected(jobId);
    const step = { id: 'step_selected', uses: 'actions/checkout@v4' };
    useEditor.getState().addActionStep(step);
    const node = useEditor.getState().nodes.find((n) => n.id === jobId)!;
    expect(node.data.kind === 'job' && node.data.steps).toEqual([step]);
    expect(useEditor.getState().selectedId).toBe(jobId);
  });

  it('addActionStep appends to the only job when none is selected', () => {
    const jobId = useEditor.getState().addNode({ kind: 'job', jobId: 'build', runsOn: 'ubuntu-latest', steps: [] }, { x: 0, y: 0 });
    useEditor.getState().setSelected(null);
    const step = { id: 'step_only', uses: 'actions/setup-node@v4' };
    useEditor.getState().addActionStep(step);
    const node = useEditor.getState().nodes.find((n) => n.id === jobId)!;
    expect(node.data.kind === 'job' && node.data.steps).toEqual([step]);
    expect(useEditor.getState().selectedId).toBe(jobId);
  });

  it('addActionStep creates a job when none exists', () => {
    useEditor.getState().setSelected(null);
    const step = { id: 'step_created', uses: 'actions/checkout@v4' };
    useEditor.getState().addActionStep(step);
    const s = useEditor.getState();
    const jobNodes = s.nodes.filter((n) => n.data.kind === 'job');
    expect(jobNodes).toHaveLength(1);
    expect(jobNodes[0].data.kind === 'job' && jobNodes[0].data.steps).toEqual([step]);
    expect(s.selectedId).toBe(jobNodes[0].id);
  });

  it('addActionStep with multiple jobs and no selection creates a new job rather than guessing', () => {
    useEditor.getState().addNode({ kind: 'job', jobId: 'a', runsOn: 'x', steps: [] }, { x: 0, y: 0 });
    useEditor.getState().addNode({ kind: 'job', jobId: 'b', runsOn: 'x', steps: [] }, { x: 0, y: 0 });
    useEditor.getState().setSelected(null);
    const step = { id: 'step_ambiguous', uses: 'actions/checkout@v4' };
    useEditor.getState().addActionStep(step);
    const s = useEditor.getState();
    const jobNodes = s.nodes.filter((n) => n.data.kind === 'job');
    expect(jobNodes).toHaveLength(3);
    const created = jobNodes.find((n) => n.data.kind === 'job' && n.data.steps.some((st) => st.id === step.id));
    expect(created).toBeTruthy();
    expect(s.selectedId).toBe(created!.id);
  });

  it('addActionStep with an explicit jobId appends to that job even when a different job is selected', () => {
    const jobA = useEditor.getState().addNode({ kind: 'job', jobId: 'a', runsOn: 'x', steps: [] }, { x: 0, y: 0 });
    const jobB = useEditor.getState().addNode({ kind: 'job', jobId: 'b', runsOn: 'x', steps: [] }, { x: 0, y: 0 });
    useEditor.getState().setSelected(jobA); // a different job is selected
    const step = { id: 'step_target', uses: 'actions/checkout@v4' };
    useEditor.getState().addActionStep(step, { jobId: jobB });
    const s = useEditor.getState();
    const nodeA = s.nodes.find((n) => n.id === jobA)!;
    const nodeB = s.nodes.find((n) => n.id === jobB)!;
    expect(nodeA.data.kind === 'job' && nodeA.data.steps).toEqual([]);
    expect(nodeB.data.kind === 'job' && nodeB.data.steps).toEqual([step]);
    expect(s.selectedId).toBe(jobB);
  });

  it('addActionStep falls back to the existing resolution when jobId is missing or not a job', () => {
    const jobId = useEditor.getState().addNode({ kind: 'job', jobId: 'build', runsOn: 'ubuntu-latest', steps: [] }, { x: 0, y: 0 });
    const triggerId = useEditor.getState().addNode({ kind: 'trigger', trigger: 'push' }, { x: 0, y: 0 });
    useEditor.getState().setSelected(jobId);
    const step = { id: 'step_fallback', uses: 'actions/checkout@v4' };
    // target.jobId points at a trigger node, not a job -> falls back to the selected job
    useEditor.getState().addActionStep(step, { jobId: triggerId });
    const node = useEditor.getState().nodes.find((n) => n.id === jobId)!;
    expect(node.data.kind === 'job' && node.data.steps).toEqual([step]);
    expect(useEditor.getState().selectedId).toBe(jobId);
  });

  it('addActionStep falls back and creates a job at the given position when jobId cannot be resolved to a job', () => {
    useEditor.getState().setSelected(null);
    const step = { id: 'step_pos', uses: 'actions/checkout@v4' };
    useEditor.getState().addActionStep(step, { jobId: 'nonexistent', position: { x: 42, y: 99 } });
    const s = useEditor.getState();
    const jobNodes = s.nodes.filter((n) => n.data.kind === 'job');
    expect(jobNodes).toHaveLength(1);
    expect(jobNodes[0].position).toEqual({ x: 42, y: 99 });
    expect(jobNodes[0].data.kind === 'job' && jobNodes[0].data.steps).toEqual([step]);
    expect(s.selectedId).toBe(jobNodes[0].id);
  });

  it('addActionStep with target.index 0 inserts at the front of the job\'s steps', () => {
    const jobId = useEditor.getState().addNode(
      { kind: 'job', jobId: 'build', runsOn: 'ubuntu-latest', steps: [{ id: 'existing', uses: 'actions/checkout@v4' }] },
      { x: 0, y: 0 },
    );
    const step = { id: 'step_front', uses: 'actions/setup-node@v4' };
    useEditor.getState().addActionStep(step, { jobId, index: 0 });
    const node = useEditor.getState().nodes.find((n) => n.id === jobId)!;
    expect(node.data.kind === 'job' && node.data.steps).toEqual([
      step,
      { id: 'existing', uses: 'actions/checkout@v4' },
    ]);
  });

  it('addActionStep with target.index 1 inserts between existing steps', () => {
    const jobId = useEditor.getState().addNode(
      {
        kind: 'job', jobId: 'build', runsOn: 'ubuntu-latest',
        steps: [
          { id: 'first', uses: 'actions/checkout@v4' },
          { id: 'second', uses: 'actions/setup-node@v4' },
        ],
      },
      { x: 0, y: 0 },
    );
    const step = { id: 'step_middle', uses: 'actions/cache@v4' };
    useEditor.getState().addActionStep(step, { jobId, index: 1 });
    const node = useEditor.getState().nodes.find((n) => n.id === jobId)!;
    expect(node.data.kind === 'job' && node.data.steps).toEqual([
      { id: 'first', uses: 'actions/checkout@v4' },
      step,
      { id: 'second', uses: 'actions/setup-node@v4' },
    ]);
  });

  it('addActionStep with no index still appends (regression guard)', () => {
    const jobId = useEditor.getState().addNode(
      { kind: 'job', jobId: 'build', runsOn: 'ubuntu-latest', steps: [{ id: 'existing', uses: 'actions/checkout@v4' }] },
      { x: 0, y: 0 },
    );
    const step = { id: 'step_append', uses: 'actions/setup-node@v4' };
    useEditor.getState().addActionStep(step, { jobId });
    const node = useEditor.getState().nodes.find((n) => n.id === jobId)!;
    expect(node.data.kind === 'job' && node.data.steps).toEqual([
      { id: 'existing', uses: 'actions/checkout@v4' },
      step,
    ]);
  });

  it('addActionStep with an out-of-range index clamps and appends', () => {
    const jobId = useEditor.getState().addNode(
      { kind: 'job', jobId: 'build', runsOn: 'ubuntu-latest', steps: [{ id: 'existing', uses: 'actions/checkout@v4' }] },
      { x: 0, y: 0 },
    );
    const step = { id: 'step_clamped', uses: 'actions/setup-node@v4' };
    useEditor.getState().addActionStep(step, { jobId, index: 999 });
    const node = useEditor.getState().nodes.find((n) => n.id === jobId)!;
    expect(node.data.kind === 'job' && node.data.steps).toEqual([
      { id: 'existing', uses: 'actions/checkout@v4' },
      step,
    ]);
  });

  it('moveStepInJob moves a step within the job', () => {
    const jobId = useEditor.getState().addNode(
      {
        kind: 'job', jobId: 'build', runsOn: 'ubuntu-latest',
        steps: [
          { id: 'a', uses: 'actions/checkout@v4' },
          { id: 'b', uses: 'actions/setup-node@v4' },
          { id: 'c', uses: 'actions/cache@v4' },
        ],
      },
      { x: 0, y: 0 },
    );
    useEditor.getState().moveStepInJob(jobId, 0, 3);
    const node = useEditor.getState().nodes.find((n) => n.id === jobId)!;
    expect(node.data.kind === 'job' && node.data.steps.map((s) => s.id)).toEqual(['b', 'c', 'a']);
  });

  it('moveStepInJob with a self-slot gap leaves order unchanged', () => {
    const steps = [
      { id: 'a', uses: 'actions/checkout@v4' },
      { id: 'b', uses: 'actions/setup-node@v4' },
      { id: 'c', uses: 'actions/cache@v4' },
    ];
    const jobId = useEditor.getState().addNode(
      { kind: 'job', jobId: 'build', runsOn: 'ubuntu-latest', steps },
      { x: 0, y: 0 },
    );
    useEditor.getState().moveStepInJob(jobId, 1, 1); // to === from
    useEditor.getState().moveStepInJob(jobId, 1, 2); // to === from + 1
    const node = useEditor.getState().nodes.find((n) => n.id === jobId)!;
    expect(node.data.kind === 'job' && node.data.steps.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('moveStepInJob on a non-job node id (or missing) is a no-op', () => {
    const triggerId = useEditor.getState().addNode({ kind: 'trigger', trigger: 'push' }, { x: 0, y: 0 });
    const before = useEditor.getState().nodes;
    useEditor.getState().moveStepInJob(triggerId, 0, 1);
    useEditor.getState().moveStepInJob('nonexistent', 0, 1);
    expect(useEditor.getState().nodes).toBe(before);
  });

  it('replaceNodeData swaps data wholesale (no merge)', () => {
    const id = useEditor.getState().addNode({ kind: 'trigger', trigger: 'push', branches: ['main'] }, { x: 0, y: 0 });
    useEditor.getState().replaceNodeData(id, { kind: 'trigger', trigger: 'fork' });
    const n = useEditor.getState().nodes.find((x) => x.id === id)!;
    expect(n.data).toEqual({ kind: 'trigger', trigger: 'fork' });
  });

  it('importYaml replaces graph and lays out nodes', () => {
    useEditor.getState().importYaml('name: CI\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ls');
    const s = useEditor.getState();
    expect(s.meta.name).toBe('CI');
    expect(s.nodes.length).toBe(2);
    // layout ran: not everything at origin
    expect(s.nodes.some((n) => n.position.x !== 0 || n.position.y !== 0)).toBe(true);
  });

  it('importYaml throws on bad YAML and leaves state untouched', () => {
    const before = useEditor.getState().nodes;
    expect(() => useEditor.getState().importYaml('{ nope')).toThrow();
    expect(useEditor.getState().nodes).toBe(before);
  });

  it('snapshot() returns a GraphSnapshot mirror of state', () => {
    useEditor.getState().addNode({ kind: 'trigger', trigger: 'push' }, { x: 5, y: 6 });
    const snap = useEditor.getState().snapshot();
    expect(snap.nodes).toHaveLength(1);
    expect(snap.nodes[0].position).toEqual({ x: 5, y: 6 });
    expect(snap.meta.name).toBe('new-workflow');
  });

  it('importYaml and autoLayout bump layoutStamp for viewport refit', () => {
    const before = useEditor.getState().layoutStamp;
    useEditor.getState().importYaml('name: x\non: push\njobs:\n  a:\n    runs-on: u\n    steps:\n      - run: ls');
    expect(useEditor.getState().layoutStamp).toBe(before + 1);
    useEditor.getState().autoLayout();
    expect(useEditor.getState().layoutStamp).toBe(before + 2);
  });

  it('corrupt localStorage is ignored at startup', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', {
      getItem: () => '{"foo": 1}',
      setItem: () => {},
    });
    const { useEditor: fresh } = await import('./store');
    expect(fresh.getState().nodes).toEqual([]);
    expect(fresh.getState().meta.name).toBe('new-workflow');
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('loads a v1-era snapshot fixture from localStorage without issue', async () => {
    vi.resetModules();
    const legacy = JSON.stringify({
      meta: { name: 'legacy' },
      nodes: [
        {
          id: 'trigger:push', type: 'trigger', position: { x: 1, y: 2 },
          data: { kind: 'trigger', trigger: 'push', branches: ['main'] },
        },
        {
          id: 'job:build', type: 'job', position: { x: 3, y: 4 },
          data: { kind: 'job', jobId: 'build', runsOn: 'ubuntu-latest', steps: [{ id: 's1', run: 'make' }] },
        },
      ],
      edges: [],
    });
    vi.stubGlobal('localStorage', {
      getItem: () => legacy,
      setItem: () => {},
    });
    const { useEditor: fresh } = await import('./store');
    expect(fresh.getState().nodes).toHaveLength(2);
    expect(fresh.getState().meta.name).toBe('legacy');
    vi.unstubAllGlobals();
    vi.resetModules();
  });
});

describe('multi-workflow tabs', () => {
  it('starts with exactly one tab and an activeFileName', () => {
    const s = useEditor.getState();
    expect(s.workflows).toHaveLength(1);
    expect(s.activeId).toBe(s.workflows[0].id);
    expect(s.activeFileName).toBe('new-workflow.yml');
  });

  it('addWorkflow checkpoints the current tab and activates a fresh one', () => {
    useEditor.getState().addNode({ kind: 'trigger', trigger: 'push' }, { x: 1, y: 1 });
    const first = useEditor.getState().activeId;
    const second = useEditor.getState().addWorkflow();
    const s = useEditor.getState();
    expect(s.activeId).toBe(second);
    expect(s.nodes).toHaveLength(0);
    expect(s.activeFileName).toBe('new-workflow-2.yml');
    expect(s.workflows.find((w) => w.id === first)?.nodes).toHaveLength(1);
    expect(s.selectedId).toBeNull();
  });

  it('edits survive A -> B -> A, including fileName renames', () => {
    const a = useEditor.getState().activeId;
    useEditor.getState().addNode({ kind: 'trigger', trigger: 'push' }, { x: 0, y: 0 });
    useEditor.getState().setFileName('renamed.yml');
    const b = useEditor.getState().addWorkflow();
    expect(useEditor.getState().activeFileName).not.toBe('renamed.yml');
    useEditor.getState().switchWorkflow(a);
    const s = useEditor.getState();
    expect(s.activeId).toBe(a);
    expect(s.nodes).toHaveLength(1);
    expect(s.activeFileName).toBe('renamed.yml');
    expect(s.workflows.find((w) => w.id === b)).toBeTruthy();
  });

  it('closeWorkflow: inactive close keeps selection; active close switches; last tab is replaced fresh', () => {
    const a = useEditor.getState().activeId;
    const b = useEditor.getState().addWorkflow();
    const stampBefore = useEditor.getState().layoutStamp;
    useEditor.getState().closeWorkflow(a); // inactive
    expect(useEditor.getState().workflows).toHaveLength(1);
    expect(useEditor.getState().layoutStamp).toBe(stampBefore);
    useEditor.getState().closeWorkflow(b); // active + last
    const s = useEditor.getState();
    expect(s.workflows).toHaveLength(1);
    expect(s.activeId).not.toBe(b);
    expect(s.meta.name).toBe('new-workflow');
    expect(s.layoutStamp).toBe(stampBefore + 1);
  });

  it('every tab action fires exactly one notification, and activeId always resolves in workflows', () => {
    let notifications = 0;
    const unsubscribe = useEditor.subscribe((state) => {
      notifications += 1;
      expect(state.workflows.some((w) => w.id === state.activeId)).toBe(true);
    });
    try {
      useEditor.getState().addWorkflow();
      expect(notifications).toBe(1);
      const second = useEditor.getState().activeId;
      useEditor.getState().addWorkflow();
      expect(notifications).toBe(2);
      useEditor.getState().switchWorkflow(second);
      expect(notifications).toBe(3);
      const third = useEditor.getState().workflows.find((w) => w.id !== second)!.id;
      useEditor.getState().closeWorkflow(third);
      expect(notifications).toBe(4);
      useEditor.getState().importYaml('name: Z\non: push\njobs: {}');
      expect(notifications).toBe(5);
    } finally {
      unsubscribe();
    }
  });

  it('composeStorage is pure and reflects live edits without mutating state', () => {
    useEditor.getState().addNode({ kind: 'trigger', trigger: 'push' }, { x: 0, y: 0 });
    const before = useEditor.getState().workflows;
    const storage = useEditor.getState().composeStorage();
    expect(storage.version).toBe(2);
    expect(storage.workflows.find((w) => w.id === storage.activeId)?.nodes).toHaveLength(1);
    expect(useEditor.getState().workflows).toBe(before); // no set() happened
  });

  it('importYaml goes to a new tab and checkpoints live edits on the old one', () => {
    useEditor.getState().addNode({ kind: 'trigger', trigger: 'push' }, { x: 0, y: 0 });
    const a = useEditor.getState().activeId;
    useEditor.getState().importYaml('name: CI\non: push\njobs:\n  b:\n    runs-on: u\n    steps:\n      - run: ls');
    const s = useEditor.getState();
    expect(s.activeId).not.toBe(a);
    expect(s.meta.name).toBe('CI');
    expect(s.activeFileName).toBe('ci.yml');
    expect(s.workflows).toHaveLength(2);
    useEditor.getState().switchWorkflow(a);
    expect(useEditor.getState().nodes).toHaveLength(1); // pre-import edit survived
  });

  it('importYaml replaces a pristine tab; meta or fileName edits defeat pristine', () => {
    expect(useEditor.getState().workflows).toHaveLength(1);
    useEditor.getState().importYaml('name: X\non: push\njobs: {}');
    expect(useEditor.getState().workflows).toHaveLength(1); // replaced in place
    expect(useEditor.getState().activeFileName).toBe('x.yml');
    useEditor.getState().reset();
    useEditor.getState().setFileName('kept.yml');
    useEditor.getState().importYaml('name: Y\non: push\njobs: {}');
    expect(useEditor.getState().workflows).toHaveLength(2); // rename defeated pristine
  });

  it('importYaml pristine-replace keeps the tab in its original position', () => {
    const a = useEditor.getState().activeId;
    const b = useEditor.getState().addWorkflow();
    useEditor.getState().switchWorkflow(a); // back to the first (still-pristine) tab
    expect(useEditor.getState().activeId).toBe(a);
    useEditor.getState().importYaml('name: X\non: push\njobs: {}');
    const s = useEditor.getState();
    expect(s.workflows).toHaveLength(2);
    expect(s.workflows[0].id).toBe(a); // replaced positionally, not moved to the end
    expect(s.workflows.find((w) => w.id === b)).toBeTruthy();
  });

  it('reset only clears the active tab and regenerates its fileName', () => {
    const a = useEditor.getState().activeId;
    useEditor.getState().addNode({ kind: 'trigger', trigger: 'push' }, { x: 0, y: 0 });
    const b = useEditor.getState().addWorkflow();
    useEditor.getState().addNode({ kind: 'trigger', trigger: 'fork' }, { x: 0, y: 0 });
    useEditor.getState().reset();
    const s = useEditor.getState();
    expect(s.activeId).toBe(b);
    expect(s.nodes).toHaveLength(0);
    expect(s.workflows.find((w) => w.id === a)?.nodes).toHaveLength(1); // untouched
  });

  it('persists v2 shape and never writes the v1 key', async () => {
    const writes: Record<string, string> = {};
    vi.resetModules();
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: (k: string, v: string) => { writes[k] = v; },
    });
    const { useEditor: fresh } = await import('./store');
    fresh.getState().addNode({ kind: 'trigger', trigger: 'push' }, { x: 0, y: 0 });
    expect(Object.keys(writes)).toEqual(['gha-designer:v2']);
    const parsed = JSON.parse(writes['gha-designer:v2']);
    expect(parsed.version).toBe(2);
    expect(parsed.workflows[0].nodes).toHaveLength(1);
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('boots to default when v2 storage has an element-level corrupt node (nodes:[null])', async () => {
    vi.resetModules();
    const corrupt = JSON.stringify({
      version: 2, activeId: 'a',
      workflows: [{ id: 'a', fileName: 'a.yml', meta: { name: 'x' }, nodes: [null], edges: [] }],
    });
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (k === 'gha-designer:v2' ? corrupt : null),
      setItem: () => {},
    });
    const { useEditor: fresh } = await import('./store'); // must not throw during module eval
    expect(fresh.getState().workflows).toHaveLength(1);
    expect(fresh.getState().meta.name).toBe('new-workflow');
    expect(fresh.getState().nodes).toEqual([]);
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('preserves a foreign doc written by another instance during a concurrent save (union-merge)', async () => {
    vi.resetModules();
    const store: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
    });
    const { useEditor: fresh } = await import('./store');
    const ownId = fresh.getState().activeId;
    const ownDoc = fresh.getState().composeStorage().workflows[0];
    // Simulate a second instance racing us: it wrote its own v2 payload to
    // localStorage containing our doc PLUS one this instance has never seen.
    store['gha-designer:v2'] = JSON.stringify({
      version: 2,
      activeId: ownId,
      workflows: [ownDoc, { id: 'wf_foreign', fileName: 'foreign.yml', meta: { name: 'foreign' }, nodes: [], edges: [] }],
    });

    fresh.getState().addNode({ kind: 'trigger', trigger: 'push' }, { x: 0, y: 0 });

    const written = JSON.parse(store['gha-designer:v2']);
    expect(written.workflows.some((w: { id: string }) => w.id === 'wf_foreign')).toBe(true);
    expect(written.workflows.some((w: { id: string }) => w.id === ownId)).toBe(true);
    expect(written.activeId).toBe(ownId);
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('drops a tab this instance actually closed, even if it lingers in the union-merge source', async () => {
    vi.resetModules();
    const store: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
    });
    const { useEditor: fresh } = await import('./store');
    const a = fresh.getState().activeId;
    const b = fresh.getState().addWorkflow();
    // Storage currently has both a and b (from the addWorkflow write above).
    fresh.getState().closeWorkflow(a);
    const written = JSON.parse(store['gha-designer:v2']);
    expect(written.workflows.some((w: { id: string }) => w.id === a)).toBe(false);
    expect(written.workflows.some((w: { id: string }) => w.id === b)).toBe(true);
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('boots from a v1 payload when no v2 exists (v1 left intact)', async () => {
    vi.resetModules();
    const store: Record<string, string> = {
      'gha-designer:v1': JSON.stringify({
        meta: { name: 'legacy' },
        nodes: [{ id: 'trigger:push', type: 'trigger', position: { x: 1, y: 2 }, data: { kind: 'trigger', trigger: 'push' } }],
        edges: [],
      }),
    };
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
    });
    const { useEditor: fresh } = await import('./store');
    expect(fresh.getState().meta.name).toBe('legacy');
    expect(fresh.getState().activeFileName).toBe('legacy.yml');
    expect(JSON.parse(store['gha-designer:v1']).meta.name).toBe('legacy'); // untouched
    vi.unstubAllGlobals();
    vi.resetModules();
  });
});

describe('folder-mode binding', () => {
  const CI = 'name: CI\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ls\n';

  it('openFromFile creates a bound tab (basename fileName, source+sourceRt) and switches', () => {
    useEditor.getState().openFromFile('R', 'workflows/ci.yml', CI, 100);
    const s = useEditor.getState();
    const doc = s.workflows.find((w) => w.id === s.activeId)!;
    expect(s.activeFileName).toBe('ci.yml');
    expect(doc.source).toMatchObject({ root: 'R', path: 'workflows/ci.yml' });
    expect(doc.sourceRt?.baseline).toContain('build');
    expect(doc.sourceRt?.diskText).toBe(CI);
    expect(s.nodes.some((n) => n.id === 'job:build')).toBe(true);
  });

  it('openFromFile on the same {root,path} switches instead of duplicating', () => {
    useEditor.getState().openFromFile('R', 'workflows/ci.yml', CI, 100);
    const n = useEditor.getState().workflows.length;
    useEditor.getState().openFromFile('R', 'workflows/ci.yml', CI, 100);
    expect(useEditor.getState().workflows.length).toBe(n);
  });

  it('applyDiskChange reloads a clean bound tab in place', () => {
    useEditor.getState().openFromFile('R', 'workflows/ci.yml', CI, 100);
    const id = useEditor.getState().activeId;
    useEditor.getState().applyDiskChange(id, CI.replace('ubuntu-latest', 'windows-latest'), 200);
    const build = useEditor.getState().nodes.find((x) => x.id === 'job:build')!;
    expect(build.data.kind === 'job' && build.data.runsOn).toBe('windows-latest');
  });

  it('applyDiskChange(null) detaches; bindSaved rebinds and clears flags', () => {
    useEditor.getState().openFromFile('R', 'workflows/ci.yml', CI, 100);
    const id = useEditor.getState().activeId;
    useEditor.getState().applyDiskChange(id, null, 200);
    expect(useEditor.getState().workflows.find((w) => w.id === id)?.sourceRt?.detached).toBe(true);
    const canonical = 'name: CI\non: push\njobs: {}\n';
    useEditor.getState().bindSaved(id, canonical, canonical, 300);
    const rt = useEditor.getState().workflows.find((w) => w.id === id)?.sourceRt;
    expect(rt?.detached).toBe(false);
    expect(rt?.baseline).toContain('jobs');
  });

  it('bindSaved records the actual written bytes, keeping baseline as the canonical text', () => {
    useEditor.getState().openFromFile('R', 'workflows/ci.yml', CI, 100);
    const id = useEditor.getState().activeId;
    const canonical = 'name: CI\non: push\njobs: {}\n';
    const written = '# preserved comment\n' + canonical;
    useEditor.getState().bindSaved(id, canonical, written, 300);
    const doc = useEditor.getState().workflows.find((w) => w.id === id)!;
    expect(doc.source?.diskHash).toBe(hashText(written));
    expect(doc.sourceRt?.diskText).toBe(written);
    expect(doc.sourceRt?.baseline).toBe(canonical);
  });

  it('reset clears the binding', () => {
    useEditor.getState().openFromFile('R', 'workflows/ci.yml', CI, 100);
    useEditor.getState().reset();
    const active = useEditor.getState().activeId;
    expect(useEditor.getState().workflows.find((w) => w.id === active)?.source).toBeUndefined();
  });

  it('persistence strips sourceRt but keeps source', async () => {
    const writes: Record<string, string> = {};
    vi.resetModules();
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: (k: string, v: string) => { writes[k] = v; } });
    const { useEditor: fresh } = await import('./store');
    fresh.getState().openFromFile('R', 'workflows/ci.yml', CI, 100);
    const bound = JSON.parse(writes['gha-designer:v2']).workflows.find((w: { source?: unknown }) => w.source);
    expect(bound.source).toBeTruthy();
    expect(bound.sourceRt).toBeUndefined();
    vi.unstubAllGlobals();
    vi.resetModules();
  });
});
