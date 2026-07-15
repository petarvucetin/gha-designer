import dagre from '@dagrejs/dagre';
import type { GraphEdge, GraphNode, NodeData } from './types';

const TRIGGER_W = 220;
const TRIGGER_H = 60;
const JOB_W = 320;
const JOB_BASE_H = 64;   // title + sub
const BADGE_H = 22;      // the conditional badges row (matrix/container/services/reusable)
const ROW_H = 22;
const MAX_ROWS = 14;     // matches the node-steps scroll cap
const WRAP_CHARS = 40;   // chars per row before an unnamed step wraps

// Mirrors JobNode's conditional badges div: rendered when any of these are set.
function hasBadgeRow(data: Extract<NodeData, { kind: 'job' }>): boolean {
  return data.uses !== undefined || !!data.strategy?.matrix || !!data.container || !!data.services;
}

export function estimateJobHeight(data: NodeData): number {
  if (data.kind !== 'job') return JOB_BASE_H; // triggers use TRIGGER_H via size(); defensive fallback
  const badge = hasBadgeRow(data) ? BADGE_H : 0;
  // Reusable jobs render the badges row plus a single workflow-ref row, never the step list.
  if (data.uses !== undefined) return JOB_BASE_H + badge + ROW_H;
  const steps = data.steps.slice(0, MAX_ROWS);
  let rows = steps.length;
  for (const s of steps) {
    // JobNode wraps every step label (overflow-wrap: anywhere), named or not, so count wrap
    // rows from whatever text is actually shown — the same fallback order JobNode uses.
    const label = s.name || s.uses || s.run?.split('\n')[0] || '';
    rows += Math.max(0, Math.ceil(label.length / WRAP_CHARS) - 1);
  }
  rows = Math.min(rows, MAX_ROWS);
  return JOB_BASE_H + badge + rows * ROW_H;
}

export function layoutGraph(nodes: GraphNode[], edges: GraphEdge[]): GraphNode[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 90, marginx: 40, marginy: 40 });
  g.setDefaultEdgeLabel(() => ({}));
  const size = (n: GraphNode) => (n.type === 'job'
    ? { width: JOB_W, height: estimateJobHeight(n.data) }
    : { width: TRIGGER_W, height: TRIGGER_H });
  for (const n of nodes) g.setNode(n.id, size(n));
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);
  return nodes.map((n) => {
    const pos = g.node(n.id);
    const { width, height } = size(n);
    return { ...n, position: { x: pos.x - width / 2, y: pos.y - height / 2 } };
  });
}
