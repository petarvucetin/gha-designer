import type { JobStatus, RunEvent } from './types';

const MAX_MSG = 8192;

type Raw = {
  level?: string; msg?: string; job?: string; jobID?: string;
  stage?: string; step?: string; stepID?: string[]; stepid?: string[];
  raw_output?: boolean; jobResult?: string; stepResult?: string;
};

function callerOf(jobPath: string): string {
  // "caller/workflow/nested" -> caller ; "CI/build" -> build's own path (workflow/job)
  const parts = jobPath.trim().split('/');
  return parts.length >= 3 ? parts[0] : parts[parts.length - 1];
}

function truncate(msg: string): string {
  return msg.length > MAX_MSG ? `${msg.slice(0, MAX_MSG)}…[truncated]` : msg;
}

export function createParser() {
  const jobStates = new Map<string, JobStatus>();          // badge-level (aggregated) per jobId
  const legResults = new Map<string, Map<string, JobStatus>>(); // jobId -> legKey -> result
  let last: { key: string; event: Extract<RunEvent, { kind: 'line' }> } | null = null;
  let pending: RunEvent[] = [];

  const setStatus = (jobId: string, status: JobStatus): void => {
    const cur = jobStates.get(jobId);
    if (cur === status) return;
    // failure is sticky; cancelled beats success
    if (cur === 'failure' && status !== 'failure') return;
    if (cur === 'cancelled' && status === 'success') return;
    jobStates.set(jobId, status);
    pending.push({ kind: 'status', scope: 'job', jobId, status });
  };

  const push = (rawLine: string): RunEvent[] => {
    pending = [];
    let raw: Raw | null = null;
    try {
      const parsed: unknown = JSON.parse(rawLine);
      if (parsed && typeof parsed === 'object') raw = parsed as Raw;
    } catch {
      raw = null;
    }

    if (!raw || typeof raw.msg !== 'string') {
      last = null;
      pending.push({ kind: 'line', level: 'info', msg: truncate(rawLine) });
      return pending;
    }

    const jobPath = typeof raw.job === 'string' ? raw.job.trim() : undefined;
    const badgeJobId = jobPath !== undefined && typeof raw.jobID === 'string'
      ? (jobPath.split('/').length >= 3 ? callerOf(jobPath) : raw.jobID)
      : raw.jobID;
    const step = typeof raw.step === 'string' ? raw.step : undefined;
    const level = typeof raw.level === 'string' ? raw.level : 'info';

    if (typeof raw.stepResult === 'string' && badgeJobId && step) {
      last = null;
      pending.push({
        kind: 'status', scope: 'step', jobId: badgeJobId, step,
        status: raw.stepResult === 'success' ? 'success' : 'failure',
      });
    }

    if (typeof raw.jobResult === 'string' && badgeJobId && jobPath) {
      const result: JobStatus = raw.jobResult === 'success' ? 'success' : 'failure';
      const legs = legResults.get(badgeJobId) ?? new Map<string, JobStatus>();
      legs.set(jobPath, result);
      legResults.set(badgeJobId, legs);
      const worst: JobStatus = [...legs.values()].includes('failure') ? 'failure' : result;
      last = null;
      setStatus(badgeJobId, worst);
    }

    const key = `${level}|${raw.msg}|${badgeJobId ?? ''}|${step ?? ''}`;
    if (last && last.key === key) {
      last.event.repeat = (last.event.repeat ?? 1) + 1;
      return pending; // hold the collapsed line until a different one arrives
    }
    last = {
      key,
      event: { kind: 'line', jobId: badgeJobId, step, level, msg: truncate(raw.msg) },
    };
    // Emit immediately but keep the reference for repeat-count updates:
    pending.push(last.event);

    // Emit the job's "running" badge after its first line, not before, so a single
    // first-line push returns [line, status] (line first).
    if (badgeJobId && !jobStates.has(badgeJobId)) setStatus(badgeJobId, 'running');

    return pending;
  };

  const finish = (finalStatus: JobStatus | 'error'): RunEvent[] => {
    pending = [];
    last = null;
    const resolved: JobStatus = finalStatus === 'error' ? 'failure' : finalStatus;
    for (const [jobId, status] of jobStates) {
      if (status === 'running') {
        jobStates.set(jobId, resolved);
        pending.push({ kind: 'status', scope: 'job', jobId, status: resolved });
      }
    }
    return pending;
  };

  return { push, finish };
}
