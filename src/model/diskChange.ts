import { fromYaml } from './fromYaml';
import { toYaml } from './toYaml';
import { layoutGraph } from './layout';
import { hashText } from './hash';
import type { GraphNode, WorkflowDoc } from './types';

export function mergePositions(
  current: GraphNode[],
  laidOut: GraphNode[],
): { nodes: GraphNode[]; identityChanged: boolean } {
  const posById = new Map(current.map((n) => [n.id, n.position]));
  const nodes = laidOut.map((n) => (posById.has(n.id) ? { ...n, position: posById.get(n.id)! } : n));
  const currentIds = new Set(current.map((n) => n.id));
  const identityChanged = current.length !== laidOut.length || laidOut.some((n) => !currentIds.has(n.id));
  return { nodes, identityChanged };
}

export type DiskChange =
  | { kind: 'none' }
  | { kind: 'flags'; doc: WorkflowDoc }
  | { kind: 'reload'; doc: WorkflowDoc; identityChanged: boolean };

// A bound doc restored from localStorage has `source` but no `sourceRt` (runtime-only,
// stripped on persist). The reconcile-on-open pass must rebuild sourceRt from disk so the
// tab is linked again — without this the doc is permanently ⛓ (can't save, no conflict
// detection). We never replace the persisted canvas here (it is the user's last state);
// we only re-establish the binding, flagging a conflict if the disk changed while the app
// was closed AND the canvas diverges from it.
function reinitSourceRt(
  doc: WorkflowDoc,
  src: NonNullable<WorkflowDoc['source']>,
  fileText: string | null,
  mtimeMs: number,
): DiskChange {
  const current = toYaml({ meta: doc.meta, nodes: doc.nodes, edges: doc.edges });
  if (fileText === null) {
    // bound file is gone on disk — detached, baseline = the canvas we still hold
    // no disk text to read (file gone) — fall back to the canvas, same as baseline above
    return { kind: 'flags', doc: { ...doc, sourceRt: { baseline: current, conflict: false, detached: true, mtimeMs, diskText: current } } };
  }
  const newHash = hashText(fileText);
  let baseline: string;
  try { baseline = toYaml(fromYaml(fileText)); }
  catch {
    // disk became unparseable while offline — keep the canvas, flag conflict
    return { kind: 'flags', doc: { ...doc, source: { ...src, diskHash: newHash }, sourceRt: { baseline: current, conflict: true, detached: false, mtimeMs, diskText: fileText } } };
  }
  const conflict = newHash !== src.diskHash && current !== baseline; // offline external edit vs a diverging canvas
  return {
    kind: 'flags',
    doc: { ...doc, source: { ...src, diskHash: newHash }, sourceRt: { baseline, conflict, detached: false, mtimeMs, diskText: fileText } },
  };
}

export function diskChangeDoc(doc: WorkflowDoc, fileText: string | null, mtimeMs: number): DiskChange {
  const src = doc.source;
  const rt = doc.sourceRt;
  if (!src) return { kind: 'none' };          // unbound doc — nothing to reconcile
  if (!rt) return reinitSourceRt(doc, src, fileText, mtimeMs); // reboot: sourceRt was stripped on persist
  if (mtimeMs < rt.mtimeMs) return { kind: 'none' }; // monotonic guard (out-of-order fetch)
  if (fileText === null) {
    return { kind: 'flags', doc: { ...doc, sourceRt: { ...rt, detached: true } } };
  }
  const newHash = hashText(fileText);
  if (newHash === src.diskHash) {
    // identical-recreate trap: clear detached, advance mtime. Only clear conflict if the disk
    // text now matches baseline — a duplicate event for still-conflicting content must not
    // silently clear the flag while the canvas still diverges from baseline.
    const conflict = rt.conflict && fileText !== rt.baseline;
    return { kind: 'flags', doc: { ...doc, sourceRt: { ...rt, detached: false, conflict, mtimeMs, diskText: fileText } } };
  }
  const current = toYaml({ meta: doc.meta, nodes: doc.nodes, edges: doc.edges });
  const dirty = current !== rt.baseline;
  if (dirty) {
    return {
      kind: 'flags',
      doc: { ...doc, source: { ...src, diskHash: newHash }, sourceRt: { ...rt, conflict: true, detached: false, mtimeMs, diskText: fileText } },
    };
  }
  let snap;
  try { snap = fromYaml(fileText); } catch {
    return {
      kind: 'flags',
      doc: { ...doc, source: { ...src, diskHash: newHash }, sourceRt: { ...rt, conflict: true, detached: false, mtimeMs, diskText: fileText } },
    };
  }
  const laidOut = layoutGraph(snap.nodes, snap.edges);
  const { nodes, identityChanged } = mergePositions(doc.nodes, laidOut);
  return {
    kind: 'reload',
    doc: {
      ...doc, meta: snap.meta, nodes, edges: snap.edges,
      source: { ...src, diskHash: newHash },
      sourceRt: { ...rt, baseline: toYaml(snap), conflict: false, detached: false, mtimeMs, diskText: fileText },
    },
    identityChanged,
  };
}
