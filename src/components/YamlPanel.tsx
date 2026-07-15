import { useMemo, useState } from 'react';
import { toYaml } from '../model/toYaml';
import { downloadYaml } from '../lib/exportYaml';
import { useEditor } from '../store';

export default function YamlPanel() {
  const meta = useEditor((s) => s.meta);
  const activeFileName = useEditor((s) => s.activeFileName);
  const nodes = useEditor((s) => s.nodes);
  const edges = useEditor((s) => s.edges);
  const [copied, setCopied] = useState(false);
  const text = useMemo(
    () => toYaml(useEditor.getState().snapshot()),
    [meta, nodes, edges],
  );

  const copy = async () => {
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const download = () => {
    downloadYaml(activeFileName, meta.name, text);
  };

  return (
    <div className="yaml-panel">
      <div className="yaml-actions">
        <button type="button" className="mini" onClick={copy}>{copied ? 'copied ✓' : 'copy'}</button>
        <button type="button" className="mini" onClick={download}>download .yml</button>
      </div>
      <pre className="yaml-view" data-testid="yaml-view">{text}</pre>
    </div>
  );
}
