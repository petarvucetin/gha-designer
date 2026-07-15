import { useEffect, useState } from 'react';
import { useRun } from '../runStore';
import { computeSetup } from '../model/setup';
import { runSetupAction } from '../lib/setupAction';
import { openExternal } from '../lib/openExternal';

// Setup-effort is a visual-only dimension (not modeled elsewhere): Docker = one installer;
// Podman = install + machine init/start; VM = enable Hyper-V + reboot + build image + SSH.
// Fidelity is NOT duplicated here — it's read from each path's model `fidelity` field.
const TIER_VIZ: Record<'docker' | 'podman' | 'vm', { icon: string; setup: number }> = {
  docker: { icon: '🐳', setup: 1 },
  podman: { icon: '🦭', setup: 2 },
  vm: { icon: '🖥️', setup: 3 },
};

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <span className="setup-meter" title={`${label}: ${value} of 3`}>
      <span className="setup-meter-label">{label}</span>
      {[1, 2, 3].map((n) => (
        <span key={n} aria-hidden="true" className={`setup-meter-seg${n <= value ? ' on' : ''}`} />
      ))}
    </span>
  );
}

export default function SetupDialog({ onClose, onTrySample }: { onClose(): void; onTrySample(): void }) {
  const engines = useRun((s) => s.engines);
  const refreshEngines = useRun((s) => s.refreshEngines);
  useEffect(() => { void refreshEngines(); }, [refreshEngines]);
  const setup = computeSetup(engines);
  const copy = (t: string) => { void navigator.clipboard?.writeText(t); };
  const [action, setAction] = useState<{ id: string; output: string; running: boolean; code?: number } | null>(null);
  const run = async (id: string, engine?: string) => {
    const key = engine ? `${id}:${engine}` : id;
    setAction({ id: key, output: '', running: true });
    const { code } = await runSetupAction({ id, engine }, (text) =>
      setAction((a) => (a && a.id === key ? { ...a, output: text } : a)));
    setAction((a) => (a && a.id === key ? { ...a, running: false, code } : a));
    await refreshEngines();
  };
  const dockerReady = setup.paths.find((p) => p.id === 'docker')?.ready ?? false;
  const podmanReady = setup.paths.find((p) => p.id === 'podman')?.ready ?? false;
  return (
    <div className="modal-backdrop">
      <div className="modal setup-dialog">
        <div className="modal-title">Get ready to run</div>
        <div className="form">
          <div className={`setup-status ${setup.anyReady ? 'ok' : 'todo'}`}>
            {setup.anyReady
              ? `✓ You're ready to run — recommended engine: ${setup.paths.find((p) => p.id === setup.recommended)?.label ?? setup.recommended}.`
              : `No runner engine is set up yet. Pick a path below — the simplest is at the top.`}
          </div>
          <div className="setup-act">
            act (the workflow runner): {setup.actReady ? '✓ ready' : '✗ not found'}
            {!setup.actReady && (
              <span className="setup-cmd"><code>winget install nektos.act</code>
                <button type="button" className="mini" onClick={() => copy('winget install nektos.act')}>copy</button></span>
            )}
          </div>
          <div className="setup-legend">
            <span>Simplest at the top → most faithful at the bottom.</span>
            <span className="setup-legend-meters"><Meter label="setup" value={2} /><Meter label="fidelity" value={2} /></span>
          </div>
          {setup.paths.map((p) => (
            <div key={p.id} className={`setup-path${p.ready ? ' ready' : ''}${p.id === setup.recommended ? ' recommended' : ''}`}>
              <div className="setup-path-head">
                <span className="setup-tier-icon">{TIER_VIZ[p.id].icon}</span>
                <span className={`setup-badge ${p.ready ? 'ready' : 'todo'}`}>{p.ready ? '✓ ready' : '• not set up'}</span>
                <b>{p.label}</b>
                {p.id === setup.recommended && <span className="setup-rec">recommended</span>}
              </div>
              <div className="setup-path-meters">
                <Meter label="setup" value={TIER_VIZ[p.id].setup} />
                <Meter label="fidelity" value={p.fidelity} />
              </div>
              <div className="setup-blurb">{p.blurb}</div>
              <div className="setup-constraints">{p.constraints}</div>
              {!p.ready && (
                <ol className="setup-steps">
                  {p.steps.map((s, i) => (
                    <li key={i}>
                      {s.text}{s.elevated ? ' (admin)' : ''}
                      {s.command && (
                        <div className="setup-cmd"><code>{s.command}</code>
                          <button type="button" className="mini" onClick={() => copy(s.command!)}>copy</button>
                          {s.command.includes('podman machine start') && (
                            <button type="button" className="mini" disabled={!!action?.running} onClick={() => void run('podman-machine-start')}>▶ Start it</button>
                          )}
                        </div>
                      )}
                      {s.link && (
                        <div>
                          <a
                            href={s.link}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => { e.preventDefault(); void openExternal(s.link!); }}
                          >
                            {s.link}
                          </a>
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ))}
          {(dockerReady || podmanReady) && (
            <div className="setup-image">
              <div><b>Runner image</b> — <code>catthehacker/ubuntu:act-latest</code> is the recommended image for container runs.</div>
              <button type="button" className="mini" disabled={!!action?.running}
                onClick={() => void run('pull-image', dockerReady ? 'docker' : 'podman')}>▶ Pull it</button>
            </div>
          )}
          {action && (
            <div className="setup-action">
              <div className="setup-action-head">
                {action.running ? 'Running…' : action.code === 0 ? '✓ Done' : `Finished (exit ${action.code})`}
              </div>
              <pre className="setup-action-out">{action.output || '…'}</pre>
            </div>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" className="mini" onClick={() => void refreshEngines()}>re-check</button>
          <span className="spacer" />
          <button type="button" className="mini" onClick={onClose}>close</button>
          <button type="button" className="btn-primary" disabled={!setup.anyReady || !!action?.running} title={setup.anyReady ? '' : 'set up an engine first'} onClick={onTrySample}>Try a sample run ▶</button>
        </div>
      </div>
    </div>
  );
}
