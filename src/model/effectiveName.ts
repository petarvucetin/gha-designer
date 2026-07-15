import { toYaml } from './toYaml';
import type { WorkflowDoc } from './types';

// GitHub resolves local reusable workflows only from ./.github/workflows/*.
const WORKFLOWS_RE = /^workflows\/[^/]+\.ya?ml$/;

export function effectiveNameOf(doc: { fileName: string; source?: { path: string } }): string | null {
  if (doc.source) {
    return WORKFLOWS_RE.test(doc.source.path)
      ? doc.source.path.slice(doc.source.path.lastIndexOf('/') + 1)
      : null;
  }
  return doc.fileName;
}

export function runTargetError(doc: WorkflowDoc): string | null {
  if (doc.source && effectiveNameOf(doc) === null) {
    return `${doc.fileName} isn't in .github/workflows — GitHub can't run it. Move it there first.`;
  }
  return null;
}

export type RunComposition = { error: string } | { workflows: { fileName: string; yaml: string }[] };

export function composeRunWorkflows(docs: WorkflowDoc[]): RunComposition {
  const included = docs
    .map((doc) => ({ doc, name: effectiveNameOf(doc) }))
    .filter((x): x is { doc: WorkflowDoc; name: string } => x.name !== null);
  const counts = new Map<string, number>();
  for (const { name } of included) counts.set(name, (counts.get(name) ?? 0) + 1);
  const dupes = [...counts].filter(([, n]) => n > 1).map(([name]) => name);
  if (dupes.length) {
    return { error: `Two open workflows resolve to the same file: ${dupes.join(', ')}. Rename or close one before running.` };
  }
  return {
    workflows: included.map(({ doc, name }) => ({
      fileName: name,
      yaml: toYaml({ meta: doc.meta, nodes: doc.nodes, edges: doc.edges }),
    })),
  };
}
