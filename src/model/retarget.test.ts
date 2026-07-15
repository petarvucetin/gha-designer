import { describe, expect, it } from 'vitest';
import { retargetTrigger } from './retarget';
import type { TriggerData } from './types';

const base: TriggerData = {
  kind: 'trigger', trigger: 'push',
  branches: ['main'], tags: ['v*'], paths: ['src/**'],
  extra: { keep: 1 },
};

describe('retargetTrigger', () => {
  it('keeps legal filters, drops illegal ones, keeps extra', () => {
    const pr = retargetTrigger(base, 'pull_request');
    expect(pr.trigger).toBe('pull_request');
    expect(pr.branches).toEqual(['main']);
    expect(pr.paths).toEqual(['src/**']);
    expect(pr.tags).toBeUndefined();
    expect(pr.extra).toEqual({ keep: 1 });
  });

  it('filters types down to values legal for the new event', () => {
    const d: TriggerData = { kind: 'trigger', trigger: 'issues', types: ['opened', 'edited', 'field_added'] };
    expect(retargetTrigger(d, 'label').types).toEqual(['edited']);
    expect(retargetTrigger(d, 'milestone').types).toEqual(['opened', 'edited']);
  });

  it('seeds cron when retargeting to schedule; keeps inputs for dispatch->call', () => {
    expect(retargetTrigger(base, 'schedule').cron).toBe('0 4 * * *');
    const d: TriggerData = { kind: 'trigger', trigger: 'workflow_dispatch', inputs: [{ id: 'x' }] };
    expect(retargetTrigger(d, 'workflow_call').inputs).toEqual([{ id: 'x' }]);
    expect(retargetTrigger(d, 'push').inputs).toBeUndefined();
  });
});
