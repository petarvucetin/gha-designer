import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../store';
import { useRun } from '../runStore';
import { toYaml } from '../model/toYaml';
import { downloadYaml } from '../lib/exportYaml';
import { deriveMarker } from '../model/binding';
import { useFs } from '../fsStore';
import RunDialog from './RunDialog';
import SetupDialog from './SetupDialog';
import { SAMPLE_WORKFLOW, computeSetup } from '../model/setup';

function ImportDialog({ onClose }: { onClose(): void }) {
  const importYaml = useEditor((s) => s.importYaml);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const doImport = () => {
    try {
      importYaml(text);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onFile = async (f: File | undefined) => {
    if (f) setText(await f.text());
  };

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-title">Import workflow YAML</div>
        <div className="hint">Imports into a new tab.</div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste .github/workflows/*.yml content here…"
          rows={14}
        />
        {error && <div className="modal-error">{error}</div>}
        <div className="modal-actions">
          <input ref={fileRef} type="file" accept=".yml,.yaml" hidden
            onChange={(e) => onFile(e.target.files?.[0])} />
          <button type="button" className="mini" onClick={() => fileRef.current?.click()}>open file…</button>
          <span className="spacer" />
          <button type="button" className="mini" onClick={onClose}>cancel</button>
          <button type="button" className="btn-primary" onClick={doImport}>import</button>
        </div>
      </div>
    </div>
  );
}

export default function Toolbar() {
  const name = useEditor((s) => s.meta.name);
  const activeFileName = useEditor((s) => s.activeFileName);
  const updateMeta = useEditor((s) => s.updateMeta);
  const autoLayout = useEditor((s) => s.autoLayout);
  const reset = useEditor((s) => s.reset);
  const importYaml = useEditor((s) => s.importYaml);
  const [importing, setImporting] = useState(false);
  const [armedClear, setArmedClear] = useState(false);
  const [running, setRunning] = useState(false); // dialog visibility
  const [setupOpen, setSetupOpen] = useState(false);
  const autoOpened = useRef(false);
  const server = useRun((s) => s.server);
  const engines = useRun((s) => s.engines);
  const refreshEngines = useRun((s) => s.refreshEngines);
  const hasTrigger = useEditor((s) => s.nodes.some((n) => n.data.kind === 'trigger'));
  useEffect(() => { void refreshEngines(); }, [refreshEngines]);
  useEffect(() => {
    if (autoOpened.current || !engines) return;
    autoOpened.current = true;
    if (!computeSetup(engines).anyReady && !localStorage.getItem('gha-setup-dismissed')) setSetupOpen(true);
  }, [engines]);
  const runDisabled = server === 'down' || engines?.act.available === false || !hasTrigger;
  const runTitle = server === 'down'
    ? 'Runner server is offline — start it with: npm run server'
    : engines?.act.available === false
      ? engines.act.hint ?? 'act is not installed'
      : !hasTrigger ? 'Add a trigger node first' : 'Run this workflow locally';

  const activeDoc = useEditor((s) => s.workflows.find((w) => w.id === s.activeId));
  const liveNodes = useEditor((s) => s.nodes);   // re-render on edit
  const liveEdges = useEditor((s) => s.edges);
  const liveMeta = useEditor((s) => s.meta);
  const folderRoot = useFs((s) => (s.folder?.status === 'open' ? s.folder.root : null));
  const saveActive = useFs((s) => s.saveActive);
  const saveError = useFs((s) => s.saveError);

  const hasSource = !!activeDoc?.source;
  const mk = activeDoc
    ? deriveMarker(activeDoc, folderRoot, toYaml(useEditor.getState().snapshot()))
    : { bound: false, live: false, marker: '' as const };
  const saveEnabled = mk.live && (mk.marker === '●' || mk.marker === '⚠' || mk.marker === '✂');

  const doSave = () => {
    if (!saveEnabled || !activeDoc) return;
    void saveActive();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault(); // ALWAYS — never the browser Save dialog
        doSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveEnabled, saveActive, activeDoc?.id]);

  void liveNodes; void liveEdges; void liveMeta; // referenced to force marker recompute

  const onClear = () => {
    if (armedClear) {
      reset();
      setArmedClear(false);
    } else {
      setArmedClear(true);
      setTimeout(() => setArmedClear(false), 2500);
    }
  };

  return (
    <header className="topbar">
      <span className="brand">GitHub Actions Designer</span>
      <input
        className="wf-name-input"
        value={name}
        onChange={(e) => updateMeta({ name: e.target.value })}
        aria-label="workflow name"
      />
      <span className="spacer" />
      <button type="button" className="topbtn" onClick={autoLayout}>auto-layout</button>
      <button type="button" className="topbtn" onClick={() => setSetupOpen(true)}>setup</button>
      <button type="button" className="topbtn topbtn-run" disabled={runDisabled} title={runTitle}
        onClick={() => setRunning(true)}>run ▶</button>
      <button type="button" className="topbtn" onClick={onClear}>
        {armedClear ? 'really clear?' : 'clear'}
      </button>
      <button type="button" className="topbtn" onClick={() => setImporting(true)}>import</button>
      {hasSource && (
        <button type="button" className="topbtn topbtn-save" disabled={!saveEnabled}
          title={mk.live
            ? (saveEnabled ? 'Save to disk (Ctrl+S)' : 'No changes to save')
            : `Unlinked — reopen ${activeDoc?.source?.path ?? 'the folder'} to save`}
          onClick={doSave}>
          save
        </button>
      )}
      {saveError && <span className="save-error" title={saveError}>{saveError}</span>}
      <button
        type="button"
        className="topbtn topbtn-export"
        onClick={() => downloadYaml(activeFileName, name, toYaml(useEditor.getState().snapshot()))}
      >
        export .yml
      </button>
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
      {running && <RunDialog onClose={() => setRunning(false)} />}
      {setupOpen && (
        <SetupDialog
          onClose={() => { setSetupOpen(false); try { localStorage.setItem('gha-setup-dismissed', '1'); } catch { /* ignore */ } }}
          onTrySample={() => {
            importYaml(SAMPLE_WORKFLOW);
            setSetupOpen(false);
            try { localStorage.setItem('gha-setup-dismissed', '1'); } catch { /* ignore */ }
            setRunning(true);
          }}
        />
      )}
    </header>
  );
}
