import { effectiveNameOf } from './effectiveName';
import { coerceScalar } from './mapping';
import type { GraphNode, WorkflowInput, WorkflowSecret } from './types';

export const LOCAL_USES_PREFIX = './.github/workflows/';
export const FILE_NAME_RE = /^[A-Za-z0-9._-]+\.(yml|yaml)$/;

export type LocalUsesParse =
  | { kind: 'local'; fileName: string }
  | { kind: 'invalid-local'; reason: 'ref' | 'subdir' | 'badname' }
  | { kind: 'remote' };

export function parseLocalUses(uses: string): LocalUsesParse {
  if ((uses.startsWith('./') || uses.startsWith('.\\')) && !uses.startsWith(LOCAL_USES_PREFIX)) {
    return { kind: 'invalid-local', reason: 'subdir' };
  }
  if (!uses.startsWith(LOCAL_USES_PREFIX)) return { kind: 'remote' };
  const rest = uses.slice(LOCAL_USES_PREFIX.length);
  if (rest.includes('@')) return { kind: 'invalid-local', reason: 'ref' };
  if (rest.includes('/') || rest.includes('\\')) return { kind: 'invalid-local', reason: 'subdir' };
  if (!FILE_NAME_RE.test(rest)) return { kind: 'invalid-local', reason: 'badname' };
  return { kind: 'local', fileName: rest };
}

export function localUsesPath(fileName: string): string {
  return LOCAL_USES_PREFIX + fileName;
}

export type CallTarget = {
  fileName: string;
  hasWorkflowCall: boolean;
  inputs: WorkflowInput[];
  secrets: WorkflowSecret[];
};

export function callTargetOf(fileName: string, doc: { nodes: GraphNode[] }): CallTarget {
  const call = doc.nodes.find(
    (n) => n.data.kind === 'trigger' && n.data.trigger === 'workflow_call',
  );
  const data = call && call.data.kind === 'trigger' ? call.data : undefined;
  return {
    fileName,
    hasWorkflowCall: !!call,
    inputs: data?.inputs ?? [],
    secrets: data?.secretsDecl ?? [],
  };
}

export function localCallsOf(doc: { nodes: GraphNode[] }): string[] {
  const out: string[] = [];
  for (const n of doc.nodes) {
    if (n.data.kind !== 'job' || typeof n.data.uses !== 'string') continue;
    const p = parseLocalUses(n.data.uses);
    if (p.kind === 'local') out.push(p.fileName);
  }
  return out;
}

export type CallContext = {
  fileName: string;
  fileNames: string[];
  targets: CallTarget[];
  calls: Record<string, string[]>;
  effectiveNames?: string[];
};

export function buildCallContext(
  docs: { fileName: string; nodes: GraphNode[]; source?: { path: string } }[],
  activeFileName: string,
): CallContext {
  return {
    fileName: activeFileName,
    fileNames: docs.map((d) => d.fileName),
    targets: docs.map((d) => callTargetOf(d.fileName, d)),
    calls: Object.fromEntries(docs.map((d) => [d.fileName, localCallsOf(d)])),
    effectiveNames: docs.map((d) => effectiveNameOf(d)).filter((n): n is string => n !== null),
  };
}

export function coerceForTarget(
  kv: Record<string, string>,
  target: CallTarget | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(kv)) {
    const declared = target?.inputs.find((i) => i.id === k)?.type;
    if (v.includes('${{') || declared === undefined) {
      out[k] = v.includes('${{') ? v : coerceScalar(v);
      continue;
    }
    if (declared === 'number') {
      const n = Number(v.trim());
      out[k] = v.trim() !== '' && Number.isFinite(n) ? n : v;
    } else if (declared === 'boolean') {
      out[k] = /^(true|false)$/i.test(v) ? v.toLowerCase() === 'true' : v;
    } else {
      out[k] = v; // string / choice / environment stay strings
    }
  }
  return out;
}
