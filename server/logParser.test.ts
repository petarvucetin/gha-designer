import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createParser } from './logParser';
import type { RunEvent } from './types';

const feed = (file: string) => {
  const parser = createParser();
  const events: RunEvent[] = [];
  for (const line of readFileSync(join(__dirname, 'fixtures', file), 'utf8').split('\n')) {
    if (line.trim()) events.push(...parser.push(line));
  }
  return { parser, events };
};

describe('logParser', () => {
  it('maps job/step lines with both stepid casings and trims padded job fields', () => {
    const { events } = feed('dryrun.jsonl');
    const lines = events.filter((e) => e.kind === 'line');
    expect(lines.some((l) => l.kind === 'line' && l.jobId === 'build' && l.step === 'Set up job')).toBe(true);
    expect(lines.some((l) => l.kind === 'line' && l.jobId === 'build' && l.step === 'Hello' && l.msg === 'hello')).toBe(true);
    expect(lines.every((l) => l.kind === 'line' && (l.jobId === undefined || !l.jobId.includes(' ')))).toBe(true);
  });

  it('emits running on first job line and success/failure from jobResult', () => {
    const { events } = feed('dryrun.jsonl');
    const statuses = events.filter((e): e is Extract<RunEvent, { kind: 'status' }> => e.kind === 'status' && e.scope === 'job');
    expect(statuses[0]).toMatchObject({ jobId: 'build', status: 'running' });
    expect(statuses.some((s) => s.jobId === 'build' && s.status === 'success')).toBe(true);
    expect(statuses.some((s) => s.jobId === 'deploy' && s.status === 'failure')).toBe(true);
  });

  it('emits step statuses from stepResult', () => {
    const { events } = feed('dryrun.jsonl');
    expect(events.some((e) => e.kind === 'status' && e.scope === 'step' && e.jobId === 'build' && e.step === 'Hello' && e.status === 'success')).toBe(true);
    expect(events.some((e) => e.kind === 'status' && e.scope === 'step' && e.jobId === 'deploy' && e.status === 'failure')).toBe(true);
  });

  it('collapses consecutive identical lines into a repeat count', () => {
    const { events } = feed('dryrun.jsonl');
    const gitErr = events.filter((e) => e.kind === 'line' && e.msg === 'unable to get git ref');
    expect(gitErr).toHaveLength(1);
    expect(gitErr[0].kind === 'line' && gitErr[0].repeat).toBe(3);
  });

  it('passes non-JSON lines through verbatim', () => {
    const { events } = feed('dryrun.jsonl');
    expect(events.some((e) => e.kind === 'line' && e.msg.startsWith('this line is not json'))).toBe(true);
  });

  it('attributes nested-call job statuses to the caller with failure-sticky aggregation', () => {
    const { events } = feed('nested-matrix.jsonl');
    const callerStatuses = events.filter((e): e is Extract<RunEvent, { kind: 'status' }> =>
      e.kind === 'status' && e.scope === 'job' && e.jobId === 'call-it');
    expect(callerStatuses.some((s) => s.status === 'running')).toBe(true);
    expect(callerStatuses.at(-1)?.status).toBe('success'); // nested inner succeeded
  });

  it('aggregates matrix legs with failure precedence', () => {
    const { events } = feed('nested-matrix.jsonl');
    const m = events.filter((e): e is Extract<RunEvent, { kind: 'status' }> =>
      e.kind === 'status' && e.scope === 'job' && e.jobId === 'matrixy');
    // leg 1 failed first: job goes failure and STAYS failure after leg 2 succeeds
    expect(m.at(-1)?.status).toBe('failure');
  });

  it('truncates giant messages to 8KiB with a marker', () => {
    const parser = createParser();
    const big = JSON.stringify({ level: 'info', msg: 'x'.repeat(20000), job: 'CI/a', jobID: 'a' });
    const [e] = parser.push(big);
    expect(e.kind === 'line' && e.msg.length).toBeLessThanOrEqual(8192 + 20);
    expect(e.kind === 'line' && e.msg.endsWith('…[truncated]')).toBe(true);
  });

  it('finish() force-resolves running jobs to the final status', () => {
    const parser = createParser();
    parser.push(JSON.stringify({ level: 'info', msg: 'go', job: 'CI/stuck', jobID: 'stuck' }));
    const end = parser.finish('cancelled');
    expect(end).toContainEqual({ kind: 'status', scope: 'job', jobId: 'stuck', status: 'cancelled' });
  });
});
