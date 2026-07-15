import { parseLocalUses } from './localUses';

export type UsesKind = 'run' | 'local' | 'docker' | 'marketplace';

/**
 * Classify a step's `uses:` value.
 * - no/empty uses → 'run' (a run: step, or an unset step)
 * - './…' or '.\…'  → 'local'      (a local action in the repo)
 * - 'docker://…'    → 'docker'     (a container action image)
 * - anything else   → 'marketplace' (owner/repo[/path]@ref — a remote/custom action)
 */
export function usesKind(uses?: string): UsesKind {
  const u = (uses ?? '').trim();
  if (!u) return 'run';
  if (u.startsWith('./') || u.startsWith('.\\')) return 'local';
  if (u.startsWith('docker://')) return 'docker';
  return 'marketplace';
}

/** Presentational label for each uses-kind tag (marketplace/remote actions are shown as "custom"). */
export const USES_TAG_LABEL: Record<UsesKind, string> = {
  run: '',
  local: 'local',
  docker: 'docker',
  marketplace: 'custom',
};

const REMOTE_WORKFLOW_RE = /\.github\/workflows\/[^/\\]+\.ya?ml(@|$)/;

/**
 * Classify a pasted `uses:` reference as a reusable-workflow ref or an action ref.
 * - workflow: a local workflow (`./.github/workflows/x.yml`, per parseLocalUses) OR a remote
 *   reusable-workflow path (`owner/repo/.github/workflows/x.yml@ref`).
 * - action: everything else (`owner/action@v4`, `owner/repo/path@ref`, `docker://…`, `./local-action`).
 */
export function classifyUsesRef(ref: string): 'action' | 'workflow' {
  const r = ref.trim();
  if (parseLocalUses(r).kind === 'local') return 'workflow';
  if (REMOTE_WORKFLOW_RE.test(r)) return 'workflow';
  return 'action';
}
