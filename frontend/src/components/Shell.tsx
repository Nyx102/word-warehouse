import { ReactNode, useState } from 'react';
import { fmtAge } from '../util';
import { HelpModal } from './HelpModal';
import type { RepoName, StatusInfo, TabName } from '../types';

const TABS: { id: TabName; label: string }[] = [
  { id: 'chat', label: 'Chat' },
  { id: 'search', label: 'Search' },
  { id: 'flags', label: 'Flags' },
  { id: 'diffs', label: 'Diffs' },
  { id: 'files', label: 'Files' },
];

/** App chrome: top bar (tabs + status pills) on desktop, fixed bottom tab bar
 * and a status dot opening a sheet on mobile. The thread sidebar slot only
 * renders on the Chat tab (and is CSS-hidden below 1024px). */
export function Shell({ tab, onTab, status, busy, onJumpRepo, sidebar, children }: {
  tab: TabName;
  onTab: (t: TabName) => void;
  status: StatusInfo | null;
  busy: boolean; // a chat turn is running somewhere
  onJumpRepo: (repo: RepoName) => void;
  sidebar: ReactNode | null;
  children: ReactNode;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const idx = status?.index;
  const dirtyCorpus = status?.git?.corpus?.dirty ?? 0;
  const dirtyRepo = status?.git?.repo?.dirty ?? 0;
  const anyDirty = dirtyCorpus + dirtyRepo > 0;

  const jump = (repo: RepoName) => {
    setSheetOpen(false);
    onJumpRepo(repo);
  };

  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">Word Warehouse</span>
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={'tab-btn' + (tab === t.id ? ' active' : '')}
              onClick={() => onTab(t.id)}
            >{t.label}</button>
          ))}
        </nav>
        <div className="status-pills">
          {busy && <span className="spinner" title="A chat turn is running" />}
          <span className="st-item" title={`${idx?.files ?? 0} files indexed`}>
            {idx ? idx.chunks.toLocaleString() + ' chunks' : '—'}
          </span>
          {idx?.last_scan_age_s != null && (
            <span className="st-item dim">fresh {fmtAge(idx.last_scan_age_s)} ago</span>
          )}
          {dirtyCorpus > 0 && (
            <button className="dirty-badge" title="Dirty files in corpus (raws, notes)" onClick={() => jump('corpus')}>
              corpus {dirtyCorpus}
            </button>
          )}
          {dirtyRepo > 0 && (
            <button className="dirty-badge" title="Dirty files in translation repo" onClick={() => jump('repo')}>
              repo {dirtyRepo}
            </button>
          )}
          <button className="st-item help-btn" title="Help" aria-label="Help"
            onClick={() => setHelpOpen(true)}>?</button>
        </div>
        <button
          className={'status-dot-btn' + (busy ? ' busy' : anyDirty ? ' dirty' : '')}
          onClick={() => setSheetOpen(true)}
          title="Status"
          aria-label="Status"
        >
          <span className="status-dot" />
        </button>
      </header>

      <div className="shell-body">
        {sidebar != null && <aside className="sidebar">{sidebar}</aside>}
        <main className="panels">{children}</main>
      </div>

      <nav className="bottom-nav">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={'bn-btn' + (tab === t.id ? ' active' : '')}
            onClick={() => onTab(t.id)}
          >
            <span className="bn-label">{t.label}</span>
          </button>
        ))}
      </nav>

      {sheetOpen && (
        <div
          className="sheet-backdrop"
          onClick={(e) => { if (e.target === e.currentTarget) setSheetOpen(false); }}
        >
          <div className="sheet" role="dialog" aria-label="Status">
            <div className="sheet-grip" />
            <div className="sheet-row">
              <span>Index</span>
              <span>{idx ? `${idx.chunks.toLocaleString()} chunks · ${idx.files} files` : 'unknown'}</span>
            </div>
            <div className="sheet-row">
              <span>Freshness</span>
              <span>{idx?.last_scan_age_s != null ? `scanned ${fmtAge(idx.last_scan_age_s)} ago` : '—'}</span>
            </div>
            <button className="sheet-row linkish" onClick={() => jump('corpus')}>
              <span>Corpus dirty files</span>
              <span>{dirtyCorpus}</span>
            </button>
            <button className="sheet-row linkish" onClick={() => jump('repo')}>
              <span>Repo dirty files</span>
              <span>{dirtyRepo}</span>
            </button>
            <div className="sheet-row">
              <span>Chat</span>
              <span>{busy ? <span className="busy-note"><span className="spinner" /> turn running</span> : 'idle'}</span>
            </div>
            <button className="sheet-row linkish"
              onClick={() => { setSheetOpen(false); setHelpOpen(true); }}>
              <span>Help</span>
              <span>?</span>
            </button>
            <button className="btn sheet-close" onClick={() => setSheetOpen(false)}>Close</button>
          </div>
        </div>
      )}

      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
    </div>
  );
}
