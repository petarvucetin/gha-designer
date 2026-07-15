import Inspector from './Inspector';
import ProblemsPanel, { useProblems } from './ProblemsPanel';
import YamlPanel from './YamlPanel';
import HelpPanel from './HelpPanel';
import { useUi, type SidebarTab } from '../uiStore';

export default function SidePanel() {
  const tab = useUi((s) => s.sidebarTab);
  const setTab = useUi((s) => s.setSidebarTab);
  const problems = useProblems();
  return (
    <aside className="sidebar">
      <nav className="tabs">
        {(['config', 'yaml', 'problems', 'help'] as SidebarTab[]).map((t) => (
          <button key={t} type="button"
            className={`tab${tab === t ? ' active' : ''}`}
            onClick={() => setTab(t)}>
            {t}{t === 'problems' && problems.length > 0 ? ` (${problems.length})` : ''}
          </button>
        ))}
      </nav>
      {tab === 'config' && <Inspector />}
      {tab === 'yaml' && <YamlPanel />}
      {tab === 'problems' && <ProblemsPanel />}
      {tab === 'help' && <HelpPanel />}
    </aside>
  );
}
