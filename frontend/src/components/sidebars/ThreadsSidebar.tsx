import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { useWorkspace } from '@/context/workspace';
import { useThreadsContext } from '@/context/threads';
import { useThreadMutations } from '@/features/chat/useThreadMutations';
import { IconChevronRight } from '@/components/layout/icons';
import type { Thread, ThreadId } from '@/lib/types';

type ThreadMutations = ReturnType<typeof useThreadMutations>;

/** Epoch seconds -> compact age (now / 5m / 3h / 2d / 4w) */
function relTime(v: number | null): string {
  if (v == null || !Number.isFinite(v) || v <= 0) return '';
  const s = Math.max(0, Date.now() / 1000 - v);
  if (s < 60) return 'now';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  if (s < 604800) return Math.floor(s / 86400) + 'd';
  return Math.floor(s / 604800) + 'w';
}

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >{children}</svg>
  );
}

const IconPin = () => (
  <Svg><path d="M9 3h6l-1 7 3 2v2H7v-2l3-2z" /><path d="M12 14v7" /></Svg>
);
const IconUnpin = () => (
  <Svg><path d="M9 3h6l-1 7 3 2v2H7v-2l3-2z" /><path d="M12 14v7" /><path d="M4 4l16 16" /></Svg>
);
const IconArchive = () => (
  <Svg>
    <rect x="3" y="4" width="18" height="4" rx="1" />
    <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
    <path d="M10 12h4" />
  </Svg>
);
const IconUnarchive = () => (
  <Svg>
    <rect x="3" y="4" width="18" height="4" rx="1" />
    <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
    <path d="M12 18v-6" /><path d="M9.5 14.5 12 12l2.5 2.5" />
  </Svg>
);
const IconRename = () => <Svg><path d="M17 3l4 4L8 20l-5 1 1-5z" /></Svg>;
const IconTrash = () => (
  <Svg>
    <path d="M3 6h18" />
    <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
    <path d="M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" />
  </Svg>
);

/** Chat section: thread management. Pinned on top, plain threads in the
 * middle, archived collapsed at the bottom. Selecting a thread reveals the
 * chat dock (forced full-screen on phones by CSS). Also reused inside the
 * chat panel's narrow-viewport drawer via onAfterSelect. */
export function ThreadsSidebar({ onAfterSelect }: {
  onAfterSelect?: () => void;
}) {
  const ws = useWorkspace();
  const { threads, selectedId, select: selectThread, label } = useThreadsContext();
  const mut = useThreadMutations();
  const [showArchived, setShowArchived] = useState(false);
  const [renamingId, setRenamingId] = useState<ThreadId | null>(null);
  const [menuId, setMenuId] = useState<ThreadId | null>(null);

  const pinned = threads.filter((t) => t.pinned && !t.archived);
  const main = threads.filter((t) => !t.pinned && !t.archived);
  const archived = threads.filter((t) => t.archived);

  const afterSelect = () => {
    if (ws.chatDock === 'hidden') ws.setChatDock('docked');
    ws.setDrawerOpen(false);
    onAfterSelect?.();
  };

  const select = (id: ThreadId) => {
    selectThread(id);
    afterSelect();
  };

  const onNew = () => {
    void mut.create().then(afterSelect).catch(() => {});
  };

  const row = (t: Thread) => (
    <ThreadRow
      key={String(t.id)}
      t={t}
      label={label}
      mut={mut}
      active={t.id === selectedId}
      renaming={t.id === renamingId}
      menuOpen={t.id === menuId}
      onSelect={() => select(t.id)}
      onStartRename={() => { setMenuId(null); setRenamingId(t.id); }}
      onCloseRename={() => setRenamingId(null)}
      onToggleMenu={() => setMenuId((cur) => (cur === t.id ? null : t.id))}
      onCloseMenu={() => setMenuId(null)}
    />
  );

  return (
    <div className="thread-pane">
      <div className="thread-head">
        <span className="pane-title">Threads</span>
        <button className="btn btn-sm" title="New chat thread" onClick={onNew}>+ New</button>
      </div>
      <div className="thread-scroll">
        {pinned.length > 0 && (
          <>
            <div className="thread-sec">Pinned</div>
            <ul className="thread-list">{pinned.map(row)}</ul>
          </>
        )}
        {main.length > 0 && <ul className="thread-list">{main.map(row)}</ul>}
        {pinned.length === 0 && main.length === 0 && archived.length === 0 && (
          <div className="empty">No threads yet.</div>
        )}
        {archived.length > 0 && (
          <>
            <button
              className="thread-sec thread-sec-toggle"
              aria-expanded={showArchived}
              onClick={() => setShowArchived((v) => !v)}
            >
              <span className={'sec-chev' + (showArchived ? ' open' : '')}><IconChevronRight /></span>
              <span className="sec-label">Archived ({archived.length})</span>
            </button>
            {showArchived && <ul className="thread-list">{archived.map(row)}</ul>}
          </>
        )}
      </div>
    </div>
  );
}

function ThreadRow({
  t, label, mut, active, renaming, menuOpen,
  onSelect, onStartRename, onCloseRename, onToggleMenu, onCloseMenu,
}: {
  t: Thread;
  label: (t: Thread) => string;
  mut: ThreadMutations;
  active: boolean;
  renaming: boolean;
  menuOpen: boolean;
  onSelect: () => void;
  onStartRename: () => void;
  onCloseRename: () => void;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
}) {
  const lbl = label(t);
  const isPinned = !!t.pinned;
  const isArchived = !!t.archived;

  const doPin = () => void mut.setPinned(t.id, !isPinned).catch(() => {});
  const doArchive = () => void mut.setArchived(t.id, !isArchived).catch(() => {});
  const doDelete = () => {
    if (window.confirm('Delete this thread?')) void mut.remove(t.id).catch(() => {});
  };

  const commitRename = (value: string) => {
    const title = value.trim();
    onCloseRename();
    if (title && title !== lbl) void mut.rename(t.id, title).catch(() => {});
  };

  const onRenameKey = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename(e.currentTarget.value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCloseRename();
    }
  };

  if (renaming) {
    return (
      <li className="thread renaming">
        <input
          className="thread-rename"
          defaultValue={lbl}
          autoFocus
          aria-label="Thread title"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={onRenameKey}
          onBlur={onCloseRename}
        />
      </li>
    );
  }

  const act = (
    tip: string,
    icon: ReactNode,
    fn: () => void,
    danger = false,
  ) => (
    <button
      className={'thread-act' + (danger ? ' danger' : '')}
      title={tip}
      aria-label={tip + ' thread'}
      onClick={(e) => { e.stopPropagation(); fn(); }}
    >{icon}</button>
  );

  const menuItem = (text: string, fn: () => void, danger = false) => (
    <button
      role="menuitem"
      className={danger ? 'danger' : undefined}
      onClick={(e) => { e.stopPropagation(); onCloseMenu(); fn(); }}
    >{text}</button>
  );

  return (
    <li
      className={'thread' + (active ? ' active' : '') + (isArchived ? ' archived' : '')}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onSelect(); }}
    >
      <div className="thread-body">
        <span className="thread-title" title={lbl}>{lbl}</span>
        <span className="thread-meta">
          <span className="thread-time">{relTime(t.last_active ?? t.created_at)}</span>
          {t.model && <span className="thread-model">{t.model}</span>}
        </span>
      </div>
      <span className="thread-actions">
        {act(isPinned ? 'Unpin' : 'Pin', isPinned ? <IconUnpin /> : <IconPin />, doPin)}
        {act(isArchived ? 'Unarchive' : 'Archive', isArchived ? <IconUnarchive /> : <IconArchive />, doArchive)}
        {act('Rename', <IconRename />, onStartRename)}
        {act('Delete', <IconTrash />, doDelete, true)}
      </span>
      <button
        className="thread-kebab"
        title="Thread actions"
        aria-label="Thread actions"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={(e) => { e.stopPropagation(); onToggleMenu(); }}
      >⋮</button>
      {menuOpen && (
        <>
          <div
            className="thread-menu-backdrop"
            onClick={(e) => { e.stopPropagation(); onCloseMenu(); }}
          />
          <div className="thread-menu" role="menu">
            {menuItem(isPinned ? 'Unpin' : 'Pin', doPin)}
            {menuItem(isArchived ? 'Unarchive' : 'Archive', doArchive)}
            {menuItem('Rename', onStartRename)}
            {menuItem('Delete', doDelete, true)}
          </div>
        </>
      )}
    </li>
  );
}
