import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { FlowNode } from '../store';
import type { TriggerData } from '../model/types';

function summary(d: TriggerData): string {
  if (d.trigger === 'schedule') return d.cron ?? 'no cron';
  if (d.inputs?.length) return `${d.inputs.length} input${d.inputs.length > 1 ? 's' : ''}`;
  if (d.workflows?.length) return d.workflows.join(', ');
  if (d.branches?.length) return d.branches.join(', ');
  if (d.types?.length) return d.types.slice(0, 3).join(', ') + (d.types.length > 3 ? '…' : '');
  return 'any';
}

export default function TriggerNode({ data, selected }: NodeProps<FlowNode>) {
  if (data.kind !== 'trigger') return null;
  return (
    <div className={`node trigger-node${selected ? ' selected' : ''}`}>
      <div className="node-title">
        <span className="node-icon">⚡</span> {data.trigger}
      </div>
      <div className="node-sub">{summary(data)}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
