import { useEffect, useState, type DragEvent } from 'react';
import { SHELLS } from '../model/catalog';
import type { Step } from '../model/types';
import { freshId } from '../model/types';
import { insertStep, moveStep } from '../model/stepOps';
import KVEditor from './KVEditor';
import { useUi } from '../uiStore';
import { usesKind, USES_TAG_LABEL } from '../model/usesKind';

function StepCard({ step, index, count, collapsed, onPatch, onMove, onRemove, onToggleCollapse, onGripDragStart }: {
  step: Step; index: number; count: number; collapsed: boolean;
  onPatch(patch: Partial<Step>): void;
  onMove(dir: -1 | 1): void;
  onRemove(): void;
  onToggleCollapse(): void;
  onGripDragStart(e: DragEvent): void;
}) {
  const summary = step.uses || step.run?.split('\n')[0] || '(empty step)';
  const kind = usesKind(step.uses);
  return (
    <div className="step-card" data-step-id={step.id}>
      <div className="step-head">
        <span className="step-grip" draggable title="drag to reorder" onDragStart={onGripDragStart}>⠿</span>
        <button type="button" className="mini step-chevron" onClick={onToggleCollapse}
          aria-label={collapsed ? 'expand step' : 'collapse step'}>
          {collapsed ? '▸' : '▾'}
        </button>
        <span className="step-index">{index + 1}</span>
        <input
          className="step-name"
          value={step.name ?? ''}
          placeholder="step name"
          onChange={(e) => onPatch({ name: e.target.value || undefined })}
        />
        <button type="button" className="mini" disabled={index === 0} onClick={() => onMove(-1)}>↑</button>
        <button type="button" className="mini" disabled={index === count - 1} onClick={() => onMove(1)}>↓</button>
        <button type="button" className="mini" onClick={onRemove}>✕</button>
      </div>
      {collapsed && (
        <div className="step-summary" onClick={onToggleCollapse} title="expand step">
          {kind !== 'run' && <span className={`uses-tag uses-${kind}`}>{USES_TAG_LABEL[kind]}</span>}
          {summary}
        </div>
      )}
      {!collapsed && <>
      <label>uses
        <input value={step.uses ?? ''} placeholder="owner/action@v1"
          onChange={(e) => onPatch({ uses: e.target.value || undefined })} />
      </label>
      <label>run
        <textarea value={step.run ?? ''} rows={2} placeholder="shell command"
          onChange={(e) => onPatch({ run: e.target.value || undefined })} />
      </label>
      <label>if
        <input value={step.if ?? ''} onChange={(e) => onPatch({ if: e.target.value || undefined })} />
      </label>
      <label>id
        <input value={step.stepId ?? ''} placeholder="step id (for outputs)"
          onChange={(e) => onPatch({ stepId: e.target.value || undefined })} />
      </label>
      <label>shell
        <select value={step.shell ?? ''} onChange={(e) => onPatch({ shell: e.target.value || undefined })}>
          <option value="">default</option>
          {SHELLS.map((sh) => <option key={sh} value={sh}>{sh}</option>)}
        </select>
      </label>
      <label>working-directory
        <input value={step.workingDirectory ?? ''}
          onChange={(e) => onPatch({ workingDirectory: e.target.value || undefined })} />
      </label>
      <label>timeout (minutes)
        <input type="number" min={1} value={step.timeoutMinutes ?? ''}
          onChange={(e) => onPatch({ timeoutMinutes: e.target.value ? Number(e.target.value) : undefined })} />
      </label>
      <label>continue-on-error
        <select
          value={step.continueOnError === undefined ? '' : typeof step.continueOnError === 'boolean' ? String(step.continueOnError) : 'expr'}
          onChange={(e) => {
            const v = e.target.value;
            onPatch({ continueOnError: v === '' ? undefined : v === 'expr' ? '${{ }}' : v === 'true' });
          }}>
          <option value="">unset</option><option value="true">true</option>
          <option value="false">false</option><option value="expr">expression…</option>
        </select>
        {typeof step.continueOnError === 'string' && (
          <input value={step.continueOnError} onChange={(e) => onPatch({ continueOnError: e.target.value })} />
        )}
      </label>
      <details>
        <summary>with ({Object.keys(step.with ?? {}).length})</summary>
        <KVEditor value={step.with} onChange={(v) => onPatch({ with: Object.keys(v).length ? v : undefined })} />
      </details>
      <details>
        <summary>env ({Object.keys(step.env ?? {}).length})</summary>
        <KVEditor value={step.env} onChange={(v) => onPatch({ env: Object.keys(v).length ? v : undefined })} />
      </details>
      </>}
    </div>
  );
}

export default function StepListEditor({ steps, onChange }: {
  steps: Step[];
  onChange(steps: Step[]): void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [activeZone, setActiveZone] = useState<number | null>(null);
  const stepFocus = useUi((s) => s.stepFocus);
  useEffect(() => {
    if (stepFocus && steps.some((s) => s.id === stepFocus.stepId)) {
      setExpanded((prev) => (prev.has(stepFocus.stepId) ? prev : new Set(prev).add(stepFocus.stepId)));
    }
  }, [stepFocus, steps]);
  const patch = (i: number, p: Partial<Step>) =>
    onChange(steps.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const move = (i: number, dir: -1 | 1) => {
    const next = [...steps];
    const [s] = next.splice(i, 1);
    next.splice(i + dir, 0, s);
    onChange(next);
  };
  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  const anyExpanded = steps.some((s) => expanded.has(s.id));

  const dropZone = (i: number) => (
    <div
      key={`zone-${i}`}
      className={'step-drop-zone' + (activeZone === i ? ' active' : '')}
      onDragOver={(e: DragEvent) => {
        const t = e.dataTransfer.types;
        if (t.includes('application/gha-step-reorder') || t.includes('application/gha-action-step')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setActiveZone(i);
        }
      }}
      onDragLeave={() => setActiveZone((z) => (z === i ? null : z))}
      onDrop={(e: DragEvent) => {
        const reorder = e.dataTransfer.getData('application/gha-step-reorder');
        const action = e.dataTransfer.getData('application/gha-action-step');
        if (!reorder && !action) return; // not ours → ignore
        e.preventDefault();
        setActiveZone(null);
        if (reorder) { onChange(moveStep(steps, Number(reorder), i)); return; }
        const step = JSON.parse(action) as Step;
        onChange(insertStep(steps, i, step));
      }}
    />
  );

  return (
    <div className="step-list">
      <div className="section-title">
        <span>steps</span>
        <button type="button" className="mini"
          onClick={() => setExpanded(anyExpanded ? new Set() : new Set(steps.map((s) => s.id)))}>
          {anyExpanded ? 'collapse all' : 'expand all'}
        </button>
      </div>
      {dropZone(0)}
      {steps.flatMap((s, i) => [
        <StepCard key={s.id} step={s} index={i} count={steps.length} collapsed={!expanded.has(s.id)}
          onPatch={(p) => patch(i, p)}
          onMove={(d) => move(i, d)}
          onRemove={() => onChange(steps.filter((_, j) => j !== i))}
          onToggleCollapse={() => toggleExpand(s.id)}
          onGripDragStart={(e) => {
            e.dataTransfer.setData('application/gha-step-reorder', String(i));
            e.dataTransfer.effectAllowed = 'move';
          }} />,
        dropZone(i + 1),
      ])}
      <button type="button" className="mini add"
        onClick={() => {
          const id = freshId('step');
          setExpanded((prev) => new Set(prev).add(id));
          onChange([...steps, { id, run: 'echo hello' }]);
        }}>
        + add step
      </button>
    </div>
  );
}
