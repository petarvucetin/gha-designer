import { useEffect, useMemo, useState } from 'react';
import { eventSpec } from '../model/catalog';
import type { TriggerData, WorkflowInput } from '../model/types';
import { useRun, type DialogChoices } from '../runStore';
import { useEditor } from '../store';
import KVEditor from './KVEditor';
import SecretsEditor from './widgets/SecretsEditor';

const IMAGE_PRESETS = [
  { label: 'catthehacker/ubuntu:act-latest (recommended, ~1.2 GB)', value: 'catthehacker/ubuntu:act-latest' },
  { label: 'node:20-bookworm-slim (small, shell steps only)', value: 'node:20-bookworm-slim' },
];

export default function RunDialog({ onClose }: { onClose(): void }) {
  const nodes = useEditor((s) => s.nodes);
  const engines = useRun((s) => s.engines);
  const startRun = useRun((s) => s.startRun);
  const lastDialog = useRun((s) => s.lastDialog);
  const refreshEngines = useRun((s) => s.refreshEngines);
  useEffect(() => { void refreshEngines(); }, [refreshEngines]);

  const triggers = useMemo(
    () => nodes.flatMap((n) => (n.data.kind === 'trigger' ? [n.data] : [])),
    [nodes],
  );
  const jobs = useMemo(
    () => nodes.flatMap((n) => (n.data.kind === 'job' ? [n.data.jobId] : [])),
    [nodes],
  );
  const eventOrder = (t: TriggerData) =>
    t.trigger === 'workflow_dispatch' ? 0 : t.trigger === 'workflow_call' ? 1 : t.trigger === 'push' ? 2 : 3;
  const sorted = [...triggers].sort((a, b) => eventOrder(a) - eventOrder(b));

  const [event, setEvent] = useState(lastDialog?.event ?? sorted[0]?.trigger ?? 'push');
  const [job, setJob] = useState(lastDialog?.job ?? '');
  const [engine, setEngine] = useState<'docker' | 'podman' | 'vm'>(lastDialog?.engine ?? 'docker');
  const [mode, setMode] = useState<'self-hosted' | 'container'>(lastDialog?.mode ?? 'container');
  const [image, setImage] = useState(lastDialog?.image ?? IMAGE_PRESETS[0].value);
  const [pull, setPull] = useState(lastDialog?.pull ?? false);
  const [inputs, setInputs] = useState<Record<string, string>>(lastDialog?.inputs ?? {});
  const [secrets, setSecrets] = useState<Record<string, string>>(lastDialog?.secrets ?? {});
  const [vars, setVars] = useState<Record<string, string>>(lastDialog?.vars ?? {});
  const [error, setError] = useState<string | null>(null);
  const [armedReplace, setArmedReplace] = useState(false);

  const chosen = sorted.find((t) => t.trigger === event);
  const declaredInputs: WorkflowInput[] =
    (event === 'workflow_dispatch' || event === 'workflow_call') ? chosen?.inputs ?? [] : [];
  const missingRequired = declaredInputs.filter(
    (i) => i.required && i.default === undefined && !(inputs[i.id] ?? '').length,
  );

  const submit = async (cancelPrevious?: boolean) => {
    setError(null);
    const choices: DialogChoices = { event, job: job || undefined, inputs, secrets, vars, engine, mode: engine === 'vm' ? mode : undefined, image, pull, cancelPrevious };
    const result = await startRun(choices);
    if (result === 'started') { onClose(); return; }
    if (result.conflict && !cancelPrevious) { setArmedReplace(true); setError(result.error); return; }
    setError(result.error);
  };

  const inputField = (i: WorkflowInput) => {
    const val = inputs[i.id] ?? (i.default !== undefined ? String(i.default) : '');
    const setVal = (v: string) => setInputs((cur) => ({ ...cur, [i.id]: v }));
    if (i.type === 'boolean') {
      return (
        <label key={i.id} className="io-req">
          <input type="checkbox" checked={val === 'true'} onChange={(e) => setVal(e.target.checked ? 'true' : 'false')} />
          {i.id}{i.required ? ' *' : ''}
        </label>
      );
    }
    if (i.type === 'choice') {
      return (
        <label key={i.id}>{i.id}{i.required ? ' *' : ''}
          <select value={val} onChange={(e) => setVal(e.target.value)}>
            {!val && <option value="">choose…</option>}
            {(i.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
      );
    }
    return (
      <label key={i.id}>{i.id}{i.required ? ' *' : ''}
        <input type={i.type === 'number' ? 'number' : 'text'} value={val}
          placeholder={i.description ?? ''} onChange={(e) => setVal(e.target.value)} />
      </label>
    );
  };

  return (
    <div className="modal-backdrop">
      <div className="modal run-dialog">
        <div className="modal-title">Run workflow</div>
        <div className="form">
          <label>event
            <select value={event} onChange={(e) => { setEvent(e.target.value); setInputs({}); }}>
              {sorted.map((t) => <option key={t.trigger} value={t.trigger}>{t.trigger}</option>)}
            </select>
          </label>
          {chosen && eventSpec(chosen.trigger) && declaredInputs.length > 0 && (
            <div className="run-inputs">
              <div className="section-title">inputs</div>
              {declaredInputs.map(inputField)}
            </div>
          )}
          <label>job
            <select value={job} onChange={(e) => setJob(e.target.value)}>
              <option value="">all jobs</option>
              {jobs.map((j) => <option key={j} value={j}>{j}</option>)}
            </select>
          </label>
          <label>engine
            <span className="engine-radios">
              {(['docker', 'podman', 'vm'] as const).map((eng) => {
                const info = engines?.[eng];
                return (
                  <label key={eng} className="io-req" title={info?.hint ?? info?.version ?? ''}>
                    <input type="radio" name="engine" checked={engine === eng}
                      disabled={!info?.available}
                      onChange={() => setEngine(eng)} />
                    {eng}{info?.available ? '' : ' (unavailable)'}
                  </label>
                );
              })}
            </span>
            {engines && (['docker', 'podman', 'vm'] as const)
              .filter((eng) => engines[eng] && !engines[eng].available && engines[eng].hint)
              .map((eng) => (
                <div key={eng} className="engine-hint">
                  <span className="engine-hint-icon">ⓘ</span>
                  <span><b>{eng}</b> unavailable — {engines[eng]!.hint}</span>
                </div>
              ))}
          </label>
          {engine === 'vm' && (
            <label>mode
              <span className="engine-radios">
                {(['container', 'self-hosted'] as const).map((m) => (
                  <label key={m} className="io-req" title={m === 'self-hosted' ? 'steps run on the VM OS (max fidelity)' : 'steps run in a container on the VM'}>
                    <input type="radio" name="vmmode" checked={mode === m} onChange={() => setMode(m)} /> {m}
                  </label>
                ))}
              </span>
            </label>
          )}
          <label>runner image (applies to all ubuntu-* jobs)
            <select value={IMAGE_PRESETS.some((p) => p.value === image) ? image : 'custom'}
              onChange={(e) => setImage(e.target.value === 'custom' ? '' : e.target.value)}>
              {IMAGE_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              <option value="custom">custom…</option>
            </select>
          </label>
          {!IMAGE_PRESETS.some((p) => p.value === image) && (
            <label>custom image
              <input value={image} placeholder="owner/image:tag" onChange={(e) => setImage(e.target.value)} />
            </label>
          )}
          <label className="io-req">
            <input type="checkbox" checked={pull} onChange={(e) => setPull(e.target.checked)} /> pull image before run
          </label>
          <details>
            <summary>secrets ({Object.keys(secrets).length}) — sent only to your local runner, kept in memory</summary>
            <SecretsEditor value={secrets} onChange={setSecrets} />
          </details>
          <details>
            <summary>vars ({Object.keys(vars).length})</summary>
            <KVEditor value={vars} onChange={setVars} />
          </details>
          {error && <div className="modal-error">{error}</div>}
          <div className="modal-actions">
            <span className="spacer" />
            <button type="button" className="mini" onClick={onClose}>cancel</button>
            <button type="button" className="btn-primary btn-run"
              disabled={missingRequired.length > 0 || !image}
              title={missingRequired.length ? `missing required: ${missingRequired.map((i) => i.id).join(', ')}` : ''}
              onClick={() => submit(armedReplace ? true : undefined)}>
              {armedReplace ? 'cancel current & start' : 'start ▶'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
