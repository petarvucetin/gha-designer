import type { WorkflowDoc } from './types';

export type Marker = '' | '●' | '⚠' | '✂' | '⛓';

// live-bound = doc has source && folder open && folder.root === source.root && sourceRt present.
export function deriveMarker(
  doc: WorkflowDoc,
  folderRoot: string | null,
  currentYaml: string,
): { bound: boolean; live: boolean; marker: Marker } {
  if (!doc.source) return { bound: false, live: false, marker: '' };
  const live = folderRoot !== null && folderRoot === doc.source.root && !!doc.sourceRt;
  if (!live) return { bound: true, live: false, marker: '⛓' };
  const rt = doc.sourceRt!;
  if (rt.detached) return { bound: true, live: true, marker: '✂' };
  if (rt.conflict) return { bound: true, live: true, marker: '⚠' };
  if (currentYaml !== rt.baseline) return { bound: true, live: true, marker: '●' };
  return { bound: true, live: true, marker: '' };
}
