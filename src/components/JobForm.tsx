import { useEffect, useRef, useState } from 'react';
import { SHELLS } from '../model/catalog';
import { topicUrl } from '../model/docs';
import { uniqueName } from '../model/mapping';
import type { Container, JobData } from '../model/types';
import { FILE_NAME_RE, callTargetOf, coerceForTarget, localUsesPath, parseLocalUses } from '../model/localUses';
import { useEditor } from '../store';
import { useUi } from '../uiStore';
import KVEditor from './KVEditor';
import StepListEditor from './StepListEditor';
import BoolOrExpr from './widgets/BoolOrExpr';
import ContainerEditor from './widgets/ContainerEditor';
import MatrixEditor from './widgets/MatrixEditor';
import PermissionsEditor from './widgets/PermissionsEditor';
import RunsOnEditor from './widgets/RunsOnEditor';
import DocsLink from './widgets/DocsLink';

export default function JobForm({ id, data }: { id: string; data: JobData }) {
  const update = useEditor((s) => s.updateNodeData);
  const set = (patch: Partial<JobData>) => update(id, patch);
  const workflows = useEditor((s) => s.workflows);
  const activeId = useEditor((s) => s.activeId);
  const switchWorkflow = useEditor((s) => s.switchWorkflow);
  const [usesSource, setUsesSource] = useState<'local' | 'remote'>(
    () => (parseLocalUses(data.uses ?? '').kind === 'local' ? 'local' : 'remote'),
  );
  const stepFocus = useUi((s) => s.stepFocus);
  const consumeStepFocus = useUi((s) => s.consumeStepFocus);
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!stepFocus || stepFocus.nodeId !== id) return; // another node owns it — leave it for them
    const el = containerRef.current?.querySelector(`[data-step-id="${stepFocus.stepId}"]`) as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ block: 'center' });
      el.classList.add('flash');
      setTimeout(() => el.classList.remove('flash'), 1200);
    }
    consumeStepFocus(); // one-shot: consume even if the card was not found
  }, [stepFocus, id, consumeStepFocus]);
  const reusable = data.uses !== undefined;
  const services = Object.entries(data.services ?? {});
  const setService = (name: string, c: Container | undefined, oldName?: string) => {
    if (oldName && oldName !== name && Object.hasOwn(data.services ?? {}, name)) return;
    const next = { ...(data.services ?? {}) };
    if (oldName && oldName !== name) delete next[oldName];
    if (c === undefined) delete next[name];
    else next[name] = c;
    set({ services: Object.keys(next).length ? next : undefined });
  };
  return (
    <div className="form" ref={containerRef}>
      <div className="section-title">job</div>
      <label>job id
        <input value={data.jobId} onChange={(e) => set({ jobId: e.target.value })} />
      </label>
      <label>display name
        <input value={data.name ?? ''} onChange={(e) => set({ name: e.target.value || undefined })} />
      </label>
      <label>kind
        <select value={reusable ? 'reusable' : 'steps'} onChange={(e) => {
          if (e.target.value === 'reusable') {
            set({ uses: '', runsOn: '', steps: [], container: undefined, services: undefined, environment: undefined, outputs: undefined, defaults: undefined });
          } else {
            set({ uses: undefined, with: undefined, secrets: undefined, runsOn: 'ubuntu-latest' });
          }
        }}>
          <option value="steps">runs steps</option>
          <option value="reusable">calls a reusable workflow</option>
        </select>
      </label>
      <label>if
        <input value={data.if ?? ''} onChange={(e) => set({ if: e.target.value || undefined })} />
      </label>

      {reusable ? (
        <>
          <label>source
            <select value={usesSource} onChange={(e) => setUsesSource(e.target.value as 'local' | 'remote')}>
              <option value="local">local workflow (tab)</option>
              <option value="remote">remote / custom</option>
            </select>
          </label>
          {usesSource === 'local' ? (() => {
            const otherTabs = workflows.filter((w) => w.id !== activeId && FILE_NAME_RE.test(w.fileName));
            const parsed = parseLocalUses(data.uses ?? '');
            const currentLocal = parsed.kind === 'local' ? parsed.fileName : '';
            const open = otherTabs.some((w) => w.fileName === currentLocal);
            return (
              <label>workflow
                <span className="uses-picker">
                  <select
                    value={currentLocal}
                    onChange={(e) => set({ uses: localUsesPath(e.target.value) })}
                  >
                    <option value="" disabled>choose a tab…</option>
                    {currentLocal && !open && (
                      <option value={currentLocal} disabled>(not open: {currentLocal})</option>
                    )}
                    {otherTabs.map((w) => (
                      <option key={w.id} value={w.fileName}>{w.fileName}</option>
                    ))}
                  </select>
                  {open && (
                    <button type="button" className="mini" onClick={() => {
                      const t = otherTabs.find((w) => w.fileName === currentLocal);
                      if (t) switchWorkflow(t.id);
                    }}>open ↗</button>
                  )}
                </span>
              </label>
            );
          })() : (
            <label>uses
              <input value={data.uses} placeholder="owner/repo/.github/workflows/x.yml@v1"
                onChange={(e) => set({ uses: e.target.value })} />
            </label>
          )}
          <details open>
            <summary>with ({Object.keys(data.with ?? {}).length}) <DocsLink href={topicUrl('with')} /></summary>
            <KVEditor
              value={Object.fromEntries(Object.entries(data.with ?? {}).map(([k, v]) => [k, String(v)]))}
              onChange={(kv) => {
                const parsed = parseLocalUses(data.uses ?? '');
                if (parsed.kind === 'local') {
                  const targetDoc = workflows.find((w) => w.id !== activeId && w.fileName === parsed.fileName);
                  if (!targetDoc) {
                    // Target tab isn't open: we have no declared types to coerce
                    // against, so keep values as the user typed them rather than
                    // guessing (and possibly manufacturing a bogus type error).
                    set({ with: Object.keys(kv).length ? kv : undefined });
                    return;
                  }
                  const target = callTargetOf(targetDoc.fileName, targetDoc);
                  set({ with: Object.keys(kv).length ? coerceForTarget(kv, target) : undefined });
                  return;
                }
                set({ with: Object.keys(kv).length ? coerceForTarget(kv, undefined) : undefined });
              }} />
          </details>
          <label>secrets
            <select
              value={data.secrets === 'inherit' ? 'inherit' : data.secrets ? 'custom' : ''}
              onChange={(e) => {
                const v = e.target.value;
                set({ secrets: v === '' ? undefined : v === 'inherit' ? 'inherit' : {} });
              }}>
              <option value="">none</option>
              <option value="inherit">inherit</option>
              <option value="custom">custom…</option>
            </select>
          </label>
          {typeof data.secrets === 'object' && (
            <KVEditor value={data.secrets}
              onChange={(kv) => set({ secrets: Object.keys(kv).length ? kv : {} })} />
          )}
        </>
      ) : (
        <>
          <label>runs-on
            <RunsOnEditor value={data.runsOn} onChange={(runsOn) => set({ runsOn })} />
          </label>
          <label>environment name
            <input
              value={typeof data.environment === 'string' ? data.environment : data.environment?.name ?? ''}
              onChange={(e) => {
                const name = e.target.value;
                const url = typeof data.environment === 'object' ? data.environment.url : undefined;
                set({ environment: name ? (url ? { name, url } : name) : undefined });
              }} />
          </label>
          <label>environment url
            <input
              value={typeof data.environment === 'object' ? data.environment.url ?? '' : ''}
              placeholder="${{ steps.deploy.outputs.url }}"
              onChange={(e) => {
                const name = typeof data.environment === 'string' ? data.environment : data.environment?.name ?? '';
                if (!name) return;
                set({ environment: e.target.value ? { name, url: e.target.value } : name });
              }} />
          </label>
          <label>timeout (minutes)
            <input type="number" value={data.timeoutMinutes ?? ''} min={1}
              onChange={(e) => set({ timeoutMinutes: e.target.value ? Number(e.target.value) : undefined })} />
          </label>
          <BoolOrExpr label="continue-on-error" value={data.continueOnError}
            onChange={(continueOnError) => set({ continueOnError })} />
          <label>defaults shell
            <select value={data.defaults?.shell ?? ''} onChange={(e) => {
              const shell = e.target.value || undefined;
              const wd = data.defaults?.workingDirectory;
              set({ defaults: shell || wd ? { shell, workingDirectory: wd } : undefined });
            }}>
              <option value="">unset</option>
              {SHELLS.map((sh) => <option key={sh} value={sh}>{sh}</option>)}
            </select>
          </label>
          <label>defaults working-directory
            <input value={data.defaults?.workingDirectory ?? ''} onChange={(e) => {
              const workingDirectory = e.target.value || undefined;
              const shell = data.defaults?.shell;
              set({ defaults: shell || workingDirectory ? { shell, workingDirectory } : undefined });
            }} />
          </label>
          <details>
            <summary>env ({Object.keys(data.env ?? {}).length}) <DocsLink href={topicUrl('env')} /></summary>
            <KVEditor value={data.env} onChange={(v) => set({ env: Object.keys(v).length ? v : undefined })} />
          </details>
          <details>
            <summary>outputs ({Object.keys(data.outputs ?? {}).length}) <DocsLink href={topicUrl('outputs')} /></summary>
            <KVEditor value={data.outputs} onChange={(v) => set({ outputs: Object.keys(v).length ? v : undefined })} />
          </details>
        </>
      )}

      <details>
        <summary>permissions ({data.permissions === undefined ? 'default' : typeof data.permissions === 'string' ? data.permissions : 'custom'}) <DocsLink href={topicUrl('permissions')} /></summary>
        <PermissionsEditor value={data.permissions} onChange={(permissions) => set({ permissions })} />
      </details>
      <details>
        <summary>concurrency ({data.concurrency ? 'set' : 'unset'}) <DocsLink href={topicUrl('concurrency')} /></summary>
        <label>group
          <input value={data.concurrency?.group ?? ''} onChange={(e) => {
            const group = e.target.value;
            set({ concurrency: group ? { ...data.concurrency, group } : undefined });
          }} />
        </label>
        {data.concurrency && (
          <BoolOrExpr label="cancel-in-progress" value={data.concurrency.cancelInProgress}
            onChange={(cancelInProgress) => set({ concurrency: { group: data.concurrency!.group, ...(cancelInProgress !== undefined ? { cancelInProgress } : {}) } })} />
        )}
      </details>
      <details>
        <summary>matrix ({data.strategy?.matrix ? Object.keys(data.strategy.matrix.vars).length + ' vars' : 'unset'}) <DocsLink href={topicUrl('matrix')} /></summary>
        <MatrixEditor value={data.strategy} onChange={(strategy) => set({ strategy })} />
      </details>

      {!reusable && (
        <>
          <details>
            <summary>container ({data.container ? data.container.image || 'set' : 'unset'}) <DocsLink href={topicUrl('container')} /></summary>
            {data.container
              ? <ContainerEditor value={data.container} onChange={(container) => set({ container })} />
              : <button type="button" className="mini add" onClick={() => set({ container: { image: '' } })}>+ add container</button>}
          </details>
          <details>
            <summary>services ({services.length}) <DocsLink href={topicUrl('services')} /></summary>
            {services.map(([sname, svc], i) => (
              <div className="io-card" key={i}>
                <input value={sname} onChange={(e) => setService(e.target.value, svc, sname)} />
                <ContainerEditor value={svc} onChange={(c) => setService(sname, c)} />
              </div>
            ))}
            <button type="button" className="mini add"
              onClick={() => setService(uniqueName('service', Object.keys(data.services ?? {})), { image: '' })}>+ add service</button>
          </details>
          <StepListEditor steps={data.steps} onChange={(steps) => set({ steps })} />
        </>
      )}
    </div>
  );
}
