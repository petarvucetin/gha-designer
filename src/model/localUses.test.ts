import { describe, expect, it } from 'vitest';
import {
  buildCallContext, callTargetOf, coerceForTarget, localCallsOf, localUsesPath, parseLocalUses,
} from './localUses';
import type { GraphNode } from './types';

const trig = (data: Record<string, unknown>): GraphNode => ({
  id: 't', type: 'trigger', position: { x: 0, y: 0 },
  data: { kind: 'trigger', trigger: 'workflow_call', ...data } as GraphNode['data'],
});
const job = (uses?: string): GraphNode => ({
  id: `j${uses ?? ''}`, type: 'job', position: { x: 0, y: 0 },
  data: { kind: 'job', jobId: 'j', runsOn: '', steps: [], ...(uses !== undefined ? { uses } : {}) } as GraphNode['data'],
});

describe('parseLocalUses', () => {
  it('classifies local, remote and invalid-local forms', () => {
    expect(parseLocalUses('./.github/workflows/build.yml')).toEqual({ kind: 'local', fileName: 'build.yml' });
    expect(parseLocalUses('./.github/workflows/build.yaml')).toEqual({ kind: 'local', fileName: 'build.yaml' });
    expect(parseLocalUses('octo/repo/.github/workflows/x.yml@v1')).toEqual({ kind: 'remote' });
    expect(parseLocalUses('./.github/workflows/build.yml@main')).toEqual({ kind: 'invalid-local', reason: 'ref' });
    expect(parseLocalUses('./.github/workflows/ci/build.yml')).toEqual({ kind: 'invalid-local', reason: 'subdir' });
    expect(parseLocalUses('./.github/workflows/build.txt')).toEqual({ kind: 'invalid-local', reason: 'badname' });
    expect(parseLocalUses('')).toEqual({ kind: 'remote' });
  });

  it('round-trips through localUsesPath', () => {
    expect(parseLocalUses(localUsesPath('deploy.yml'))).toEqual({ kind: 'local', fileName: 'deploy.yml' });
  });

  it('near-miss relative paths (not exactly ./.github/workflows/) are invalid-local, not remote', () => {
    expect(parseLocalUses('./x.yml')).toEqual({ kind: 'invalid-local', reason: 'subdir' });
    expect(parseLocalUses('./github/workflows/x.yml')).toEqual({ kind: 'invalid-local', reason: 'subdir' });
  });
});

describe('callTargetOf / localCallsOf / buildCallContext', () => {
  it('derives the call surface from the workflow_call trigger', () => {
    const t = callTargetOf('b.yml', {
      nodes: [trig({ inputs: [{ id: 'env', required: true, type: 'string' }], secretsDecl: [{ id: 'tok', required: true }] })],
    });
    expect(t).toEqual({
      fileName: 'b.yml', hasWorkflowCall: true,
      inputs: [{ id: 'env', required: true, type: 'string' }],
      secrets: [{ id: 'tok', required: true }],
    });
    expect(callTargetOf('c.yml', { nodes: [] }).hasWorkflowCall).toBe(false);
  });

  it('collects local calls and builds the context', () => {
    const docs = [
      { fileName: 'a.yml', nodes: [job('./.github/workflows/b.yml'), job('octo/r/.github/workflows/x.yml@v1')] },
      { fileName: 'b.yml', nodes: [trig({})] },
    ];
    expect(localCallsOf(docs[0])).toEqual(['b.yml']);
    const ctx = buildCallContext(docs, 'a.yml');
    expect(ctx.fileName).toBe('a.yml');
    expect(ctx.fileNames).toEqual(['a.yml', 'b.yml']);
    expect(ctx.calls).toEqual({ 'a.yml': ['b.yml'], 'b.yml': [] });
    expect(ctx.targets.map((t) => t.fileName)).toEqual(['a.yml', 'b.yml']);
  });
});

describe('coerceForTarget', () => {
  const target = {
    fileName: 'b.yml', hasWorkflowCall: true,
    inputs: [
      { id: 'version', type: 'string' as const },
      { id: 'replicas', type: 'number' as const },
      { id: 'verbose', type: 'boolean' as const },
    ],
    secrets: [],
  };
  it('coerces by declared type; string inputs stay strings', () => {
    expect(coerceForTarget({ version: '3.1', replicas: '3', verbose: 'true' }, target))
      .toEqual({ version: '3.1', replicas: 3, verbose: true });
  });
  it('expressions and unknown keys fall back', () => {
    expect(coerceForTarget({ replicas: '${{ inputs.n }}', other: 'true' }, target))
      .toEqual({ replicas: '${{ inputs.n }}', other: true });
  });
  it('no target falls back to coerceScalar behavior', () => {
    expect(coerceForTarget({ a: '3.10', b: 'true' }, undefined)).toEqual({ a: '3.10', b: true });
  });
  it('accepts any finite numeric string for declared number inputs (no manufactured type errors)', () => {
    expect(coerceForTarget({ replicas: '3.10' }, target)).toEqual({ replicas: 3.1 });
    expect(coerceForTarget({ replicas: '007' }, target)).toEqual({ replicas: 7 });
  });
  it('boolean coercion is case-insensitive true/false only; anything else stays a string', () => {
    expect(coerceForTarget({ verbose: 'True' }, target)).toEqual({ verbose: true });
    expect(coerceForTarget({ verbose: 'FALSE' }, target)).toEqual({ verbose: false });
    expect(coerceForTarget({ verbose: 'yes' }, target)).toEqual({ verbose: 'yes' });
  });
});
