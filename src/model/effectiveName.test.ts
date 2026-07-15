import { describe, expect, it } from 'vitest';
import { composeRunWorkflows, effectiveNameOf, runTargetError } from './effectiveName';
import type { WorkflowDoc } from './types';

const doc = (over: Partial<WorkflowDoc>): WorkflowDoc => ({
  id: 'i', fileName: 'draft.yml', meta: { name: 'x' }, nodes: [], edges: [], ...over,
});

describe('effectiveNameOf', () => {
  it('unbound → fileName', () => {
    expect(effectiveNameOf(doc({ fileName: 'ci.yml' }))).toBe('ci.yml');
  });
  it('bound in workflows/ → basename; bound elsewhere or nested → null', () => {
    expect(effectiveNameOf(doc({ source: { root: 'R', path: 'workflows/ci.yml', diskHash: 'h' } }))).toBe('ci.yml');
    expect(effectiveNameOf(doc({ source: { root: 'R', path: 'action.yml', diskHash: 'h' } }))).toBeNull();
    expect(effectiveNameOf(doc({ source: { root: 'R', path: 'workflows/sub/ci.yml', diskHash: 'h' } }))).toBeNull();
  });
});

describe('runTargetError', () => {
  it('bound outside .github/workflows → error naming the file', () => {
    const err = runTargetError(doc({ fileName: 'action.yml', source: { root: 'R', path: 'action.yml', diskHash: 'h' } }));
    expect(err).toMatch(/isn't in \.github\/workflows/);
  });
  it('bound inside workflows/ or unbound → null', () => {
    expect(runTargetError(doc({ source: { root: 'R', path: 'workflows/ci.yml', diskHash: 'h' } }))).toBeNull();
    expect(runTargetError(doc({ fileName: 'draft.yml' }))).toBeNull();
  });
});

describe('composeRunWorkflows', () => {
  it('errors on duplicate effective names and excludes null-effective docs', () => {
    const bound = doc({ id: 'a', fileName: 'ci.yml', source: { root: 'R', path: 'workflows/ci.yml', diskHash: 'h' } });
    const dupe = doc({ id: 'b', fileName: 'ci.yml' });
    const excluded = doc({ id: 'c', source: { root: 'R', path: 'action.yml', diskHash: 'h' } });
    const r = composeRunWorkflows([bound, dupe, excluded]);
    expect('error' in r && /same file/.test(r.error)).toBe(true);
  });
  it('composes included docs keyed by effective name', () => {
    const bound = doc({
      id: 'a', fileName: 'ci.yml', source: { root: 'R', path: 'workflows/ci.yml', diskHash: 'h' },
      nodes: [{ id: 'trigger:push', type: 'trigger', position: { x: 0, y: 0 }, data: { kind: 'trigger', trigger: 'push' } }],
    });
    const r = composeRunWorkflows([bound]);
    expect('workflows' in r && r.workflows[0].fileName).toBe('ci.yml');
    expect('workflows' in r && /on:/.test(r.workflows[0].yaml)).toBe(true);
  });
});
