import { RUNNER_LABELS } from '../../model/catalog';
import type { RunsOn } from '../../model/types';
import ListInput from './ListInput';

type Mode = 'label' | 'labels' | 'group';
const modeOf = (r: RunsOn): Mode =>
  typeof r === 'string' ? 'label' : Array.isArray(r) ? 'labels' : 'group';

export default function RunsOnEditor({ value, onChange }: {
  value: RunsOn;
  onChange(next: RunsOn): void;
}) {
  const mode = modeOf(value);
  const switchMode = (m: Mode) => {
    if (m === mode) return;
    if (m === 'label') onChange('ubuntu-latest');
    else if (m === 'labels') onChange(typeof value === 'string' && value ? [value] : ['self-hosted']);
    else onChange({ group: '' });
  };
  return (
    <div className="runs-on-editor">
      <select value={mode} onChange={(e) => switchMode(e.target.value as Mode)}>
        <option value="label">single label</option>
        <option value="labels">label list</option>
        <option value="group">runner group</option>
      </select>
      {mode === 'label' && (
        <>
          <input value={value as string} list="runner-labels" onChange={(e) => onChange(e.target.value)} />
          <datalist id="runner-labels">
            {RUNNER_LABELS.map((l) => <option key={l} value={l} />)}
          </datalist>
        </>
      )}
      {mode === 'labels' && (
        <ListInput value={value as string[]} placeholder="self-hosted, linux"
          onChange={(v) => onChange(v ?? [])} />
      )}
      {mode === 'group' && (
        <>
          <input placeholder="group name" value={(value as { group: string }).group}
            onChange={(e) => onChange({ ...(value as { group: string; labels?: string[] }), group: e.target.value })} />
          <ListInput value={(value as { labels?: string[] }).labels} placeholder="labels (optional)"
            onChange={(labels) => {
              const g = (value as { group: string }).group;
              onChange(labels ? { group: g, labels } : { group: g });
            }} />
        </>
      )}
    </div>
  );
}
