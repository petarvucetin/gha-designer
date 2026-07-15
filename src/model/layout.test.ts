import { describe, expect, it } from 'vitest';
import { layoutGraph, estimateJobHeight } from './layout';
import type { GraphNode } from './types';

const nodes: GraphNode[] = [
  { id: 't', type: 'trigger', position: { x: 0, y: 0 }, data: { kind: 'trigger', trigger: 'push' } },
  { id: 'a', type: 'job', position: { x: 0, y: 0 }, data: { kind: 'job', jobId: 'a', runsOn: 'x', steps: [] } },
  { id: 'b', type: 'job', position: { x: 0, y: 0 }, data: { kind: 'job', jobId: 'b', runsOn: 'x', steps: [] } },
];
const edges = [
  { id: 'e1', source: 't', target: 'a' },
  { id: 'e2', source: 'a', target: 'b' },
];

describe('layoutGraph', () => {
  it('lays out left-to-right along dependencies', () => {
    const laid = layoutGraph(nodes, edges);
    const x = Object.fromEntries(laid.map((n) => [n.id, n.position.x]));
    expect(x.t).toBeLessThan(x.a);
    expect(x.a).toBeLessThan(x.b);
  });

  it('does not mutate input nodes', () => {
    layoutGraph(nodes, edges);
    expect(nodes[0].position).toEqual({ x: 0, y: 0 });
  });
});

describe('estimateJobHeight', () => {
  const job = (steps: { id: string; name?: string; run?: string; uses?: string }[]) =>
    ({ kind: 'job' as const, jobId: 'a', runsOn: 'x', steps });
  it('grows with step count, adds wrap rows for long unnamed steps, clamps at 14 rows', () => {
    expect(estimateJobHeight(job([]))).toBeLessThan(estimateJobHeight(job([{ id: 's', run: 'ls' }])));
    expect(estimateJobHeight(job([{ id: 's', run: 'x'.repeat(120) }])))
      .toBeGreaterThan(estimateJobHeight(job([{ id: 's', run: 'ls' }])));
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `s${i}`, run: 'ls' }));
    const capped = Array.from({ length: 14 }, (_, i) => ({ id: `s${i}`, run: 'ls' }));
    expect(estimateJobHeight(job(many))).toBe(estimateJobHeight(job(capped)));
  });
  it('reusable jobs stay compact', () => {
    expect(estimateJobHeight({ kind: 'job', jobId: 'a', runsOn: '', steps: [], uses: './x.yml' }))
      .toBeLessThan(estimateJobHeight(job([{ id: 's', run: 'ls' }, { id: 't', run: 'ls' }, { id: 'u', run: 'ls' }])));
  });
  it('counts the badges row so a matrix job is taller than the same job without it', () => {
    const plain = job([{ id: 's', run: 'ls' }]);
    const withMatrix = { ...plain, strategy: { matrix: { vars: { os: ['ubuntu-latest'] } } } };
    expect(estimateJobHeight(withMatrix)).toBeGreaterThan(estimateJobHeight(plain));
  });
});

describe('layoutGraph no-overlap', () => {
  it('two parallel 12-step jobs do not overlap vertically', () => {
    const steps = Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, run: 'echo hi' }));
    const nodes: GraphNode[] = [
      { id: 't', type: 'trigger', position: { x: 0, y: 0 }, data: { kind: 'trigger', trigger: 'push' } },
      { id: 'a', type: 'job', position: { x: 0, y: 0 }, data: { kind: 'job', jobId: 'a', runsOn: 'x', steps } },
      { id: 'b', type: 'job', position: { x: 0, y: 0 }, data: { kind: 'job', jobId: 'b', runsOn: 'x', steps } },
    ];
    const laid = layoutGraph(nodes, [
      { id: 'e1', source: 't', target: 'a' }, { id: 'e2', source: 't', target: 'b' },
    ]);
    const A = laid.find((n) => n.id === 'a')!;
    const B = laid.find((n) => n.id === 'b')!;
    const [top, bottom] = A.position.y < B.position.y ? [A, B] : [B, A];
    const hTop = estimateJobHeight(top.data);
    expect(bottom.position.y).toBeGreaterThanOrEqual(top.position.y + hTop); // gap ≥ top node height
  });
});
