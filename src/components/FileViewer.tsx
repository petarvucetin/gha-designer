import 'highlight.js/styles/github-dark.css';
import { useFs } from '../fsStore';
import { highlightCode } from '../model/highlight';

export default function FileViewer() {
  const viewer = useFs((s) => s.viewer);
  const closeViewer = useFs((s) => s.closeViewer);
  if (!viewer) return null;
  const highlighted =
    viewer.kind === 'text' && viewer.content !== undefined
      ? highlightCode(viewer.path, viewer.content)
      : null;
  return (
    <div className="modal-backdrop" onClick={closeViewer}>
      <div className="modal file-viewer" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">
          <span className="file-viewer-path" title={viewer.path}>{viewer.path}</span>
          {highlighted?.language && <span className="file-viewer-lang">{highlighted.language}</span>}
          <button type="button" className="mini" onClick={closeViewer}>close</button>
        </div>
        {viewer.note && <div className="hint">{viewer.note}</div>}
        {highlighted && (
          <pre className="file-viewer-pre">
            {/* highlightCode escapes source before wrapping tokens, so this HTML is safe. */}
            <code className="hljs" dangerouslySetInnerHTML={{ __html: highlighted.html }} />
          </pre>
        )}
        {viewer.kind === 'image' && <img className="file-viewer-img" alt={viewer.path} src={`data:${viewer.mime};base64,${viewer.content}`} />}
        {viewer.kind === 'binary' && viewer.content === undefined && !viewer.note?.includes('bytes') && (
          <div className="hint">No preview available.</div>
        )}
      </div>
    </div>
  );
}
