import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { toYaml } from './toYaml';
import type { GraphSnapshot } from './types';

function snap(partial: Partial<GraphSnapshot>): GraphSnapshot {
  return { meta: { name: 'CI' }, nodes: [], edges: [], ...partial };
}

describe('toYaml', () => {
  it('emits name, on and jobs with needs from edges', () => {
    const s = snap({
      nodes: [
        { id: 't1', type: 'trigger', position: { x: 0, y: 0 },
          data: { kind: 'trigger', trigger: 'push', branches: ['main'] } },
        { id: 'j1', type: 'job', position: { x: 0, y: 0 },
          data: { kind: 'job', jobId: 'build', runsOn: 'ubuntu-latest',
            steps: [{ id: 's1', uses: 'actions/checkout@v4' }] } },
        { id: 'j2', type: 'job', position: { x: 0, y: 0 },
          data: { kind: 'job', jobId: 'test', runsOn: 'ubuntu-latest',
            steps: [{ id: 's2', run: 'npm test' }] } },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 'j1' },
        { id: 'e2', source: 'j1', target: 'j2' },
      ],
    });
    const doc = parse(toYaml(s));
    expect(doc.name).toBe('CI');
    expect(doc.on.push.branches).toEqual(['main']);
    expect(doc.jobs.build['runs-on']).toBe('ubuntu-latest');
    expect(doc.jobs.build.steps).toEqual([{ uses: 'actions/checkout@v4' }]);
    expect(doc.jobs.test.needs).toEqual(['build']);
    expect(doc.jobs.test.steps).toEqual([{ run: 'npm test' }]);
  });

  it('trigger with no config emits empty map; schedule emits cron list', () => {
    const s = snap({
      nodes: [
        { id: 't1', type: 'trigger', position: { x: 0, y: 0 },
          data: { kind: 'trigger', trigger: 'workflow_dispatch' } },
        { id: 't2', type: 'trigger', position: { x: 0, y: 0 },
          data: { kind: 'trigger', trigger: 'schedule', cron: '0 4 * * *' } },
      ],
    });
    const doc = parse(toYaml(s));
    expect(doc.on.workflow_dispatch).toEqual({});
    expect(doc.on.schedule).toEqual([{ cron: '0 4 * * *' }]);
  });

  it('schedule entry with extra keys re-emits them', () => {
    const s = snap({
      nodes: [
        { id: 't1', type: 'trigger', position: { x: 0, y: 0 },
          data: { kind: 'trigger', trigger: 'schedule', cron: '0 4 * * *', extra: { foo: 'bar' } } },
      ],
    });
    const doc = parse(toYaml(s));
    expect(doc.on.schedule).toEqual([{ cron: '0 4 * * *', foo: 'bar' }]);
  });

  it('preserves extra bags on workflow, job and step', () => {
    const s = snap({
      meta: { name: 'CI', extra: { permissions: { contents: 'read' } } },
      nodes: [
        { id: 'j1', type: 'job', position: { x: 0, y: 0 },
          data: { kind: 'job', jobId: 'build', runsOn: 'ubuntu-latest',
            extra: { strategy: { matrix: { node: [18, 20] } } },
            steps: [{ id: 's1', run: 'make', extra: { 'continue-on-error': true } }] } },
      ],
    });
    const doc = parse(toYaml(s));
    expect(doc.permissions).toEqual({ contents: 'read' });
    expect(doc.jobs.build.strategy.matrix.node).toEqual([18, 20]);
    expect(doc.jobs.build.steps[0]['continue-on-error']).toBe(true);
  });

  it('maps step fields to kebab-case keys and keeps step order', () => {
    const s = snap({
      nodes: [
        { id: 'j1', type: 'job', position: { x: 0, y: 0 },
          data: { kind: 'job', jobId: 'build', runsOn: 'ubuntu-latest', name: 'Build',
            timeoutMinutes: 15, env: { CI: 'true' },
            steps: [
              { id: 's1', name: 'Checkout', uses: 'actions/checkout@v4', with: { 'fetch-depth': '0' } },
              { id: 's2', name: 'Test', run: 'npm test', workingDirectory: 'app', shell: 'bash', if: 'success()' },
            ] } },
      ],
    });
    const doc = parse(toYaml(s));
    expect(doc.jobs.build.name).toBe('Build');
    expect(doc.jobs.build['timeout-minutes']).toBe(15);
    expect(doc.jobs.build.env).toEqual({ CI: 'true' });
    const [s1, s2] = doc.jobs.build.steps;
    expect(s1).toEqual({ name: 'Checkout', uses: 'actions/checkout@v4', with: { 'fetch-depth': '0' } });
    expect(s2).toEqual({ name: 'Test', run: 'npm test', 'working-directory': 'app', shell: 'bash', if: 'success()' });
  });
});
