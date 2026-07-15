import { useEditor } from '../store';
import JobForm from './JobForm';
import TriggerForm from './TriggerForm';
import WorkflowForm from './WorkflowForm';

export default function Inspector() {
  const selectedId = useEditor((s) => s.selectedId);
  const node = useEditor((s) => s.nodes.find((n) => n.id === s.selectedId));
  if (!selectedId || !node) {
    return <WorkflowForm />;
  }
  return node.data.kind === 'trigger'
    ? <TriggerForm key={selectedId} id={selectedId} data={node.data} />
    : <JobForm key={selectedId} id={selectedId} data={node.data} />;
}
