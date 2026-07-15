import { useState, type DragEvent } from 'react';
import { Handle, Position, useStoreApi, type NodeProps } from '@xyflow/react';
import type { FlowNode } from '../store';
import { useEditor } from '../store';
import { useRun } from '../runStore';
import { useUi } from '../uiStore';
import { runsOnLabel } from '../model/mapping';
import { usesKind, USES_TAG_LABEL } from '../model/usesKind';
import { parseLocalUses } from '../model/localUses';
import type { Step } from '../model/types';

export default function JobNode({ id, data, selected }: NodeProps<FlowNode>) {
  const store = useStoreApi();
  const focusStep = useUi((s) => s.focusStep);
  const activeTabId = useEditor((s) => s.activeId);
  const addActionStep = useEditor((s) => s.addActionStep);
  const moveStepInJob = useEditor((s) => s.moveStepInJob);
  const jobId = data.kind === 'job' ? data.jobId : undefined;
  const runJob = useRun((s) => (jobId && s.activeRun && s.activeRun.tabId === activeTabId ? s.activeRun.jobs[jobId] : undefined));
  const [activeZone, setActiveZone] = useState<number | null>(null);
  if (data.kind !== 'job') return null;
  const reusable = data.uses !== undefined;

  const dropZone = (i: number) => (
    <div
      key={`zone-${i}`}
      className={'node-step-dropzone nodrag' + (activeZone === i ? ' active' : '')}
      onDragOver={(e: DragEvent) => {
        const t = e.dataTransfer.types;
        if (t.includes('application/gha-action-step') || t.includes('application/gha-canvas-reorder')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setActiveZone(i);
        }
      }}
      onDragLeave={() => setActiveZone((z) => (z === i ? null : z))}
      onDrop={(e: DragEvent) => {
        const reorder = e.dataTransfer.getData('application/gha-canvas-reorder');
        if (reorder) {
          e.preventDefault();
          e.stopPropagation();
          setActiveZone(null);
          const { nodeId, index } = JSON.parse(reorder) as { nodeId: string; index: number };
          if (nodeId === id) moveStepInJob(id, index, i); // same-job reorder only; cross-job drop is ignored
          return;
        }
        const raw = e.dataTransfer.getData('application/gha-action-step');
        if (!raw) return; // not our payload → let it bubble to the canvas fallback
        e.preventDefault();
        e.stopPropagation(); // stop FlowCanvas from also handling this drop (would double-insert / append)
        setActiveZone(null);
        const step = JSON.parse(raw) as Step;
        addActionStep(step, { jobId: id, index: i });
      }}
    />
  );
  return (
    <div className={`node job-node${selected ? ' selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="node-title">
        <span className="node-icon">⚙</span> {data.name || data.jobId}
        {runJob && <span className={`node-run-dot run-${runJob.status}`} title={runJob.status} />}
      </div>
      <div className="node-sub">{reusable ? 'reusable workflow' : runsOnLabel(data.runsOn) || '⚠ no runs-on'}</div>
      {(data.strategy?.matrix || data.container || data.services || data.uses !== undefined) && (
        <div className="node-badges">
          {data.strategy?.matrix && <span className="badge">matrix</span>}
          {data.container && <span className="badge">container</span>}
          {data.services && <span className="badge">services</span>}
          {data.uses !== undefined && (() => {
            const local = parseLocalUses(data.uses).kind === 'local';
            return <span className={`badge ${local ? 'badge-local' : 'badge-custom'}`}>{local ? 'local workflow' : 'custom workflow'}</span>;
          })()}
        </div>
      )}
      {reusable ? (
        <ul className="node-steps"><li>{data.uses || '(no workflow ref)'}</li></ul>
      ) : (
        <div className="node-steps nowheel" onDragLeave={() => setActiveZone(null)}>
          {data.steps.length === 0
            ? (
              <>
                {dropZone(0)}
                <div className="node-step-empty">no steps</div>
              </>
            )
            : (
              <>
                {data.steps.flatMap((s, i) => {
                  const label = s.name || s.uses || s.run?.split('\n')[0] || '(empty step)';
                  const kind = usesKind(s.uses);
                  return [
                    dropZone(i),
                    <button
                      key={s.id}
                      type="button"
                      className="node-step nodrag"
                      aria-label={`step ${i + 1}: ${label}`}
                      draggable
                      onDragStart={(e: DragEvent) => {
                        e.dataTransfer.setData('application/gha-canvas-reorder', JSON.stringify({ nodeId: id, index: i }));
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        store.getState().addSelectedNodes([id]); // drive RF selection (Delete-key safe)
                        focusStep(id, s.id);
                      }}
                      onDoubleClick={(e) => e.stopPropagation()}
                    >
                      <span className="step-no">{i + 1}</span>
                      {kind !== 'run' && (
                        <span className={`uses-tag uses-${kind}`} title={s.uses}>{USES_TAG_LABEL[kind]}</span>
                      )}
                      <span className="node-step-label">{label}</span>
                    </button>,
                  ];
                })}
                {dropZone(data.steps.length)}
              </>
            )}
        </div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
