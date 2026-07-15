import { useState } from 'react';
import { useEditor } from '../store';
import { useFs } from '../fsStore';
import { useRun, type JobStatus } from '../runStore';
import { useUi } from '../uiStore';
import { toYaml } from '../model/toYaml';
import { deriveMarker } from '../model/binding';
import type { WorkflowDoc } from '../model/types';

const RUN_MARKER: Record<JobStatus | 'error', string> = {
  running: '▶', success: '✓', failure: '✗', error: '✗', cancelled: '■', skipped: '−',
};

export default function TabStrip() {
  const workflows = useEditor((s) => s.workflows);
  const activeId = useEditor((s) => s.activeId);
  const activeName = useEditor((s) => s.meta.name);
  const activeFile = useEditor((s) => s.activeFileName);
  const switchWorkflow = useEditor((s) => s.switchWorkflow);
  const addWorkflow = useEditor((s) => s.addWorkflow);
  const closeWorkflow = useEditor((s) => s.closeWorkflow);
  const [armed, setArmed] = useState<string | null>(null);
  const nodes = useEditor((s) => s.nodes);
  const edges = useEditor((s) => s.edges);
  const meta = useEditor((s) => s.meta);
  const folderRoot = useFs((s) => (s.folder?.status === 'open' ? s.folder.root : null));
  const activeView = useUi((s) => s.activeView);
  const showWorkflow = useUi((s) => s.showWorkflow);
  const showRun = useUi((s) => s.showRun);
  const activeRun = useRun((s) => s.activeRun);
  const clearRun = useRun((s) => s.clear);
  const markerOf = (w: WorkflowDoc) => {
    const yaml = w.id === activeId
      ? toYaml(useEditor.getState().snapshot())
      : toYaml({ meta: w.meta, nodes: w.nodes, edges: w.edges });
    return deriveMarker(w, folderRoot, yaml).marker;
  };
  // meta, nodes, edges are referenced so eslint/TS keep them; they intentionally drive re-render.
  void meta; void nodes; void edges;
  return (
    <nav className="tab-strip">
      {workflows.map((w) => {
        const active = w.id === activeId && activeView === 'workflow';
        const m = markerOf(w);
        const select = () => {
          switchWorkflow(w.id);
          showWorkflow();
        };
        return (
          <div
            key={w.id}
            className={`wf-tab${active ? ' active' : ''}`}
            title={active ? activeFile : w.fileName}
            role="tab"
            tabIndex={0}
            aria-selected={active}
            onClick={select}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                select();
              } else if (e.key === ' ') {
                e.preventDefault();
                select();
              }
            }}
          >
            {m && <span className="wf-tab-marker" aria-hidden>{m}</span>}
            <span className="wf-tab-label">{active ? activeName : w.meta.name}</span>
            <button
              type="button"
              className="wf-tab-close"
              onClick={(e) => {
                e.stopPropagation();
                if (armed === w.id) {
                  closeWorkflow(w.id);
                  setArmed(null);
                } else {
                  setArmed(w.id);
                  setTimeout(() => setArmed((a) => (a === w.id ? null : a)), 2500);
                }
              }}
            >
              {armed === w.id ? 'sure?' : '×'}
            </button>
          </div>
        );
      })}
      {activeRun && (
        <div
          className={`wf-tab run-tab${activeView === 'run' ? ' active' : ''}`}
          title="Run"
          role="tab"
          tabIndex={0}
          aria-selected={activeView === 'run'}
          onClick={() => showRun()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              showRun();
            } else if (e.key === ' ') {
              e.preventDefault();
              showRun();
            }
          }}
        >
          <span className={`wf-tab-marker run-${activeRun.status}`} aria-hidden>{RUN_MARKER[activeRun.status]}</span>
          <span className="wf-tab-label">Run</span>
          <button
            type="button"
            className="wf-tab-close"
            onClick={(e) => {
              e.stopPropagation();
              clearRun();
            }}
          >
            ×
          </button>
        </div>
      )}
      <button type="button" className="wf-tab-add" onClick={() => addWorkflow()}>+</button>
    </nav>
  );
}
