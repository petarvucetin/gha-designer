import { useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import FlowCanvas from './components/FlowCanvas';
import LeftPanel from './components/LeftPanel';
import FileViewer from './components/FileViewer';
import NoticeBar from './components/NoticeBar';
import RunPanel from './components/RunPanel';
import SidePanel from './components/SidePanel';
import Toolbar from './components/Toolbar';
import TabStrip from './components/TabStrip';
import { useFs } from './fsStore';
import { useUi } from './uiStore';
import { useRun } from './runStore';

export default function App() {
  const boot = useFs((s) => s.boot);
  useEffect(() => { boot(); }, [boot]);
  const activeRun = useRun((s) => s.activeRun);
  const showRunView = useUi((s) => s.activeView) === 'run' && !!activeRun;
  return (
    <ReactFlowProvider>
      <div className="app-shell">
        <Toolbar />
        <TabStrip />
        <div className="main">
          <LeftPanel />
          {showRunView ? (
            <RunPanel />
          ) : (
            <>
              <FlowCanvas />
              <SidePanel />
            </>
          )}
        </div>
        <FileViewer />
        <NoticeBar />
      </div>
    </ReactFlowProvider>
  );
}
