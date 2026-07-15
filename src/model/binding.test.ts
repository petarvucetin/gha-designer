import { describe, expect, it } from 'vitest';
import { deriveMarker } from './binding';
import type { WorkflowDoc } from './types';

const base: WorkflowDoc = { id: 'i', fileName: 'ci.yml', meta: { name: 'x' }, nodes: [], edges: [] };
const bound = (over: Partial<NonNullable<WorkflowDoc['sourceRt']>> = {}): WorkflowDoc => ({
  ...base,
  source: { root: 'R', path: 'workflows/ci.yml', diskHash: 'h' },
  sourceRt: { baseline: 'BASE', conflict: false, detached: false, mtimeMs: 1, hadComments: false, ...over },
});

describe('deriveMarker', () => {
  it('unbound → no marker', () => {
    expect(deriveMarker(base, 'R', 'BASE')).toEqual({ bound: false, live: false, marker: '' });
  });
  it('bound but folder closed/different → unlinked ⛓', () => {
    expect(deriveMarker(bound(), null, 'BASE').marker).toBe('⛓');
    expect(deriveMarker(bound(), 'OTHER', 'BASE').marker).toBe('⛓');
  });
  it('live: detached ✂ > conflict ⚠ > dirty ● > clean ""', () => {
    expect(deriveMarker(bound({ detached: true }), 'R', 'BASE').marker).toBe('✂');
    expect(deriveMarker(bound({ conflict: true }), 'R', 'BASE').marker).toBe('⚠');
    expect(deriveMarker(bound(), 'R', 'CHANGED').marker).toBe('●');
    expect(deriveMarker(bound(), 'R', 'BASE').marker).toBe('');
  });
});
