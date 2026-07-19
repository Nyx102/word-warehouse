import { useState } from 'react';
import { SettingsProvider } from './settings';
import { WorkspaceProvider } from './workspace';
import { Toasts } from '../components/Toasts';
import { useStatus } from '../hooks/useStatus';
import { useThreads } from '../chat/useThreads';
import { Rail } from '../shell/Rail';
import { Sidebar } from '../shell/Sidebar';
import { TabBar } from '../shell/TabBar';
import { MobileNav } from '../shell/MobileNav';
import { StatusSheet } from '../shell/StatusSheet';
import { BufferArea } from '../workspace/BufferArea';
import { ChatDock } from '../chat/ChatDock';

export default function App() {
  return (
    <SettingsProvider>
      <WorkspaceProvider>
        <Workbench />
        <Toasts />
      </WorkspaceProvider>
    </SettingsProvider>
  );
}

function Workbench() {
  const { status } = useStatus();
  const threadsApi = useThreads();
  const [chatBusy, setChatBusy] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const busy = (status?.chat_active ?? 0) > 0 || chatBusy;
  const dirty = (status?.git?.corpus?.dirty ?? 0) + (status?.git?.repo?.dirty ?? 0) > 0;

  return (
    <div className="shell">
      <div className="shell-body">
        <Rail busy={busy} dirty={dirty} onOpenSheet={() => setSheetOpen(true)} />
        <Sidebar threadsApi={threadsApi} />
        <div className="ws-center">
          <TabBar />
          <div className="ws-work">
            <BufferArea />
            <ChatDock threadsApi={threadsApi} onTurnActiveChange={setChatBusy} />
          </div>
        </div>
      </div>
      <MobileNav busy={busy} dirty={dirty} onOpenSheet={() => setSheetOpen(true)} />
      {sheetOpen && <StatusSheet status={status} busy={busy} onClose={() => setSheetOpen(false)} />}
    </div>
  );
}
