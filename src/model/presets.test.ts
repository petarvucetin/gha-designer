import { describe, expect, it } from 'vitest';
import { EVENTS } from './catalog';
import {
  ACTION_PRESETS,
  JOB_PRESETS,
  jobIdFromRef,
  makeActionStepFromRef,
  makeReusableWorkflowNode,
  makeTriggerNode,
  TRIGGER_GROUPS,
} from './presets';
import { validate } from './validate';

describe('presets', () => {
  it('has blank + 3 job presets', () => {
    expect(JOB_PRESETS).toHaveLength(4);
  });

  it('TRIGGER_GROUPS covers every catalog event exactly once', () => {
    const grouped = TRIGGER_GROUPS.flatMap((g) => g.items.map((i) => i.label));
    const catalog = EVENTS.map((e) => e.name);
    expect([...grouped].sort()).toEqual([...catalog].sort());
    expect(grouped).toHaveLength(catalog.length);
  });

  it('every TRIGGER_GROUPS item has a non-empty description', () => {
    for (const group of TRIGGER_GROUPS) {
      for (const item of group.items) {
        expect(item.description).toBeTruthy();
      }
    }
  });

  it('makeTriggerNode applies event-specific defaults', () => {
    expect(makeTriggerNode('schedule')).toEqual({ kind: 'trigger', trigger: 'schedule', cron: '0 4 * * *' });
    expect(makeTriggerNode('push')).toEqual({ kind: 'trigger', trigger: 'push', branches: ['main'] });
    expect(makeTriggerNode('pull_request')).toEqual({ kind: 'trigger', trigger: 'pull_request', branches: ['main'] });
    expect(makeTriggerNode('pull_request_target')).toEqual({ kind: 'trigger', trigger: 'pull_request_target', branches: ['main'] });
    expect(makeTriggerNode('release')).toEqual({ kind: 'trigger', trigger: 'release', types: ['published'] });
    expect(makeTriggerNode('issues')).toEqual({ kind: 'trigger', trigger: 'issues' });
  });

  it('every job preset produces a job that passes validation', () => {
    for (const p of JOB_PRESETS) {
      const data = p.make();
      expect(data.kind).toBe('job');
      const problems = validate({
        meta: { name: 'x' },
        nodes: [
          { id: 't', type: 'trigger', position: { x: 0, y: 0 }, data: { kind: 'trigger', trigger: 'push' } },
          { id: 'n', type: 'job', position: { x: 0, y: 0 }, data },
        ],
        edges: [],
      });
      expect(problems).toEqual([]);
    }
  });

  it('make() returns fresh objects each call (no shared references)', () => {
    const a = JOB_PRESETS[0].make();
    const b = JOB_PRESETS[0].make();
    expect(a).not.toBe(b);
    if (a.kind === 'job' && b.kind === 'job') {
      expect(a.steps).not.toBe(b.steps);
    }
  });
});

describe('action presets', () => {
  it('is a curated, non-empty list', () => {
    expect(ACTION_PRESETS.length).toBeGreaterThan(0);
  });

  it('every action makeStep() returns a step with a uses and a fresh unique id', () => {
    const ids = new Set<string>();
    for (const a of ACTION_PRESETS) {
      const step = a.makeStep();
      expect(step.uses).toBeTruthy();
      expect(step.id).toBeTruthy();
      expect(ids.has(step.id)).toBe(false);
      ids.add(step.id);
    }
  });

  it('makeStep() returns fresh objects each call (no shared references)', () => {
    const a = ACTION_PRESETS[0].makeStep();
    const b = ACTION_PRESETS[0].makeStep();
    expect(a).not.toBe(b);
    expect(a.id).not.toBe(b.id);
  });
});

describe('jobIdFromRef', () => {
  it('derives the job id from the workflow filename when present', () => {
    expect(jobIdFromRef('octo/repo/.github/workflows/ci.yml@v1')).toBe('ci');
    expect(jobIdFromRef('./.github/workflows/build.yaml')).toBe('build');
  });

  it('falls back to the last path segment when there is no workflow filename', () => {
    expect(jobIdFromRef('owner/action@v4')).toBe('action');
  });

  it('falls back to "reusable" for an empty ref', () => {
    expect(jobIdFromRef('')).toBe('reusable');
  });
});

describe('makeActionStepFromRef', () => {
  it('builds a step with the trimmed uses ref and a fresh non-empty id', () => {
    const step = makeActionStepFromRef('the-pr-agent/pr-agent@main');
    expect(step.uses).toBe('the-pr-agent/pr-agent@main');
    expect(typeof step.id).toBe('string');
    expect(step.id.length).toBeGreaterThan(0);
  });

  it('trims leading/trailing whitespace from the ref', () => {
    const step = makeActionStepFromRef(' the-pr-agent/pr-agent@main ');
    expect(step.uses).toBe('the-pr-agent/pr-agent@main');
  });
});

describe('makeReusableWorkflowNode', () => {
  it('builds a job node referencing the reusable workflow', () => {
    const node = makeReusableWorkflowNode('octo/repo/.github/workflows/ci.yml@v1');
    expect(node).toEqual({
      kind: 'job',
      jobId: 'ci',
      runsOn: '',
      steps: [],
      uses: 'octo/repo/.github/workflows/ci.yml@v1',
    });
  });
});
