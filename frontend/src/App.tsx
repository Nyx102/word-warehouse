import { useCallback, useEffect, useState } from 'react';
import { Shell } from './components/Shell';
import { Toasts } from './components/Toasts';
import { useStatus } from './hooks/useStatus';
import { ChatPanel } from './chat/ChatPanel';
import { ThreadList, useThreads } from './chat/ThreadList';
import { SearchPanel } from './search/SearchPanel';
import { FlagsPanel } from './flags/FlagsPanel';
import { DiffsPanel } from './diffs/DiffsPanel';
import type { RepoName, TabName } from './types';

const TAB_NAMES: TabName[] = ['chat', 'search', 'flags', 'diffs'];

function tabFromHash(): TabName {
  const h = window.location.hash.replace(/^#\/?/, '');
  return (TAB_NAMES as string[]).includes(h) ? (h as TabName) : 'chat';
}

export default function App() {
  // Tab state lives in useState and mirrors into location.hash (no router).
  const [tab, setTab] = useState<TabName>(tabFromHash);
  const [diffsRepo, setDiffsRepo] = useState<RepoName>('corpus');
  const [chatBusy, setChatBusy] = useState(false);
  const { status, refresh } = useStatus();
  const threadsApi = useThreads();

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const selectTab = useCallback((t: TabName) => {
    setTab(t);
    if (window.location.hash !== '#' + t) window.location.hash = t;
  }, []);

  const jumpRepo = useCallback((r: RepoName) => {
    setDiffsRepo(r);
    selectTab('diffs');
  }, [selectTab]);

  // All panels stay mounted (CSS-hidden when inactive) so the chat SSE
  // stream, search results and editor state survive tab switches.
  return (
    <>
      <Shell
        tab={tab}
        onTab={selectTab}
        status={status}
        busy={(status?.chat_active ?? 0) > 0 || chatBusy}
        onJumpRepo={jumpRepo}
        sidebar={tab === 'chat' ? <ThreadList threadsApi={threadsApi} /> : null}
      >
        <section className={'panel' + (tab === 'chat' ? ' active' : '')}>
          <ChatPanel threadsApi={threadsApi} onTurnActiveChange={setChatBusy} />
        </section>
        <section className={'panel' + (tab === 'search' ? ' active' : '')}>
          <SearchPanel active={tab === 'search'} />
        </section>
        <section className={'panel' + (tab === 'flags' ? ' active' : '')}>
          <FlagsPanel active={tab === 'flags'} />
        </section>
        <section className={'panel' + (tab === 'diffs' ? ' active' : '')}>
          <DiffsPanel
            repo={diffsRepo}
            onRepoChange={setDiffsRepo}
            active={tab === 'diffs'}
            onGlobalRefresh={refresh}
          />
        </section>
      </Shell>
      <Toasts />
    </>
  );
}
