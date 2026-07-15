import { useState, type DragEvent, type ReactNode } from 'react';
import { ACTION_PRESETS, JOB_PRESETS, TRIGGER_GROUPS, makeActionStepFromRef, makeReusableWorkflowNode, type ActionPaletteItem, type PaletteItem } from '../model/presets';
import { classifyUsesRef, usesKind, USES_TAG_LABEL } from '../model/usesKind';
import { useEditor } from '../store';
import { useSaved, type SavedRef } from '../savedStore';

function PaletteEntry({ item, category }: { item: PaletteItem; category: string }) {
  const addNode = useEditor((s) => s.addNode);
  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.setData('application/gha-node', JSON.stringify(item.make()));
    e.dataTransfer.effectAllowed = 'move';
  };
  return (
    <div
      className={`palette-item palette-${category}`}
      draggable
      onDragStart={onDragStart}
      onDoubleClick={() => addNode(item.make(), { x: 80 + Math.round(Math.random() * 60), y: 80 + Math.round(Math.random() * 120) })}
      title={`${item.description} (drag to canvas, or double-click)`}
    >
      {item.label}
    </div>
  );
}

// Marketplace actions insert a `uses:` step into a job, not a whole node, so
// they get their own entry and payload type: dragging one onto a job node
// appends the step to that job (see FlowCanvas.onDrop); double-click keeps
// the previous selected-job/only-job/create-job resolution.
function ActionEntry({ item }: { item: ActionPaletteItem }) {
  const addActionStep = useEditor((s) => s.addActionStep);
  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.setData('application/gha-action-step', JSON.stringify(item.makeStep()));
    e.dataTransfer.effectAllowed = 'move';
  };
  return (
    <div
      className="palette-item palette-action"
      draggable
      onDragStart={onDragStart}
      onDoubleClick={() => addActionStep(item.makeStep())}
      title={`${item.description} (drag onto a job, or double-click to add to the selected job)`}
    >
      {item.label}
    </div>
  );
}

function Section({ id, title, level, collapsed, onToggle, children }: {
  id: string; title: string; level: 0 | 1;
  collapsed: Set<string>; onToggle: (id: string) => void; children: ReactNode;
}) {
  const isCollapsed = collapsed.has(id);
  return (
    <div className={`palette-section palette-section-l${level}`}>
      <button type="button" className={`palette-section-head palette-head-l${level}`}
        aria-expanded={!isCollapsed} onClick={() => onToggle(id)}>
        <span className="palette-chevron">{isCollapsed ? '▸' : '▾'}</span>
        <span className="palette-section-title">{title}</span>
      </button>
      {!isCollapsed && <div className="palette-section-body">{children}</div>}
    </div>
  );
}

// Lets a user paste any marketplace action or reusable-workflow `uses:` ref
// and drop/add it to the canvas via the SAME existing drop payloads that
// ActionEntry/PaletteEntry already use — no new drop handling is added here.
function AddByReference() {
  const addActionStep = useEditor((s) => s.addActionStep);
  const addNode = useEditor((s) => s.addNode);
  const [ref, setRef] = useState('');
  const trimmed = ref.trim();
  const kind = trimmed ? classifyUsesRef(trimmed) : null; // 'action' | 'workflow' | null

  // Build a FRESH payload on every add/drag so each drop gets its own Step id.
  const addToCanvas = () => {
    if (!trimmed) return;
    if (kind === 'workflow') addNode(makeReusableWorkflowNode(trimmed), { x: 120, y: 120 });
    else addActionStep(makeActionStepFromRef(trimmed));
  };
  const onDragStart = (e: DragEvent) => {
    if (!trimmed) { e.preventDefault(); return; }
    if (kind === 'workflow') e.dataTransfer.setData('application/gha-node', JSON.stringify(makeReusableWorkflowNode(trimmed)));
    else e.dataTransfer.setData('application/gha-action-step', JSON.stringify(makeActionStepFromRef(trimmed)));
    e.dataTransfer.effectAllowed = 'move';
  };

  // Tag: a workflow ref always shows "workflow"; an action ref shows its usesKind label (custom/local/docker).
  const tagKind = kind === 'workflow' ? 'workflow' : usesKind(trimmed);
  const tagText = kind === 'workflow' ? 'workflow' : USES_TAG_LABEL[usesKind(trimmed)];

  return (
    <div className="add-by-ref">
      <input
        className="ref-input"
        value={ref}
        placeholder="owner/action@v4 or …/workflows/ci.yml@ref"
        onChange={(e) => setRef(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { addToCanvas(); } }}
      />
      {trimmed && (
        <div
          className="palette-item palette-ref"
          draggable
          onDragStart={onDragStart}
          onDoubleClick={addToCanvas}
          title={`${kind === 'workflow' ? 'reusable workflow (drops as a job)' : 'action (drops as a step)'} — drag to canvas, or double-click`}
        >
          <span className={`uses-tag uses-${tagKind}`}>{tagText}</span>
          <span className="ref-chip-label">{trimmed}</span>
        </div>
      )}
    </div>
  );
}

// A marketplace action/workflow the user previously dropped onto the canvas
// (see savedStore.ts), re-offered here as a draggable/double-clickable chip.
function SavedEntry({ item }: { item: SavedRef }) {
  const addActionStep = useEditor((s) => s.addActionStep);
  const addNode = useEditor((s) => s.addNode);
  const removeSaved = useSaved((s) => s.removeSaved);

  const add = () => {
    if (item.kind === 'workflow') addNode(makeReusableWorkflowNode(item.ref), { x: 120, y: 120 });
    else addActionStep(makeActionStepFromRef(item.ref));
  };
  const onDragStart = (e: DragEvent) => {
    if (item.kind === 'workflow') e.dataTransfer.setData('application/gha-node', JSON.stringify(makeReusableWorkflowNode(item.ref)));
    else e.dataTransfer.setData('application/gha-action-step', JSON.stringify(makeActionStepFromRef(item.ref)));
    e.dataTransfer.effectAllowed = 'move';
  };

  const tagKind = item.kind === 'workflow' ? 'workflow' : usesKind(item.ref);
  const tagText = item.kind === 'workflow' ? 'workflow' : USES_TAG_LABEL[usesKind(item.ref)];

  return (
    <div
      className="palette-item palette-saved"
      draggable
      onDragStart={onDragStart}
      onDoubleClick={add}
      title={`${item.ref} — drag to canvas, or double-click`}
    >
      <span className={`uses-tag uses-${tagKind}`}>{tagText}</span>
      <span className="saved-name">{item.name}</span>
      <button
        type="button"
        className="saved-remove"
        title="remove"
        onClick={(e) => { e.stopPropagation(); removeSaved(item.id); }}
      >
        ×
      </button>
    </div>
  );
}

export default function Palette() {
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(TRIGGER_GROUPS.slice(1).map((g) => `trig:${g.label}`)) // top sections open; all trigger groups EXCEPT the first collapsed
  );
  const toggle = (id: string) =>
    setCollapsed((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const saved = useSaved((s) => s.saved);

  return (
    <aside className="palette">
      <Section id="addref" title="add by reference" level={0} collapsed={collapsed} onToggle={toggle}>
        <AddByReference />
      </Section>
      <Section id="saved" title="saved" level={0} collapsed={collapsed} onToggle={toggle}>
        {saved.length === 0
          ? <div className="palette-hint">Drop a marketplace action or GitHub link on the canvas to save it here.</div>
          : saved.map((it) => <SavedEntry key={it.id} item={it} />)}
      </Section>
      <Section id="triggers" title="triggers" level={0} collapsed={collapsed} onToggle={toggle}>
        {TRIGGER_GROUPS.map((g) => (
          <Section key={g.label} id={`trig:${g.label}`} title={g.label} level={1} collapsed={collapsed} onToggle={toggle}>
            {g.items.map((t) => <PaletteEntry key={t.label} item={t} category="trigger" />)}
          </Section>
        ))}
      </Section>
      <Section id="jobs" title="jobs" level={0} collapsed={collapsed} onToggle={toggle}>
        {JOB_PRESETS.map((j) => <PaletteEntry key={j.label} item={j} category="job" />)}
      </Section>
      <Section id="actions" title="actions" level={0} collapsed={collapsed} onToggle={toggle}>
        {ACTION_PRESETS.map((a) => <ActionEntry key={a.label} item={a} />)}
      </Section>
    </aside>
  );
}
