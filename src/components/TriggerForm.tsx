import { EVENTS, eventSpec } from '../model/catalog';
import { eventDocsUrl } from '../model/docs';
import { retargetTrigger } from '../model/retarget';
import type { TriggerData } from '../model/types';
import { useEditor } from '../store';
import ListInput from './widgets/ListInput';
import CheckboxGrid from './widgets/CheckboxGrid';
import { InputsEditor, OutputsEditor, SecretsDeclEditor } from './WorkflowIOEditors';
import DocsLink from './widgets/DocsLink';

const FILTER_LABELS: [keyof TriggerData & string, string][] = [
  ['branches', 'branches'], ['branchesIgnore', 'branches-ignore'],
  ['tags', 'tags'], ['tagsIgnore', 'tags-ignore'],
  ['paths', 'paths'], ['pathsIgnore', 'paths-ignore'],
];
const FILTER_KEY_TO_FIELD: Record<string, keyof TriggerData & string> = {
  branches: 'branches', 'branches-ignore': 'branchesIgnore',
  tags: 'tags', 'tags-ignore': 'tagsIgnore',
  paths: 'paths', 'paths-ignore': 'pathsIgnore',
};
// GitHub rejects workflow_call inputs typed choice/environment (or untyped) —
// restrict the editor's type picker accordingly (see validate.ts).
const CALL_INPUT_TYPES = ['string', 'number', 'boolean'] as const;

export default function TriggerForm({ id, data }: { id: string; data: TriggerData }) {
  const update = useEditor((s) => s.updateNodeData);
  const replace = useEditor((s) => s.replaceNodeData);
  const set = (patch: Partial<TriggerData>) => update(id, patch);
  const spec = eventSpec(data.trigger);
  return (
    <div className="form">
      <div className="section-title">trigger</div>
      <label>event
        <select
          value={spec ? data.trigger : '__unknown__'}
          onChange={(e) => replace(id, retargetTrigger(data, e.target.value))}
        >
          {!spec && <option value="__unknown__">{data.trigger} (unknown)</option>}
          {EVENTS.map((ev) => <option key={ev.name} value={ev.name}>{ev.name}</option>)}
        </select>
      </label>
      {spec && <div className="hint">{spec.description} <DocsLink href={eventDocsUrl(data.trigger)} /></div>}

      {spec?.shape === 'schedule' && (
        <>
          <label>cron
            <input value={data.cron ?? ''} placeholder="0 4 * * *"
              onChange={(e) => set({ cron: e.target.value || undefined })} />
          </label>
          <label>timezone (IANA, optional)
            <input value={data.timezone ?? ''} placeholder="Etc/UTC"
              onChange={(e) => set({ timezone: e.target.value || undefined })} />
          </label>
        </>
      )}

      {spec?.types && (
        <details open={!!data.types?.length}>
          <summary>types ({data.types?.length ?? 0} selected — none = all)</summary>
          <CheckboxGrid options={spec.types} value={data.types} onChange={(types) => set({ types })} />
        </details>
      )}
      {spec?.typesFree && (
        <label>types (custom, comma-separated)
          <ListInput value={data.types} onChange={(types) => set({ types })} />
        </label>
      )}

      {(spec?.filters ?? []).map((key) => {
        const field = FILTER_KEY_TO_FIELD[key];
        const label = FILTER_LABELS.find(([f]) => f === field)![1];
        return (
          <label key={key}>{label}
            <ListInput value={data[field] as string[] | undefined}
              onChange={(v) => set({ [field]: v } as Partial<TriggerData>)} />
          </label>
        );
      })}

      {spec?.shape === 'workflow_run' && (
        <label>workflows (names, comma-separated)
          <ListInput value={data.workflows} onChange={(workflows) => set({ workflows })} />
        </label>
      )}

      {(spec?.shape === 'dispatch' || spec?.shape === 'call') && (
        <details open>
          <summary>inputs ({data.inputs?.length ?? 0})</summary>
          <InputsEditor
            value={data.inputs}
            onChange={(inputs) => set({ inputs })}
            types={spec?.shape === 'call' ? CALL_INPUT_TYPES : undefined}
          />
        </details>
      )}
      {spec?.shape === 'call' && (
        <>
          <details>
            <summary>outputs ({data.outputs?.length ?? 0})</summary>
            <OutputsEditor value={data.outputs} onChange={(outputs) => set({ outputs })} />
          </details>
          <details>
            <summary>secrets ({data.secretsDecl?.length ?? 0})</summary>
            <SecretsDeclEditor value={data.secretsDecl} onChange={(secretsDecl) => set({ secretsDecl })} />
          </details>
        </>
      )}
    </div>
  );
}
