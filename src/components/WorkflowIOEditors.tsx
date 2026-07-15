import type { WorkflowInput, WorkflowOutput, WorkflowSecret } from '../model/types';
import ListInput from './widgets/ListInput';

const INPUT_TYPES = ['string', 'number', 'boolean', 'choice', 'environment'] as const;

export function InputsEditor({ value, onChange, types = INPUT_TYPES }: {
  value: WorkflowInput[] | undefined;
  onChange(next: WorkflowInput[] | undefined): void;
  types?: readonly string[];
}) {
  const list = value ?? [];
  const restricted = types.length !== INPUT_TYPES.length;
  const patch = (i: number, p: Partial<WorkflowInput>) =>
    onChange(list.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const commit = (next: WorkflowInput[]) => onChange(next.length ? next : undefined);
  const addInput = () => onChange([
    ...list,
    restricted
      ? { id: `input-${list.length + 1}`, type: types[0] as WorkflowInput['type'] }
      : { id: `input-${list.length + 1}` },
  ]);
  return (
    <div className="io-editor">
      {list.map((inp, i) => (
        <div className="io-card" key={i}>
          <div className="io-head">
            <input value={inp.id} placeholder="input id" onChange={(e) => patch(i, { id: e.target.value })} />
            <select value={inp.type ?? 'string'} onChange={(e) => patch(i, { type: e.target.value as WorkflowInput['type'] })}>
              {types.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <label className="io-req">
              <input type="checkbox" checked={inp.required ?? false}
                onChange={(e) => patch(i, { required: e.target.checked || undefined })} /> req
            </label>
            <button type="button" className="mini" onClick={() => commit(list.filter((_, j) => j !== i))}>✕</button>
          </div>
          <input value={inp.description ?? ''} placeholder="description"
            onChange={(e) => patch(i, { description: e.target.value || undefined })} />
          {inp.type === 'boolean' ? (
            <label className="io-req">
              <input type="checkbox" checked={inp.default === true}
                onChange={(e) => patch(i, { default: e.target.checked ? true : undefined })} /> default true
            </label>
          ) : inp.type === 'number' ? (
            <input type="number" value={typeof inp.default === 'number' ? inp.default : ''} placeholder="default"
              onChange={(e) => patch(i, { default: e.target.value === '' ? undefined : Number(e.target.value) })} />
          ) : (
            <input value={typeof inp.default === 'string' ? inp.default : ''} placeholder="default"
              onChange={(e) => patch(i, { default: e.target.value || undefined })} />
          )}
          {inp.type === 'choice' && (
            <ListInput value={inp.options} placeholder="options: a, b, c"
              onChange={(options) => patch(i, { options })} />
          )}
        </div>
      ))}
      <button type="button" className="mini add" onClick={addInput}>+ add input</button>
    </div>
  );
}

export function OutputsEditor({ value, onChange }: {
  value: WorkflowOutput[] | undefined;
  onChange(next: WorkflowOutput[] | undefined): void;
}) {
  const list = value ?? [];
  const patch = (i: number, p: Partial<WorkflowOutput>) =>
    onChange(list.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <div className="io-editor">
      {list.map((o, i) => (
        <div className="io-card" key={i}>
          <div className="io-head">
            <input value={o.id} placeholder="output id" onChange={(e) => patch(i, { id: e.target.value })} />
            <button type="button" className="mini"
              onClick={() => onChange(list.filter((_, j) => j !== i).length ? list.filter((_, j) => j !== i) : undefined)}>✕</button>
          </div>
          <input value={o.value ?? ''} placeholder="value: ${{ jobs.build.outputs.x }}"
            onChange={(e) => patch(i, { value: e.target.value || undefined })} />
          <input value={o.description ?? ''} placeholder="description"
            onChange={(e) => patch(i, { description: e.target.value || undefined })} />
        </div>
      ))}
      <button type="button" className="mini add"
        onClick={() => onChange([...list, { id: `output-${list.length + 1}` }])}>+ add output</button>
    </div>
  );
}

export function SecretsDeclEditor({ value, onChange }: {
  value: WorkflowSecret[] | undefined;
  onChange(next: WorkflowSecret[] | undefined): void;
}) {
  const list = value ?? [];
  const patch = (i: number, p: Partial<WorkflowSecret>) =>
    onChange(list.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <div className="io-editor">
      {list.map((s, i) => (
        <div className="io-card" key={i}>
          <div className="io-head">
            <input value={s.id} placeholder="secret id" onChange={(e) => patch(i, { id: e.target.value })} />
            <label className="io-req">
              <input type="checkbox" checked={s.required ?? false}
                onChange={(e) => patch(i, { required: e.target.checked || undefined })} /> req
            </label>
            <button type="button" className="mini"
              onClick={() => onChange(list.filter((_, j) => j !== i).length ? list.filter((_, j) => j !== i) : undefined)}>✕</button>
          </div>
          <input value={s.description ?? ''} placeholder="description"
            onChange={(e) => patch(i, { description: e.target.value || undefined })} />
        </div>
      ))}
      <button type="button" className="mini add"
        onClick={() => onChange([...list, { id: `secret-${list.length + 1}` }])}>+ add secret</button>
    </div>
  );
}
