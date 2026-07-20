import { useState } from 'react';
import { SettingsProvider } from '@/context/settings';
import { WorkspaceProvider } from '@/context/workspace';
import { Toasts } from '@/components/Toasts';
import { useStatus } from '@/hooks/useStatus';
import { useThreads } from '@/features/chat/useThreads';
import { Rail } from '@/components/layout/Rail';
import { Sidebar } from '@/components/layout/Sidebar';
import { TabBar } from '@/components/layout/TabBar';
import { MobileNav } from '@/components/layout/MobileNav';
import { StatusSheet } from '@/components/layout/StatusSheet';
import { ModeLine } from '@/components/layout/ModeLine';
import { BufferArea } from '@/components/buffers/BufferArea';
import { ChatDock } from '@/features/chat/ChatDock';

export default function App() {
  return (
    <SettingsProvider>
      <WorkspaceProvider>
        <Shell />
        <Toasts />
      </WorkspaceProvider>
    </SettingsProvider>
  );
}

function Shell() {
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
            <div className="ws-main">
              <BufferArea />
              <ModeLine status={status} busy={busy} />
            </div>
            <ChatDock threadsApi={threadsApi} onTurnActiveChange={setChatBusy} />
          </div>
        </div>
      </div>
      <MobileNav busy={busy} dirty={dirty} onOpenSheet={() => setSheetOpen(true)} />
      {sheetOpen && <StatusSheet status={status} busy={busy} onClose={() => setSheetOpen(false)} />}
    </div>
  );
}
