import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { updateYaml, deepEqual } from './updateYaml';
import { fromYaml } from './fromYaml';
import { toYaml } from './toYaml';
import type { GraphSnapshot, JobData } from './types';

const ORIG = `# CI pipeline for the widget service
name: CI
on:
  push:
    branches: [main] # trunk only
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      # pinned for provenance (see SEC-142)
      - uses: actions/checkout@v4
      - run: npm test
`;

/** Parse ORIG into a model, optionally mutate it, and run updateYaml. */
function roundTrip(mutate?: (s: GraphSnapshot) => void): string {
  const snap = fromYaml(ORIG);
  mutate?.(snap);
  return updateYaml(ORIG, snap);
}
function renameWorkflow(s: GraphSnapshot) { s.meta.name = 'CI2'; }
// NOTE: adapted from the brief's sketch — `n.data` for a job node is already
// `JobData` (see src/model/types.ts), so no extra cast is needed here, and the
// pushed step literals below satisfy `Step` (only `id` is required) without
// the brief's `as never` escape hatch.
function jobNode(s: GraphSnapshot): JobData {
  const n = s.nodes.find((n) => n.data.kind === 'job');
  if (!n) throw new Error('no job node');
  return n.data as JobData;
}

describe('deepEqual', () => {
  it('is key-order-insensitive for objects', () => {
    expect(deepEqual({ a: 1, b: [2, 3] }, { b: [2, 3], a: 1 })).toBe(true);
  });
  it('distinguishes value and shape differences', () => {
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
  });
});

describe('updateYaml', () => {
  it('no model change: every comment survives', () => {
    const out = roundTrip();
    expect(out).toContain('# CI pipeline for the widget service');
    expect(out).toContain('# trunk only');
    expect(out).toContain('# pinned for provenance (see SEC-142)');
  });
  it('scalar edit keeps unrelated comments and applies the change', () => {
    const out = roundTrip(renameWorkflow);
    expect(parse(out).name).toBe('CI2');
    expect(out).toContain('# pinned for provenance (see SEC-142)');
    expect(out).toContain('# trunk only');
  });
  it('appending a step keeps comments on earlier steps', () => {
    const out = roundTrip((s) => { jobNode(s).steps.push({ id: 'x', run: 'npm run lint' }); });
    expect(out).toContain('# pinned for provenance (see SEC-142)');
    expect(parse(out).jobs.build.steps).toHaveLength(3);
  });
  it('deleting the LAST step keeps the first step and its comment', () => {
    const out = roundTrip((s) => { jobNode(s).steps.pop(); });
    expect(out).toContain('# pinned for provenance (see SEC-142)');
    expect(parse(out).jobs.build.steps).toHaveLength(1);
  });
  // Characterization test: index-based array reconciliation means deleting
  // steps[0] rewrites item 0 in place and drops the tail, so a comment that
  // preceded the deleted step stays at its position and ends up attached to
  // the step that slid into it. Pinned so a refactor can't change this
  // silently — if this test breaks, the comment-shift semantics changed.
  it('KNOWN LIMITATION: deleting the first step shifts its comment onto the next step', () => {
    const snap = fromYaml(ORIG);
    jobNode(snap).steps.shift();
    const out = updateYaml(ORIG, snap);
    // The comment survives, but now sits directly above the remaining step.
    expect(out).toMatch(/# pinned for provenance \(see SEC-142\)\n\s*- run: npm test/);
    expect(parse(out).jobs.build.steps).toEqual([{ run: 'npm test' }]);
    // Round-trip invariant still holds: output parses to exactly the saved model.
    expect(toYaml(fromYaml(out))).toBe(toYaml(snap));
  });
  it('preserves original top-level key order even though buildDoc order differs', () => {
    const out = roundTrip(renameWorkflow);
    const idx = (k: string) => out.indexOf(`${k}:`);
    expect(idx('name')).toBeGreaterThanOrEqual(0);
    expect(idx('name')).toBeLessThan(idx('on'));
    expect(idx('on')).toBeLessThan(idx('jobs'));
  });
  it('falls back to canonical toYaml on unparseable input', () => {
    const snap = fromYaml(ORIG);
    expect(updateYaml('{{{ not yaml', snap)).toBe(toYaml(snap));
    expect(updateYaml('just a scalar', snap)).toBe(toYaml(snap));
  });
  it('round-trip invariant: preserved output parses to exactly the saved model', () => {
    const cases: Array<((s: GraphSnapshot) => void) | undefined> = [
      undefined,
      renameWorkflow,
      (s) => { jobNode(s).steps.pop(); },
      (s) => { jobNode(s).steps.push({ id: 'x', run: 'echo hi' }); },
    ];
    for (const mutate of cases) {
      const snap = fromYaml(ORIG);
      mutate?.(snap);
      const out = updateYaml(ORIG, snap);
      expect(toYaml(fromYaml(out))).toBe(toYaml(snap));
    }
  });
});
