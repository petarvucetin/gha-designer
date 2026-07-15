import { useState } from 'react';
import Palette from './Palette';
import FilesPanel from './FilesPanel';

export default function LeftPanel() {
  const [tab, setTab] = useState<'palette' | 'files'>('palette');
  return (
    <div className="left-panel">
      <nav className="tabs left-tabs">
        {(['palette', 'files'] as const).map((t) => (
          <button key={t} type="button" className={`tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>{t}</button>
        ))}
      </nav>
      <div className="left-body">{tab === 'palette' ? <Palette /> : <FilesPanel />}</div>
    </div>
  );
}
