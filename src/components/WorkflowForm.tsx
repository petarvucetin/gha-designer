import { SHELLS } from '../model/catalog';
import { topicUrl } from '../model/docs';
import { useEditor } from '../store';
import KVEditor from './KVEditor';
import BoolOrExpr from './widgets/BoolOrExpr';
import PermissionsEditor from './widgets/PermissionsEditor';
import DocsLink from './widgets/DocsLink';

export default function WorkflowForm() {
  const meta = useEditor((s) => s.meta);
  const updateMeta = useEditor((s) => s.updateMeta);
  const fileName = useEditor((s) => s.activeFileName);
  const setFileName = useEditor((s) => s.setFileName);
  const activeDoc = useEditor((s) => s.workflows.find((w) => w.id === s.activeId));
  const bound = !!activeDoc?.source;
  return (
    <div className="form">
      <div className="section-title">workflow settings</div>
      <label>name
        <input value={meta.name} onChange={(e) => updateMeta({ name: e.target.value })} />
      </label>
      <label>file name
        <input value={fileName} disabled={bound}
          title={bound ? `bound to ${activeDoc!.source!.path} — rename on disk` : undefined}
          onChange={(e) => setFileName(e.target.value)} />
      </label>
      <div className="hint">other tabs call this workflow as ./.github/workflows/{fileName || '…'}</div>
      <label>run-name
        <input value={meta.runName ?? ''} placeholder="Deploy by @${{ github.actor }}"
          onChange={(e) => updateMeta({ runName: e.target.value || undefined })} />
      </label>
      <details>
        <summary>permissions ({meta.permissions === undefined ? 'default' : typeof meta.permissions === 'string' ? meta.permissions : 'custom'}) <DocsLink href={topicUrl('permissions')} /></summary>
        <PermissionsEditor value={meta.permissions} onChange={(permissions) => updateMeta({ permissions })} />
      </details>
      <details>
        <summary>env ({Object.keys(meta.env ?? {}).length}) <DocsLink href={topicUrl('env')} /></summary>
        <KVEditor value={meta.env}
          onChange={(env) => updateMeta({ env: Object.keys(env).length ? env : undefined })} />
      </details>
      <details>
        <summary>concurrency ({meta.concurrency ? 'set' : 'unset'}) <DocsLink href={topicUrl('concurrency')} /></summary>
        <label>group
          <input value={meta.concurrency?.group ?? ''} placeholder="ci-${{ github.ref }}"
            onChange={(e) => {
              const group = e.target.value;
              updateMeta({ concurrency: group ? { ...meta.concurrency, group } : undefined });
            }} />
        </label>
        {meta.concurrency && (
          <BoolOrExpr label="cancel-in-progress" value={meta.concurrency.cancelInProgress}
            onChange={(cancelInProgress) => updateMeta({
              concurrency: { group: meta.concurrency!.group, ...(cancelInProgress !== undefined ? { cancelInProgress } : {}) },
            })} />
        )}
      </details>
      <label>defaults shell
        <select value={meta.defaults?.shell ?? ''} onChange={(e) => {
          const shell = e.target.value || undefined;
          const workingDirectory = meta.defaults?.workingDirectory;
          updateMeta({ defaults: shell || workingDirectory ? { shell, workingDirectory } : undefined });
        }}>
          <option value="">unset</option>
          {SHELLS.map((sh) => <option key={sh} value={sh}>{sh}</option>)}
        </select>
      </label>
      <label>defaults working-directory
        <input value={meta.defaults?.workingDirectory ?? ''} onChange={(e) => {
          const workingDirectory = e.target.value || undefined;
          const shell = meta.defaults?.shell;
          updateMeta({ defaults: shell || workingDirectory ? { shell, workingDirectory } : undefined });
        }} />
      </label>
    </div>
  );
}
