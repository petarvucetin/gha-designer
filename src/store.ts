import { create } from 'zustand';
import {
  applyEdgeChanges, applyNodeChanges,
  type Connection, type Edge, type EdgeChange, type Node, type NodeChange,
} from '@xyflow/react';
import type { GraphSnapshot, NodeData, Step, WorkflowDoc, WorkflowMeta } from './model/types';
import { freshId } from './model/types';
import { wouldCreateCycle } from './model/validate';
import { layoutGraph } from './model/layout';
import { fromYaml } from './model/fromYaml';
import { toYaml } from './model/toYaml';
import { hashText } from './model/hash';
import { diskChangeDoc } from './model/diskChange';
import { insertStep, moveStep } from './model/stepOps';
import { defaultFileName, parseStorage, STORAGE_KEY_V1, STORAGE_KEY_V2, type StorageV2 } from './model/storage';

export type FlowNode = Node<NodeData>;

interface EditorState {
  meta: WorkflowMeta;
  nodes: FlowNode[];
  edges: Edge[];
  selectedId: string | null;
  layoutStamp: number;
  workflows: WorkflowDoc[];
  activeId: string;
  activeFileName: string;
  onNodesChange(changes: NodeChange<FlowNode>[]): void;
  onEdgesChange(changes: EdgeChange[]): void;
  onConnect(conn: Connection): boolean;
  addNode(data: NodeData, position: { x: number; y: number }): string;
  addActionStep(step: Step, target?: { jobId?: string; position?: { x: number; y: number }; index?: number }): void;
  moveStepInJob(jobId: string, from: number, to: number): void;
  updateNodeData(id: string, patch: Partial<NodeData>): void;
  replaceNodeData(id: string, data: NodeData): void;
  updateMeta(patch: Partial<WorkflowMeta>): void;
  setSelected(id: string | null): void;
  importYaml(text: string): void;
  snapshot(): GraphSnapshot;
  autoLayout(): void;
  reset(): void;
  addWorkflow(): string;
  switchWorkflow(id: string): void;
  closeWorkflow(id: string): void;
  setFileName(name: string): void;
  composeStorage(): StorageV2;
  openFromFile(root: string, path: string, fileText: string, mtimeMs: number): void;
  applyDiskChange(docId: string, fileText: string | null, mtimeMs: number): void;
  bindSaved(docId: string, canonicalText: string, mtimeMs: number): void;
}

function uniqueJobId(nodes: FlowNode[], wanted: string): string {
  const taken = new Set(
    nodes.flatMap((n) => (n.data.kind === 'job' ? [n.data.jobId] : [])),
  );
  if (!taken.has(wanted)) return wanted;
  let i = 2;
  while (taken.has(`${wanted}-${i}`)) i += 1;
  return `${wanted}-${i}`;
}

function toSnapshot(meta: WorkflowMeta, nodes: FlowNode[], edges: Edge[]): GraphSnapshot {
  return {
    meta,
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.data.kind,
      position: { x: n.position.x, y: n.position.y },
      data: n.data,
    })),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
  };
}

function fromSnapshot(snap: GraphSnapshot): { nodes: FlowNode[]; edges: Edge[] } {
  return {
    nodes: snap.nodes.map((n) => ({
      id: n.id, type: n.type, position: n.position, data: n.data,
    })),
    edges: snap.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
  };
}

function liveDoc(s: {
  workflows: WorkflowDoc[]; activeId: string; activeFileName: string;
  meta: WorkflowMeta; nodes: FlowNode[]; edges: Edge[];
}): WorkflowDoc {
  const prev = s.workflows.find((w) => w.id === s.activeId);
  const doc: WorkflowDoc = { id: s.activeId, fileName: s.activeFileName, ...toSnapshot(s.meta, s.nodes, s.edges) };
  if (prev?.source) doc.source = prev.source;
  if (prev?.sourceRt) doc.sourceRt = prev.sourceRt;
  return doc;
}

function checkpoint(s: {
  workflows: WorkflowDoc[]; activeId: string; activeFileName: string;
  meta: WorkflowMeta; nodes: FlowNode[]; edges: Edge[];
}): WorkflowDoc[] {
  return s.workflows.map((w) => (w.id === s.activeId ? liveDoc(s) : w));
}

function freshDoc(taken: string[]): WorkflowDoc {
  return {
    id: freshId('wf'),
    fileName: defaultFileName('new-workflow', taken),
    meta: { name: 'new-workflow' }, nodes: [], edges: [],
  };
}

function docFields(doc: WorkflowDoc) {
  const { nodes, edges } = fromSnapshot(doc);
  return {
    activeId: doc.id, activeFileName: doc.fileName,
    meta: doc.meta, nodes, edges,
    selectedId: null as string | null,
  };
}

export const useEditor = create<EditorState>((set, get) => {
  let initialDocs: WorkflowDoc[];
  let initialActive: WorkflowDoc;
  let initial: { nodes: FlowNode[]; edges: Edge[] };
  try {
    const saved = parseStorage(
      globalThis.localStorage?.getItem(STORAGE_KEY_V2) ?? null,
      globalThis.localStorage?.getItem(STORAGE_KEY_V1) ?? null,
    );
    initialDocs = saved?.workflows ?? [freshDoc([])];
    initialActive = initialDocs.find((w) => w.id === saved?.activeId) ?? initialDocs[0];
    initial = fromSnapshot(initialActive);
  } catch {
    initialDocs = [freshDoc([])];
    initialActive = initialDocs[0];
    initial = { nodes: [], edges: [] };
  }

  return {
    workflows: initialDocs,
    activeId: initialActive.id,
    activeFileName: initialActive.fileName,
    meta: initialActive.meta,
    nodes: initial.nodes,
    edges: initial.edges,
    selectedId: null,
    layoutStamp: 0,

    onNodesChange: (changes) =>
      set((s) => ({ nodes: applyNodeChanges(changes, s.nodes) })),

    onEdgesChange: (changes) =>
      set((s) => ({ edges: applyEdgeChanges(changes, s.edges) })),

    onConnect: (conn) => {
      const { nodes, edges } = get();
      if (!conn.source || !conn.target) return false;
      const source = nodes.find((n) => n.id === conn.source);
      const target = nodes.find((n) => n.id === conn.target);
      if (!source || !target) return false;
      if (target.data.kind === 'trigger') return false; // nothing flows into a trigger
      const bothJobs = source.data.kind === 'job' && target.data.kind === 'job';
      if (bothJobs && wouldCreateCycle(edges, { source: conn.source, target: conn.target })) {
        return false;
      }
      if (edges.some((e) => e.source === conn.source && e.target === conn.target)) return false;
      set((s) => ({
        edges: [...s.edges, { id: freshId('edge'), source: conn.source!, target: conn.target! }],
      }));
      return true;
    },

    addNode: (data, position) => {
      const id = freshId('node');
      set((s) => {
        const fixed: NodeData =
          data.kind === 'job' ? { ...data, jobId: uniqueJobId(s.nodes, data.jobId) } : { ...data };
        return {
          nodes: [...s.nodes, { id, type: fixed.kind, position, data: fixed }],
          selectedId: id,
        };
      });
      return id;
    },

    // Resolve a target job for a marketplace-action step (dropped onto a job node,
    // or double-clicked in the palette): an explicit target.jobId (when it names an
    // existing job node) wins; otherwise fall back to the selected job node, else
    // the only job node, else a fresh job. Reuses addNode/updateNodeData/setSelected
    // rather than duplicating them.
    addActionStep: (step, target) => {
      const { nodes, selectedId } = get();
      const targetNode = target?.jobId ? nodes.find((n) => n.id === target.jobId) : undefined;
      let jobNode = targetNode?.data.kind === 'job' ? targetNode : undefined;
      if (!jobNode) {
        const selectedNode = selectedId ? nodes.find((n) => n.id === selectedId) : undefined;
        jobNode = selectedNode?.data.kind === 'job' ? selectedNode : undefined;
      }
      if (!jobNode) {
        const jobNodes = nodes.filter((n) => n.data.kind === 'job');
        if (jobNodes.length === 1) jobNode = jobNodes[0];
      }
      const existingSteps = jobNode?.data.kind === 'job' ? jobNode.data.steps : [];
      const jobId = jobNode
        ? jobNode.id
        : get().addNode({ kind: 'job', jobId: 'new-job', runsOn: 'ubuntu-latest', steps: [] }, target?.position ?? { x: 120, y: 120 });
      const at = target?.index ?? existingSteps.length;
      get().updateNodeData(jobId, { steps: insertStep(existingSteps, at, step) });
      get().setSelected(jobId);
    },

    moveStepInJob: (jobId, from, to) => {
      const node = get().nodes.find((n) => n.id === jobId);
      if (node?.data.kind !== 'job') return;
      get().updateNodeData(jobId, { steps: moveStep(node.data.steps, from, to) });
    },

    updateNodeData: (id, patch) =>
      set((s) => ({
        nodes: s.nodes.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, ...patch } as NodeData } : n,
        ),
      })),

    replaceNodeData: (id, data) =>
      set((s) => ({
        nodes: s.nodes.map((n) => (n.id === id ? { ...n, data } : n)),
      })),

    updateMeta: (patch) => set((s) => ({ meta: { ...s.meta, ...patch } })),

    setSelected: (id) => set({ selectedId: id }),

    importYaml: (text) => {
      const snap = fromYaml(text); // throws -> nothing touched
      const laidOut = layoutGraph(snap.nodes, snap.edges);
      const { nodes, edges } = fromSnapshot({ ...snap, nodes: laidOut });
      set((s) => {
        const activeDoc = s.workflows.find((w) => w.id === s.activeId);
        const pristine =
          !activeDoc?.source
          && s.nodes.length === 0
          && JSON.stringify(s.meta) === JSON.stringify({ name: 'new-workflow' })
          && new RegExp('^new-workflow(-\\d+)?\\.yml$').test(s.activeFileName);
        const checkpointed = checkpoint(s);
        const others = pristine ? checkpointed.filter((w) => w.id !== s.activeId) : checkpointed;
        const fileName = defaultFileName(snap.meta.name, others.map((w) => w.fileName));
        const doc: WorkflowDoc = {
          id: pristine ? s.activeId : freshId('wf'),
          fileName, meta: snap.meta,
          nodes: laidOut, edges: snap.edges,
        };
        const workflows = pristine
          ? checkpointed.map((w) => (w.id === s.activeId ? doc : w))
          : [...checkpointed, doc];
        return {
          workflows,
          activeId: doc.id, activeFileName: fileName,
          meta: snap.meta, nodes, edges,
          selectedId: null,
          layoutStamp: s.layoutStamp + 1,
        };
      });
    },

    snapshot: () => {
      const { meta, nodes, edges } = get();
      return toSnapshot(meta, nodes, edges);
    },

    autoLayout: () => {
      const snap = get().snapshot();
      const laidOut = layoutGraph(snap.nodes, snap.edges);
      set((s) => ({ nodes: fromSnapshot({ ...snap, nodes: laidOut }).nodes, layoutStamp: s.layoutStamp + 1 }));
    },

    reset: () =>
      set((s) => {
        const otherNames = s.workflows.filter((w) => w.id !== s.activeId).map((w) => w.fileName);
        const doc = { ...freshDoc(otherNames), id: s.activeId };
        return {
          workflows: s.workflows.map((w) => (w.id === s.activeId ? doc : w)),
          ...docFields(doc),
          layoutStamp: s.layoutStamp + 1,
        };
      }),

    addWorkflow: () => {
      const doc = freshDoc([]);
      set((s) => {
        const checkpointed = checkpoint(s);
        const named = { ...doc, fileName: defaultFileName('new-workflow', checkpointed.map((w) => w.fileName)) };
        return {
          workflows: [...checkpointed, named],
          ...docFields(named),
          layoutStamp: s.layoutStamp + 1,
        };
      });
      return doc.id;
    },

    switchWorkflow: (id) =>
      set((s) => {
        if (id === s.activeId) return {};
        const checkpointed = checkpoint(s);
        const target = checkpointed.find((w) => w.id === id);
        if (!target) return {};
        return {
          workflows: checkpointed,
          ...docFields(target),
          layoutStamp: s.layoutStamp + 1,
        };
      }),

    closeWorkflow: (id) =>
      set((s) => {
        const idx = s.workflows.findIndex((w) => w.id === id);
        if (idx === -1) return {};
        if (id !== s.activeId) {
          return { workflows: s.workflows.filter((w) => w.id !== id) };
        }
        const remaining = s.workflows.filter((w) => w.id !== id);
        const next = remaining[Math.min(idx, remaining.length - 1)]
          ?? freshDoc([]);
        const workflows = remaining.length ? remaining : [next];
        return {
          workflows,
          ...docFields(next),
          layoutStamp: s.layoutStamp + 1,
        };
      }),

    setFileName: (name) => set({ activeFileName: name.trim() }),

    openFromFile: (root, path, fileText, mtimeMs) => {
      const snap = fromYaml(fileText); // throws → caller shows the viewer; nothing set
      const laidOut = layoutGraph(snap.nodes, snap.edges);
      set((s) => {
        const checkpointed = checkpoint(s);
        const existing = checkpointed.find((w) => w.source && w.source.root === root && w.source.path === path);
        if (existing) {
          const result = diskChangeDoc(existing, fileText, mtimeMs);
          const nextDoc = result.kind === 'none' ? existing : result.doc;
          return {
            workflows: checkpointed.map((w) => (w.id === existing.id ? nextDoc : w)),
            ...docFields(nextDoc),
            layoutStamp: s.layoutStamp + 1,
          };
        }
        const doc: WorkflowDoc = {
          id: freshId('wf'),
          fileName: path.slice(path.lastIndexOf('/') + 1), // basename verbatim (no uniquing)
          meta: snap.meta, nodes: laidOut, edges: snap.edges,
          source: { root, path, diskHash: hashText(fileText) },
          sourceRt: {
            baseline: toYaml(snap), conflict: false, detached: false, mtimeMs,
            hadComments: /^\s*#/m.test(fileText),
          },
        };
        return {
          workflows: [...checkpointed, doc],
          ...docFields(doc),
          layoutStamp: s.layoutStamp + 1,
        };
      });
    },

    applyDiskChange: (docId, fileText, mtimeMs) =>
      set((s) => {
        const checkpointed = checkpoint(s);
        const idx = checkpointed.findIndex((w) => w.id === docId);
        if (idx === -1) return {};
        const result = diskChangeDoc(checkpointed[idx], fileText, mtimeMs);
        if (result.kind === 'none') return {};
        const workflows = checkpointed.map((w, i) => (i === idx ? result.doc : w));
        if (docId !== s.activeId || result.kind === 'flags') return { workflows };
        // active doc, clean reload → re-check-out content; keep selection if it survives
        const { nodes, edges } = fromSnapshot(result.doc);
        const keepSel = s.selectedId && nodes.some((n) => n.id === s.selectedId) ? s.selectedId : null;
        return {
          workflows,
          meta: result.doc.meta, nodes, edges,
          activeFileName: result.doc.fileName,
          selectedId: keepSel,
          layoutStamp: result.identityChanged ? s.layoutStamp + 1 : s.layoutStamp,
        };
      }),

    bindSaved: (docId, canonicalText, mtimeMs) =>
      set((s) => {
        const checkpointed = checkpoint(s);
        const idx = checkpointed.findIndex((w) => w.id === docId);
        if (idx === -1) return {};
        const doc = checkpointed[idx];
        if (!doc.source || !doc.sourceRt) return {};
        const updated: WorkflowDoc = {
          ...doc,
          source: { ...doc.source, diskHash: hashText(canonicalText) },
          sourceRt: { ...doc.sourceRt, baseline: canonicalText, conflict: false, detached: false, mtimeMs, hadComments: false },
        };
        return { workflows: checkpointed.map((w, i) => (i === idx ? updated : w)) };
      }),

    composeStorage: () => {
      const s = get();
      return { version: 2, activeId: s.activeId, workflows: checkpoint(s) };
    },
  };
});

// Autosave: persist every state change (cheap; graphs are small).
//
// Multiple instances of this app (tabs/windows) can share one localStorage
// key. A naive "overwrite the whole payload" write would let a second,
// stale instance clobber tabs the first instance owns. To avoid that we
// union-merge on every write: our own tabs always win (we're the source of
// truth for them), foreign tabs — ones this instance has never created or
// loaded — are preserved verbatim, and a tab this instance actually closed
// is dropped even if it still lingers in storage.
const seenIds = new Set<string>(useEditor.getState().workflows.map((w) => w.id));

useEditor.subscribe(() => {
  try {
    const state = useEditor.getState();
    const own = state.composeStorage();
    const strip = (w: WorkflowDoc): WorkflowDoc => {
      const { sourceRt: _drop, ...rest } = w;
      return rest;
    };
    const ownIds = new Set(own.workflows.map((w) => w.id));
    const stored = parseStorage(globalThis.localStorage?.getItem(STORAGE_KEY_V2) ?? null, null);
    const foreign = (stored?.workflows ?? []).filter((w) => !ownIds.has(w.id) && !seenIds.has(w.id));
    ownIds.forEach((id) => seenIds.add(id));
    globalThis.localStorage?.setItem(
      STORAGE_KEY_V2,
      JSON.stringify({ version: 2, activeId: own.activeId, workflows: [...own.workflows.map(strip), ...foreign.map(strip)] }),
    );
  } catch {
    // quota/private mode: degrade silently
  }
});
