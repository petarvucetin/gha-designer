import { describe, expect, it } from 'vitest';
import { validate, wouldCreateCycle } from './validate';
import type { GraphSnapshot, GraphNode } from './types';
import type { CallContext } from './localUses';

function job(id: string, over: Partial<Extract<GraphNode['data'], { kind: 'job' }>> = {}): GraphNode {
  return {
    id: `job:${id}`, type: 'job', position: { x: 0, y: 0 },
    data: { kind: 'job', jobId: id, runsOn: 'ubuntu-latest', steps: [{ id: 's', run: 'ls' }], ...over },
  };
}

function snap(nodes: GraphNode[], edges: GraphSnapshot['edges'] = []): GraphSnapshot {
  return { meta: { name: 'CI' }, nodes, edges };
}

describe('validate', () => {
  it('accepts a valid graph', () => {
    const push: GraphNode = {
      id: 'trigger:push', type: 'trigger', position: { x: 0, y: 0 }, data: { kind: 'trigger', trigger: 'push' },
    };
    expect(validate(snap([push, job('a')]))).toEqual([]);
  });

  it('flags duplicate job ids', () => {
    const problems = validate(snap([job('a'), { ...job('a'), id: 'job:a2' }]));
    expect(problems.some((p) => p.severity === 'error' && /duplicate/i.test(p.message))).toBe(true);
  });

  it('flags missing runs-on and empty steps', () => {
    const problems = validate(snap([job('a', { runsOn: '', steps: [] })]));
    expect(problems.some((p) => /runs-on/.test(p.message))).toBe(true);
    expect(problems.some((p) => /no steps/i.test(p.message))).toBe(true);
  });

  it('flags steps with both or neither uses/run', () => {
    const problems = validate(snap([
      job('a', { steps: [{ id: '1', uses: 'x@v1', run: 'ls' }, { id: '2' }] }),
    ]));
    expect(problems.filter((p) => /uses.*run|run.*uses/i.test(p.message))).toHaveLength(2);
  });

  it('flags schedule trigger without cron', () => {
    const problems = validate(snap([{
      id: 'trigger:schedule', type: 'trigger', position: { x: 0, y: 0 },
      data: { kind: 'trigger', trigger: 'schedule' },
    }]));
    expect(problems.some((p) => /cron/i.test(p.message))).toBe(true);
  });

  it('flags needs cycles', () => {
    const problems = validate(snap(
      [job('a'), job('b')],
      [
        { id: 'e1', source: 'job:a', target: 'job:b' },
        { id: 'e2', source: 'job:b', target: 'job:a' },
      ],
    ));
    expect(problems.some((p) => /cycle/i.test(p.message))).toBe(true);
  });

  it('flags duplicate non-schedule triggers', () => {
    const problems = validate(snap([
      { id: 'trigger:push', type: 'trigger', position: { x: 0, y: 0 }, data: { kind: 'trigger', trigger: 'push' } },
      { id: 'trigger:push2', type: 'trigger', position: { x: 0, y: 0 }, data: { kind: 'trigger', trigger: 'push' } },
    ]));
    expect(problems.some((p) => p.severity === 'error' && /duplicate trigger/i.test(p.message))).toBe(true);
  });

  it('allows duplicate schedule triggers', () => {
    const problems = validate(snap([
      { id: 'trigger:schedule', type: 'trigger', position: { x: 0, y: 0 }, data: { kind: 'trigger', trigger: 'schedule', cron: '0 4 * * *' } },
      { id: 'trigger:schedule:1', type: 'trigger', position: { x: 0, y: 0 }, data: { kind: 'trigger', trigger: 'schedule', cron: '0 8 * * *' } },
    ]));
    expect(problems.some((p) => /duplicate trigger/i.test(p.message))).toBe(false);
  });

  it('warns when jobs exist but there are no triggers', () => {
    const problems = validate(snap([job('a')]));
    expect(problems.some((p) => p.severity === 'warning' && /no triggers/i.test(p.message))).toBe(true);
  });

  it('does not warn about missing triggers on an empty graph', () => {
    const problems = validate(snap([]));
    expect(problems.some((p) => /no triggers/i.test(p.message))).toBe(false);
  });
});

describe('wouldCreateCycle', () => {
  const edges = [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }];
  it('detects a back edge', () => {
    expect(wouldCreateCycle(edges, { source: 'c', target: 'a' })).toBe(true);
  });
  it('allows forward and unrelated edges', () => {
    expect(wouldCreateCycle(edges, { source: 'a', target: 'c' })).toBe(false);
    expect(wouldCreateCycle(edges, { source: 'x', target: 'y' })).toBe(false);
  });
  it('rejects self loops', () => {
    expect(wouldCreateCycle([], { source: 'a', target: 'a' })).toBe(true);
  });
});

describe('validate v2', () => {
  const trigger = (over: Record<string, unknown>) => snap([{
    id: 'trigger:x', type: 'trigger' as const, position: { x: 0, y: 0 },
    data: { kind: 'trigger' as const, trigger: 'push', ...over },
  }, job('a')].map((n, i) => (i === 1 ? { ...n } : n)));

  it('warns on unknown event names', () => {
    const p = validate(trigger({ trigger: 'not_an_event' }));
    expect(p.some((x) => x.severity === 'warning' && /unknown event/i.test(x.message))).toBe(true);
  });

  it('warns on cron without 5 fields', () => {
    const p = validate(trigger({ trigger: 'schedule', cron: '0 4 * *' }));
    expect(p.some((x) => /5 fields/.test(x.message))).toBe(true);
    expect(validate(trigger({ trigger: 'schedule', cron: '0 4 * * 1' }))
      .some((x) => /5 fields/.test(x.message))).toBe(false);
  });

  it('flags duplicate input ids and choice inputs without options', () => {
    const p = validate(trigger({
      trigger: 'workflow_dispatch',
      inputs: [{ id: 'env', type: 'choice' }, { id: 'env' }],
    }));
    expect(p.some((x) => /duplicate input/i.test(x.message))).toBe(true);
    expect(p.some((x) => /choice.*options/i.test(x.message))).toBe(true);
  });

  it('workflow_call inputs must declare type string/number/boolean; choice/environment/untyped are errors; dispatch is unaffected', () => {
    const untyped = validate(trigger({ trigger: 'workflow_call', inputs: [{ id: 'x' }] }));
    expect(untyped.some((x) => x.severity === 'error' && /workflow_call input "x"/i.test(x.message))).toBe(true);

    const choice = validate(trigger({
      trigger: 'workflow_call', inputs: [{ id: 'env', type: 'choice', options: ['a', 'b'] }],
    }));
    expect(choice.some((x) => x.severity === 'error' && /workflow_call input "env"/i.test(x.message))).toBe(true);

    const environment = validate(trigger({ trigger: 'workflow_call', inputs: [{ id: 'env', type: 'environment' }] }));
    expect(environment.some((x) => x.severity === 'error' && /workflow_call input "env"/i.test(x.message))).toBe(true);

    const validTypes = validate(trigger({
      trigger: 'workflow_call', inputs: [{ id: 'n', type: 'number' }, { id: 'b', type: 'boolean' }, { id: 's', type: 'string' }],
    }));
    expect(validTypes.some((x) => /workflow_call input/i.test(x.message))).toBe(false);

    const dispatchChoice = validate(trigger({
      trigger: 'workflow_dispatch', inputs: [{ id: 'env', type: 'choice', options: ['a', 'b'] }],
    }));
    expect(dispatchChoice.some((x) => /workflow_call input/i.test(x.message))).toBe(false);
  });

  it('reusable job: uses + steps/runs-on/container are errors; missing runs-on is NOT', () => {
    const p = validate(snap([{
      ...job('call'),
      data: {
        kind: 'job' as const, jobId: 'call', runsOn: 'ubuntu-latest',
        uses: 'o/r/.github/workflows/x.yml@v1',
        container: { image: 'node:18' },
        steps: [{ id: 's', run: 'ls' }],
      },
    }, { id: 'trigger:push', type: 'trigger' as const, position: { x: 0, y: 0 }, data: { kind: 'trigger' as const, trigger: 'push' } }]));
    expect(p.some((x) => /reusable.*steps/i.test(x.message))).toBe(true);
    expect(p.some((x) => /reusable.*runs-on/i.test(x.message))).toBe(true);
    expect(p.some((x) => /reusable.*container/i.test(x.message))).toBe(true);
    const ok = validate(snap([{
      ...job('call2'),
      data: { kind: 'job' as const, jobId: 'call2', runsOn: '', uses: 'o/r/.github/workflows/x.yml@v1', steps: [] },
    }, { id: 'trigger:push', type: 'trigger' as const, position: { x: 0, y: 0 }, data: { kind: 'trigger' as const, trigger: 'push' } }]));
    expect(ok).toEqual([]);
  });

  it('flags empty container image, bad matrix vars, empty concurrency group', () => {
    const p = validate(snap([{
      ...job('j'),
      data: {
        kind: 'job' as const, jobId: 'j', runsOn: 'ubuntu-latest',
        container: { image: ' ' },
        strategy: { matrix: { vars: { '': [1], os: [] } } },
        concurrency: { group: ' ' },
        steps: [{ id: 's', run: 'ls' }],
      },
    }, { id: 'trigger:push', type: 'trigger' as const, position: { x: 0, y: 0 }, data: { kind: 'trigger' as const, trigger: 'push' } }]));
    expect(p.some((x) => /container.*image/i.test(x.message))).toBe(true);
    expect(p.some((x) => /matrix variable/i.test(x.message))).toBe(true);
    expect(p.some((x) => /concurrency group/i.test(x.message))).toBe(true);
  });
});

describe('validate cross-tab (context)', () => {
  const caller = (uses: string, extraJob: Record<string, unknown> = {}) => snap([
    { id: 'trigger:push', type: 'trigger' as const, position: { x: 0, y: 0 }, data: { kind: 'trigger' as const, trigger: 'push' } },
    { ...job('call'), data: { kind: 'job' as const, jobId: 'call', runsOn: '', steps: [], uses, ...extraJob } },
  ]);

  const ctx = (over: Partial<CallContext> = {}): CallContext => ({
    fileName: 'a.yml',
    fileNames: ['a.yml', 'b.yml'],
    targets: [
      { fileName: 'a.yml', hasWorkflowCall: false, inputs: [], secrets: [] },
      {
        fileName: 'b.yml', hasWorkflowCall: true,
        inputs: [
          { id: 'env', required: true, type: 'string' },
          { id: 'replicas', type: 'number' },
        ],
        secrets: [{ id: 'tok', required: true }],
      },
    ],
    calls: { 'a.yml': ['b.yml'], 'b.yml': [] },
    ...over,
  });

  it('no context skips every cross-tab rule', () => {
    expect(validate(caller('./.github/workflows/nope.yml'))).toEqual([]);
  });

  it('flags an invalid active tab fileName', () => {
    expect(validate(caller('./.github/workflows/b.yml'), ctx({ fileName: '' }))
      .some((x) => x.severity === 'error' && /file name/i.test(x.message))).toBe(true);
    expect(validate(caller('./.github/workflows/b.yml'), ctx({ fileName: 'noext' }))
      .some((x) => x.severity === 'error' && /file name/i.test(x.message))).toBe(true);
    expect(validate(caller('./.github/workflows/b.yml'), ctx())
      .some((x) => x.severity === 'error' && /file name/i.test(x.message))).toBe(false);
  });

  it('flags duplicate fileNames across tabs', () => {
    const p = validate(caller('x/y/.github/workflows/z.yml@v1'), ctx({ fileNames: ['a.yml', 'a.yml'] }));
    expect(p.some((x) => x.severity === 'error' && /duplicate file ?name/i.test(x.message))).toBe(true);
  });

  it('warns when two tabs share an effective name', () => {
    const p = validate(caller('x/y/.github/workflows/z.yml@v1'), ctx({ effectiveNames: ['ci.yml', 'ci.yml'] }));
    expect(p.some((x) => x.severity === 'warning' && /same workflow file "ci.yml"/.test(x.message))).toBe(true);
  });

  it('invalid-local forms are errors with distinct messages', () => {
    expect(validate(caller('./.github/workflows/b.yml@main'), ctx())
      .some((x) => /@ref|ref on|same-repo/i.test(x.message) && x.severity === 'error')).toBe(true);
    expect(validate(caller('./.github/workflows/sub/b.yml'), ctx())
      .some((x) => /directly in(side)? \.github\/workflows/i.test(x.message) && x.severity === 'error')).toBe(true);
  });

  it('unresolved local target is a warning; resolved target without workflow_call is an error', () => {
    expect(validate(caller('./.github/workflows/ghost.yml'), ctx())
      .some((x) => x.severity === 'warning' && /not open in any tab/i.test(x.message))).toBe(true);
    expect(validate(caller('./.github/workflows/a.yml'), ctx({ calls: { 'a.yml': ['a.yml'], 'b.yml': [] } }))
      .some((x) => x.severity === 'error' && /workflow_call/.test(x.message))).toBe(true);
  });

  it('checks inputs: required missing, undeclared key, string-type mismatch both directions', () => {
    const base = './.github/workflows/b.yml';
    const missing = validate(caller(base, { with: { replicas: 2 }, secrets: 'inherit' }), ctx());
    expect(missing.some((x) => x.severity === 'error' && /required input "env"/i.test(x.message))).toBe(true);

    const undeclared = validate(caller(base, { with: { env: 'prod', bogus: 1 }, secrets: 'inherit' }), ctx());
    expect(undeclared.some((x) => x.severity === 'error' && /"bogus".*not defined|not declared/i.test(x.message))).toBe(true);

    const numToStr = validate(caller(base, { with: { env: 3.1, replicas: 2 }, secrets: 'inherit' }), ctx());
    expect(numToStr.some((x) => x.severity === 'error' && /"env".*string/i.test(x.message))).toBe(true);

    const strToNum = validate(caller(base, { with: { env: 'prod', replicas: 'two' }, secrets: 'inherit' }), ctx());
    expect(strToNum.some((x) => x.severity === 'error' && /"replicas".*number/i.test(x.message))).toBe(true);

    const expr = validate(caller(base, { with: { env: '${{ inputs.e }}', replicas: '${{ inputs.n }}' }, secrets: 'inherit' }), ctx());
    expect(expr.filter((x) => /replicas|env/.test(x.message) && x.severity === 'error')).toEqual([]);
  });

  it('checks secrets: required missing and undeclared keys are errors; inherit satisfies', () => {
    const base = './.github/workflows/b.yml';
    const missing = validate(caller(base, { with: { env: 'x' } }), ctx());
    expect(missing.some((x) => x.severity === 'error' && /secret "tok"/i.test(x.message))).toBe(true);
    const undeclared = validate(caller(base, { with: { env: 'x' }, secrets: { tok: 'v', extra: 'v' } }), ctx());
    expect(undeclared.some((x) => x.severity === 'error' && /"extra".*not (defined|declared)/i.test(x.message))).toBe(true);
    const inherit = validate(caller(base, { with: { env: 'x' }, secrets: 'inherit' }), ctx());
    expect(inherit.filter((x) => /secret/i.test(x.message))).toEqual([]);
  });

  it('flags call-graph cycles including self-calls, and deep nesting', () => {
    const selfCall = validate(caller('./.github/workflows/a.yml'), ctx({
      targets: [
        { fileName: 'a.yml', hasWorkflowCall: true, inputs: [], secrets: [] },
        { fileName: 'b.yml', hasWorkflowCall: true, inputs: [], secrets: [] },
      ],
      calls: { 'a.yml': ['a.yml'], 'b.yml': [] },
    }));
    expect(selfCall.some((x) => x.severity === 'error' && /cycle/i.test(x.message))).toBe(true);

    const cycle = validate(caller('./.github/workflows/b.yml', { secrets: 'inherit' }), ctx({
      targets: [
        { fileName: 'a.yml', hasWorkflowCall: true, inputs: [], secrets: [] },
        { fileName: 'b.yml', hasWorkflowCall: true, inputs: [], secrets: [] },
      ],
      calls: { 'a.yml': ['b.yml'], 'b.yml': ['a.yml'] },
    }));
    expect(cycle.some((x) => x.severity === 'error' && /cycle/i.test(x.message))).toBe(true);

    // A 5-level chain is well within GitHub's 10-level limit and must NOT warn.
    const shallow = validate(caller('./.github/workflows/b.yml', { secrets: 'inherit' }), ctx({
      fileNames: ['a.yml', 'b.yml', 'c.yml', 'd.yml', 'e.yml'],
      targets: ['a.yml', 'b.yml', 'c.yml', 'd.yml', 'e.yml'].map((f) => (
        { fileName: f, hasWorkflowCall: true, inputs: [], secrets: [] })),
      calls: { 'a.yml': ['b.yml'], 'b.yml': ['c.yml'], 'c.yml': ['d.yml'], 'd.yml': ['e.yml'], 'e.yml': [] },
    }));
    expect(shallow.some((x) => x.severity === 'warning' && /nest|deep/i.test(x.message))).toBe(false);

    // 11 levels exceeds GitHub's (Nov 2025) limit of 10.
    const chain = Array.from({ length: 11 }, (_, i) => `n${i}.yml`);
    const chainCalls: Record<string, string[]> = {};
    chain.forEach((f, i) => { chainCalls[f] = i + 1 < chain.length ? [chain[i + 1]] : []; });
    const deep = validate(caller(`./.github/workflows/${chain[1]}`, { secrets: 'inherit' }), ctx({
      fileName: chain[0],
      fileNames: chain,
      targets: chain.map((f) => ({ fileName: f, hasWorkflowCall: true, inputs: [], secrets: [] })),
      calls: chainCalls,
    }));
    expect(deep.some((x) => x.severity === 'warning' && /nest.*10/i.test(x.message))).toBe(true);
  });

  it('does not warn at exactly 50 called workflows (GitHub-legal)', () => {
    const leaves = Array.from({ length: 50 }, (_, i) => `w${i}.yml`);
    const files = ['root.yml', ...leaves];
    const calls: Record<string, string[]> = { 'root.yml': leaves };
    leaves.forEach((f) => { calls[f] = []; });
    const atLimit = validate(caller('./.github/workflows/w0.yml', { secrets: 'inherit' }), ctx({
      fileName: 'root.yml',
      fileNames: files,
      targets: files.map((f) => ({ fileName: f, hasWorkflowCall: true, inputs: [], secrets: [] })),
      calls,
    }));
    expect(atLimit.some((x) => x.severity === 'warning' && /unique workflows/i.test(x.message))).toBe(false);
  });

  it('warns when the call graph reaches more than 50 called workflows', () => {
    const leaves = Array.from({ length: 51 }, (_, i) => `w${i}.yml`);
    const files = ['root.yml', ...leaves];
    const calls: Record<string, string[]> = { 'root.yml': leaves };
    leaves.forEach((f) => { calls[f] = []; });
    const wide = validate(caller('./.github/workflows/w0.yml', { secrets: 'inherit' }), ctx({
      fileName: 'root.yml',
      fileNames: files,
      targets: files.map((f) => ({ fileName: f, hasWorkflowCall: true, inputs: [], secrets: [] })),
      calls,
    }));
    expect(wide.some((x) => x.severity === 'warning' && /51 unique workflows/i.test(x.message))).toBe(true);
  });

  it('flags a cycle longer than the nesting cutoff (5-node cycle a→b→c→d→e→a)', () => {
    const files = ['a.yml', 'b.yml', 'c.yml', 'd.yml', 'e.yml'];
    const calls: Record<string, string[]> = {
      'a.yml': ['b.yml'], 'b.yml': ['c.yml'], 'c.yml': ['d.yml'], 'd.yml': ['e.yml'], 'e.yml': ['a.yml'],
    };
    const cyc = validate(caller('./.github/workflows/b.yml', { secrets: 'inherit' }), ctx({
      fileName: 'a.yml',
      fileNames: files,
      targets: files.map((f) => ({ fileName: f, hasWorkflowCall: true, inputs: [], secrets: [] })),
      calls,
    }));
    expect(cyc.some((x) => x.severity === 'error' && /cycle/i.test(x.message))).toBe(true);
  });

  it('resolves duplicate target fileNames first-wins, matching tab order in the UI', () => {
    const dup = validate(caller('./.github/workflows/b.yml'), ctx({
      fileNames: ['a.yml', 'b.yml', 'b.yml'],
      targets: [
        { fileName: 'a.yml', hasWorkflowCall: false, inputs: [], secrets: [] },
        { fileName: 'b.yml', hasWorkflowCall: true, inputs: [], secrets: [] },
        { fileName: 'b.yml', hasWorkflowCall: false, inputs: [], secrets: [] },
      ],
      calls: { 'a.yml': ['b.yml'], 'b.yml': [] },
    }));
    expect(dup.some((x) => x.severity === 'error' && /no workflow_call/i.test(x.message))).toBe(false);
  });
});
