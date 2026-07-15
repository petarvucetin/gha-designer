import { useMemo } from 'react';
import { validate } from '../model/validate';
import { buildCallContext } from '../model/localUses';
import { useEditor } from '../store';

export function useProblems() {
  const meta = useEditor((s) => s.meta);
  const nodes = useEditor((s) => s.nodes);
  const edges = useEditor((s) => s.edges);
  const workflows = useEditor((s) => s.workflows);
  const activeId = useEditor((s) => s.activeId);
  const activeFileName = useEditor((s) => s.activeFileName);
  return useMemo(() => {
    const storage = useEditor.getState().composeStorage();
    const ctx = buildCallContext(storage.workflows, activeFileName);
    return validate(useEditor.getState().snapshot(), ctx);
  }, [meta, nodes, edges, workflows, activeId, activeFileName]);
}

export default function ProblemsPanel() {
  const problems = useProblems();
  const setSelected = useEditor((s) => s.setSelected);
  if (problems.length === 0) {
    return <div className="sidebar-empty">No problems. ✓</div>;
  }
  return (
    <ul className="problems">
      {problems.map((p, i) => (
        <li key={i} className={`problem ${p.severity}`}
          onClick={() => p.nodeId && setSelected(p.nodeId)}>
          <span className="sev">{p.severity === 'error' ? '✖' : '⚠'}</span> {p.message}
        </li>
      ))}
    </ul>
  );
}
