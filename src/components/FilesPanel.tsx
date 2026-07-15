import { useMemo, useState } from 'react';
import { useFs, type FsEntry } from '../fsStore';
import { useEditor } from '../store';
import { toYaml } from '../model/toYaml';
import { deriveMarker } from '../model/binding';

type TreeNode = { name: string; path: string; type: 'file' | 'dir'; children: TreeNode[] };

function buildTree(entries: FsEntry[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const byPath = new Map<string, TreeNode>();
  for (const e of entries) {
    const parts = e.path.split('/');
    const node: TreeNode = { name: parts[parts.length - 1], path: e.path, type: e.type, children: [] };
    byPath.set(e.path, node);
    const parent = parts.length > 1 ? byPath.get(parts.slice(0, -1).join('/')) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  return roots;
}

function Rows({ nodes, markerFor, onOpen }: {
  nodes: TreeNode[];
  markerFor(path: string): { bound: boolean; marker: string };
  onOpen(path: string): void;
}) {
  return (
    <>
      {nodes.map((n) => (n.type === 'dir' ? (
        <details key={n.path} className="fs-dir" open={n.path === 'workflows'}>
          <summary>{n.name}</summary>
          <div className="fs-children"><Rows nodes={n.children} markerFor={markerFor} onOpen={onOpen} /></div>
        </details>
      ) : (() => {
        const mk = markerFor(n.path);
        return (
          <button key={n.path} type="button" className={`fs-file${mk.bound ? ' bound' : ''}`} title={n.path} onClick={() => onOpen(n.path)}>
            <span className="fs-file-name">{n.name}</span>
            {mk.marker && <span className="fs-marker">{mk.marker}</span>}
          </button>
        );
      })()))}
    </>
  );
}

export default function FilesPanel() {
  const folder = useFs((s) => s.folder);
  const openFolder = useFs((s) => s.openFolder);
  const closeFolder = useFs((s) => s.closeFolder);
  const openEntry = useFs((s) => s.openEntry);
  const workflows = useEditor((s) => s.workflows);
  const activeId = useEditor((s) => s.activeId);
  const nodes = useEditor((s) => s.nodes);   // selected so the active row's ● stays live on edits
  const edges = useEditor((s) => s.edges);
  const meta = useEditor((s) => s.meta);
  const [input, setInput] = useState('');

  const markerFor = useMemo(() => {
    const root = folder?.status === 'open' ? folder.root : null;
    const byPath = new Map<string, { bound: boolean; marker: string }>();
    for (const doc of workflows) {
      if (!doc.source || doc.source.root !== root) continue;
      const yaml = doc.id === activeId ? toYaml(useEditor.getState().snapshot()) : toYaml({ meta: doc.meta, nodes: doc.nodes, edges: doc.edges });
      const { bound, marker } = deriveMarker(doc, root, yaml);
      byPath.set(doc.source.path, { bound, marker });
    }
    return (path: string) => byPath.get(path) ?? { bound: false, marker: '' };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder, workflows, activeId, nodes, edges, meta]);

  const tree = useMemo(() => (folder?.status === 'open' ? buildTree(folder.entries) : []), [folder]);

  if (!folder || folder.status === 'error') {
    return (
      <div className="files-panel">
        <div className="files-open">
          <input value={input} placeholder="absolute path to a repo or .github folder"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && input.trim()) void openFolder(input.trim()); }} />
          <button type="button" className="mini" disabled={!input.trim()} onClick={() => void openFolder(input.trim())}>open</button>
        </div>
        {folder?.status === 'error' && (
          <div className="files-error">
            {folder.error}
            <button type="button" className="mini" onClick={() => void openFolder(folder.input)}>retry</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="files-panel">
      <div className="files-head">
        <span className="files-root" title={folder.root}>{folder.root}</span>
        <button type="button" className="mini" onClick={closeFolder}>close</button>
      </div>
      {folder.truncated && <div className="files-note">Showing the first 2,000 entries.</div>}
      <div className="files-tree">
        <Rows nodes={tree} markerFor={markerFor} onOpen={(p) => void openEntry(p)} />
      </div>
    </div>
  );
}
