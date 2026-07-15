import { useEffect, useRef, useState } from 'react';
import { useRun, type JobStatus } from '../runStore';

const ICON: Record<JobStatus, string> = {
  running: '▶', success: '✓', failure: '✗', cancelled: '■', skipped: '−',
};

function StatusChip({ status }: { status: string }) {
  return <span className={`run-chip run-${status}`}>{status}</span>;
}

export default function RunPanel() {
  const run = useRun((s) => s.activeRun);
  const cancel = useRun((s) => s.cancel);
  const clear = useRun((s) => s.clear);
  const startRun = useRun((s) => s.startRun);
  const lastDialog = useRun((s) => s.lastDialog);
  const [raw, setRaw] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [runError, setRunError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const stickBottom = useRef(true);

  useEffect(() => {
    if (!run || run.status !== 'running') return;
    const startedAt = run.startedAt;
    const t = setInterval(() => setElapsed(Date.now() - startedAt), 1000);
    return () => clearInterval(t);
    // Depend on the primitive fields, not the `run` object itself: `run` is a fresh object
    // on every SSE event (see applyRunEvent's immutable updates), so keying off it would
    // tear down and rebuild this interval on every log line instead of just at job
    // start/stop or reconnect-reset.
  }, [run?.id, run?.status, run?.startedAt]);

  const handleRerun = async () => {
    if (!lastDialog) return;
    const result = await startRun(lastDialog);
    setRunError(result === 'started' ? null : result.error);
  };

  useEffect(() => {
    const el = logRef.current;
    if (el && stickBottom.current) el.scrollTop = el.scrollHeight;
  });

  if (!run) return null;

  const onScroll = () => {
    const el = logRef.current;
    if (!el) return;
    stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
  };

  return (
    <div className="run-panel">
      <div className="run-header">
        <StatusChip status={run.status} />
        <span className="run-meta">{Math.round(elapsed / 1000)}s</span>
        {runError && <span className="run-error-msg">{runError}</span>}
        <span className="spacer" />
        {run.status === 'running' && (
          <button type="button" className="mini" onClick={() => void cancel()}>cancel ■</button>
        )}
        {run.status !== 'running' && lastDialog && (
          <button type="button" className="mini" onClick={() => void handleRerun()}>re-run ↻</button>
        )}
        <button type="button" className="mini" onClick={() => setRaw((r) => !r)}>{raw ? 'jobs' : 'raw log'}</button>
        <button type="button" className="mini" onClick={clear}>✕</button>
      </div>
      <div className="run-body" ref={logRef} onScroll={onScroll}>
        {raw ? (
          <pre className="run-raw">
            {run.lines.map((l, i) => `${l.jobId ? `[${l.jobId}] ` : ''}${l.msg}${l.repeat ? ` ×${l.repeat}` : ''}`).join('\n')}
          </pre>
        ) : (
          Object.entries(run.jobs).map(([jobId, job]) => {
            const jobLines = run.lines.filter((l) => l.jobId === jobId);
            type Seg = { step?: string; lines: typeof jobLines };
            const segs: Seg[] = [];
            for (const l of jobLines) {
              const cur = segs[segs.length - 1];
              if (cur && cur.step === l.step) cur.lines.push(l);
              else segs.push({ step: l.step, lines: [l] });
            }
            return (
              <details key={jobId} open={job.status === 'running' || job.status === 'failure'} className="run-job">
                <summary>
                  <span className={`run-icon run-${job.status}`}>{ICON[job.status]}</span> {jobId}
                </summary>
                {segs.map((seg, i) => {
                  const st = job.steps.find((s) => s.name === seg.step)?.status;
                  const openDefault = st === 'running' || st === 'failure' || (st === undefined && job.status === 'running');
                  const bodyText = seg.lines
                    .map((l) => `${l.msg}${l.repeat ? ` ×${l.repeat}` : ''}`)
                    .join('\n')
                    .replace(/\n[ \t]*\n([ \t]*\n)+/g, '\n\n');
                  return (
                    <details key={`${jobId}:${i}`} open={openDefault} className="run-step">
                      <summary>
                        <span className={`run-icon run-${st ?? 'info'}`}>{st ? ICON[st] : '·'}</span> {seg.step ?? 'output'}
                      </summary>
                      <pre className="run-step-out">{bodyText}</pre>
                    </details>
                  );
                })}
              </details>
            );
          })
        )}
      </div>
    </div>
  );
}
