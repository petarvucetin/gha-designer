import { slugify } from '../lib/exportYaml';
import { uniqueName } from './mapping';
import type { WorkflowDoc } from './types';
import { freshId } from './types';

export const STORAGE_KEY_V2 = 'gha-designer:v2';
export const STORAGE_KEY_V1 = 'gha-designer:v1';

export type StorageV2 = { version: 2; activeId: string; workflows: WorkflowDoc[] };

const stem = (fileName: string) => fileName.replace(/\.(yml|yaml)$/, '');

export function defaultFileName(name: string, taken: Iterable<string>): string {
  return `${uniqueName(slugify(name), [...taken].map(stem))}.yml`;
}

function isRecordLike(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isValidNode(n: unknown): boolean {
  return isRecordLike(n)
    && typeof n.id === 'string'
    && isRecordLike(n.position)
    && isRecordLike(n.data)
    && typeof (n.data as Record<string, unknown>).kind === 'string';
}

function isValidEdge(e: unknown): boolean {
  return isRecordLike(e)
    && typeof e.id === 'string'
    && typeof e.source === 'string'
    && typeof e.target === 'string';
}

function isValidDoc(d: unknown): d is WorkflowDoc {
  return isRecordLike(d)
    && typeof d.id === 'string'
    && typeof d.fileName === 'string'
    && isRecordLike(d.meta)
    && typeof (d.meta as Record<string, unknown>).name === 'string'
    && Array.isArray(d.nodes)
    && d.nodes.every(isValidNode)
    && Array.isArray(d.edges)
    && d.edges.every(isValidEdge);
}

function isLegacySnapshot(v: unknown): v is { meta: { name: string }; nodes: WorkflowDoc['nodes']; edges: WorkflowDoc['edges'] } {
  return isRecordLike(v)
    && isRecordLike(v.meta)
    && typeof (v.meta as Record<string, unknown>).name === 'string'
    && Array.isArray(v.nodes)
    && v.nodes.every(isValidNode)
    && Array.isArray(v.edges)
    && v.edges.every(isValidEdge);
}

function safeParse(raw: string | null): unknown {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function parseStorage(v2raw: string | null, v1raw: string | null): StorageV2 | null {
  const v2 = safeParse(v2raw);
  if (isRecordLike(v2) && v2.version === 2 && Array.isArray(v2.workflows)) {
    const workflows = v2.workflows.filter(isValidDoc).map((w) => {
      const { sourceRt: _drop, ...rest } = w as WorkflowDoc;
      return rest as WorkflowDoc;
    });
    if (workflows.length) {
      const activeId = typeof v2.activeId === 'string' && workflows.some((w) => w.id === v2.activeId)
        ? v2.activeId
        : workflows[0].id;
      return { version: 2, activeId, workflows };
    }
    return null;
  }
  const v1 = safeParse(v1raw);
  if (isLegacySnapshot(v1)) {
    const docBase: Omit<WorkflowDoc, 'id'> = {
      fileName: defaultFileName(v1.meta.name, []),
      meta: v1.meta, nodes: v1.nodes, edges: v1.edges,
    };
    const id = freshId('wf');
    return { version: 2, activeId: id, workflows: [{ id, ...docBase }] };
  }
  return null;
}
