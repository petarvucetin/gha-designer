import { describe, expect, it } from 'vitest';
import { EVENTS, PERMISSION_SCOPES, RUNNER_LABELS, SHELLS, eventSpec } from './catalog';

const FILTERS = ['branches', 'branches-ignore', 'paths', 'paths-ignore', 'tags', 'tags-ignore'];

describe('catalog', () => {
  it('has all 32 modeled events with unique names', () => {
    expect(EVENTS).toHaveLength(32);
    expect(new Set(EVENTS.map((e) => e.name)).size).toBe(32);
  });

  it('declares only legal filters and non-empty types', () => {
    for (const e of EVENTS) {
      for (const f of e.filters ?? []) expect(FILTERS).toContain(f);
      if (e.types) expect(e.types.length).toBeGreaterThan(0);
    }
  });

  it('has the documented shapes on exactly the four special events', () => {
    const shaped = Object.fromEntries(EVENTS.filter((e) => e.shape).map((e) => [e.name, e.shape]));
    expect(shaped).toEqual({
      schedule: 'schedule',
      workflow_dispatch: 'dispatch',
      workflow_call: 'call',
      workflow_run: 'workflow_run',
    });
  });

  it('spot-checks event specifics from the docs', () => {
    expect(eventSpec('push')?.filters).toEqual(
      ['branches', 'branches-ignore', 'tags', 'tags-ignore', 'paths', 'paths-ignore']);
    expect(eventSpec('pull_request')?.types).toContain('ready_for_review');
    expect(eventSpec('pull_request')?.filters).toEqual(
      ['branches', 'branches-ignore', 'paths', 'paths-ignore']);
    expect(eventSpec('merge_group')?.types).toEqual(['checks_requested']);
    expect(eventSpec('repository_dispatch')?.typesFree).toBe(true);
    expect(eventSpec('workflow_run')?.types).toEqual(['completed', 'requested', 'in_progress']);
    expect(eventSpec('issues')?.types).toContain('field_added');
    expect(eventSpec('nope')).toBeUndefined();
  });

  it('permission scopes: 14 unique; id-token has no read; models has no write', () => {
    expect(PERMISSION_SCOPES).toHaveLength(14);
    expect(new Set(PERMISSION_SCOPES.map((s) => s.name)).size).toBe(14);
    expect(PERMISSION_SCOPES.find((s) => s.name === 'id-token')?.values).toEqual(['write', 'none']);
    expect(PERMISSION_SCOPES.find((s) => s.name === 'models')?.values).toEqual(['read', 'none']);
  });

  it('runners and shells present', () => {
    expect(RUNNER_LABELS).toContain('ubuntu-latest');
    expect(RUNNER_LABELS).toContain('self-hosted');
    expect(SHELLS).toEqual(['bash', 'pwsh', 'python', 'sh', 'cmd', 'powershell']);
  });
});
