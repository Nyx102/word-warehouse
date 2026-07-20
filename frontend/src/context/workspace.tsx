import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { bufferId, bufferTitle, sanitizeDesc, type BufferDesc } from '@/components/buffers/buffers';
import type { RepoName } from '@/lib/types';

export type RailSection = 'files' | 'search' | 'git' | 'flags' | 'chat';
export type ChatDockState = 'hidden' | 'docked' | 'full';

export interface BufferEntry {
  id: string;
  desc: BufferDesc;
  title: string;
  dirty: boolean;
}

interface WsState {
  buffers: BufferEntry[];
  activeId: string | null;
  rail: RailSection;
  sidebarCollapsed: boolean;
  chatDock: ChatDockState;
  chatWidth: number;
  sidebarWidth: number;
  /** Repo picked in the Git section; shared so the rail can jump straight
   * to that repo's status buffer without prop-drilling from the sidebar */
  gitRepo: RepoName;
}

export interface WorkspaceApi extends WsState {
  /** Transient narrow-viewport sidebar overlay; never persisted */
  drawerOpen: boolean;
  open: (desc: BufferDesc) => void;
  close: (id: string) => void;
  /** Close a batch (context-menu "close others/right/all"); one confirm covers
   * any unsaved buffers in the set. */
  closeMany: (ids: string[]) => void;
  activate: (id: string) => void;
  setDirty: (id: string, dirty: boolean) => void;
  setTitle: (id: string, title: string) => void;
  setRail: (s: RailSection) => void;
  setSidebarCollapsed: (v: boolean) => void;
  setDrawerOpen: (v: boolean) => void;
  setChatDock: (v: ChatDockState) => void;
  setChatWidth: (px: number) => void;
  setSidebarWidth: (px: number) => void;
  setGitRepo: (r: RepoName) => void;
}

const STORAGE_KEY = 'worldend.workspace.v1';
const MAX_BUFFERS = 12;
const RAILS: RailSection[] = ['files', 'search', 'git', 'flags', 'chat'];
const DOCKS: ChatDockState[] = ['hidden', 'docked', 'full'];

// Panel widths adapt to the viewport and can be dragged large, but never so
// large that the editor (main) is squeezed below MIN_MAIN. RAIL_W is the fixed
// rail column present at the desktop widths where dragging is enabled.
const RAIL_W = 48;
const MIN_MAIN = 240;
const SIDEBAR_MIN = 220;
// Narrowest the chat dock can be dragged: keeps the message column and the
// composer bar (model dropdown + send) comfortably readable at small widths.
const CHAT_MIN = 272;

const viewportW = () => (typeof window !== 'undefined' ? window.innerWidth : 1440);

// Default width that scales with screen size, capped so huge monitors don't
// hand a panel half the window; the user can still drag past the cap.
const scaledDefault = (frac: number, floor: number, cap: number) =>
  Math.max(floor, Math.min(cap, Math.round(viewportW() * frac)));

// `reserved` is the width the OTHER docked panel already claims, so the two
// together can never crowd the editor below MIN_MAIN.
const clampSidebar = (px: number, reserved: number) => {
  const max = Math.max(SIDEBAR_MIN, viewportW() - RAIL_W - MIN_MAIN - reserved);
  return Math.max(SIDEBAR_MIN, Math.min(max, Math.round(px)));
};
const clampChat = (px: number, reserved: number) => {
  const max = Math.max(CHAT_MIN, viewportW() - RAIL_W - MIN_MAIN - reserved);
  return Math.max(CHAT_MIN, Math.min(max, Math.round(px)));
};

function restoreState(): WsState {
  const out: WsState = {
    buffers: [],
    activeId: null,
    rail: 'files',
    sidebarCollapsed: false,
    chatDock: 'docked',
    chatWidth: scaledDefault(0.26, 380, 560),
    sidebarWidth: scaledDefault(0.22, 300, 440),
    gitRepo: 'corpus',
  };
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Record<string, unknown>;
    const seen = new Set<string>();
    if (Array.isArray(raw.buffers)) {
      for (const item of raw.buffers.slice(0, MAX_BUFFERS)) {
        const desc = sanitizeDesc((item as { desc?: unknown } | null)?.desc);
        if (!desc) continue;
        const id = bufferId(desc);
        if (seen.has(id)) continue;
        seen.add(id);
        out.buffers.push({ id, desc, title: bufferTitle(desc), dirty: false });
      }
    }
    out.activeId = typeof raw.activeId === 'string' && seen.has(raw.activeId)
      ? raw.activeId
      : (out.buffers.length ? out.buffers[out.buffers.length - 1].id : null);
    if (RAILS.includes(raw.rail as RailSection)) out.rail = raw.rail as RailSection;
    if (typeof raw.sidebarCollapsed === 'boolean') out.sidebarCollapsed = raw.sidebarCollapsed;
    if (DOCKS.includes(raw.chatDock as ChatDockState)) out.chatDock = raw.chatDock as ChatDockState;
    if (typeof raw.sidebarWidth === 'number' && Number.isFinite(raw.sidebarWidth)) {
      out.sidebarWidth = clampSidebar(raw.sidebarWidth, 0);
    }
    if (typeof raw.chatWidth === 'number' && Number.isFinite(raw.chatWidth)) {
      out.chatWidth = clampChat(raw.chatWidth, out.sidebarCollapsed ? 0 : out.sidebarWidth);
    }
    if (raw.gitRepo === 'corpus' || raw.gitRepo === 'repo') out.gitRepo = raw.gitRepo;
  } catch { /* Corrupted -> defaults */ }
  return out;
}

const WorkspaceContext = createContext<WorkspaceApi | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WsState>(restoreState);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  // Activation order, oldest first; drives next-active on close and LRU eviction
  const lruRef = useRef<string[]>(state.buffers.map((b) => b.id));

  const bumpLru = (id: string) => {
    lruRef.current = [...lruRef.current.filter((x) => x !== id), id];
  };

  useEffect(() => {
    const ids = new Set(state.buffers.map((b) => b.id));
    lruRef.current = lruRef.current.filter((id) => ids.has(id));
  }, [state.buffers]);

  // Debounced persistence; drawerOpen deliberately excluded
  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          buffers: state.buffers.map((b) => ({ desc: b.desc })),
          activeId: state.activeId,
          rail: state.rail,
          sidebarCollapsed: state.sidebarCollapsed,
          chatDock: state.chatDock,
          chatWidth: state.chatWidth,
          sidebarWidth: state.sidebarWidth,
          gitRepo: state.gitRepo,
        }));
      } catch { /* Storage unavailable -> layout lives for the session only */ }
    }, 300);
    return () => window.clearTimeout(t);
  }, [state]);

  const activate = useCallback((id: string) => {
    bumpLru(id);
    setState((s) => (s.buffers.some((b) => b.id === id) && s.activeId !== id
      ? { ...s, activeId: id }
      : s));
  }, []);

  const open = useCallback((desc: BufferDesc) => {
    const id = bufferId(desc);
    bumpLru(id);
    setState((s) => {
      // Full-screen chat would cover the buffer being opened; phones have no
      // room for a docked panel so it hides there instead
      const chatDock = s.chatDock !== 'full'
        ? s.chatDock
        : (window.matchMedia('(max-width: 767px)').matches ? 'hidden' : 'docked');
      const existing = s.buffers.find((b) => b.id === id);
      if (existing) {
        // Re-opening a file/diff with a target line updates the desc so deep
        // links re-jump; identity and dirty state are untouched
        const update = (desc.kind === 'file' || desc.kind === 'diff') && desc.line != null;
        const buffers = update
          ? s.buffers.map((b) => (b.id === id ? { ...b, desc, title: bufferTitle(desc) } : b))
          : s.buffers;
        return { ...s, buffers, activeId: id, chatDock };
      }
      let buffers = [...s.buffers, { id, desc, title: bufferTitle(desc), dirty: false }];
      if (buffers.length > MAX_BUFFERS) {
        // Soft cap: evict clean buffers only, least recently active first
        const order = lruRef.current;
        const evictable = buffers
          .filter((b) => !b.dirty && b.id !== id)
          .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
        for (const victim of evictable) {
          if (buffers.length <= MAX_BUFFERS) break;
          buffers = buffers.filter((b) => b.id !== victim.id);
        }
      }
      return { ...s, buffers, activeId: id, chatDock };
    });
  }, []);

  const close = useCallback((id: string) => {
    const buf = stateRef.current.buffers.find((b) => b.id === id);
    if (!buf) return;
    if (buf.dirty && !window.confirm(`Close ${buf.title}? Unsaved changes will be lost.`)) return;
    setState((s) => {
      const buffers = s.buffers.filter((b) => b.id !== id);
      let activeId = s.activeId;
      if (activeId === id) {
        const order = lruRef.current;
        activeId = buffers
          .map((b) => b.id)
          .sort((a, b) => order.indexOf(a) - order.indexOf(b))
          .pop() ?? null;
      }
      return { ...s, buffers, activeId };
    });
  }, []);

  const closeMany = useCallback((ids: string[]) => {
    const kill = new Set(ids);
    const targets = stateRef.current.buffers.filter((b) => kill.has(b.id));
    if (!targets.length) return;
    const dirty = targets.filter((b) => b.dirty);
    if (dirty.length && !window.confirm(
      `Close ${targets.length} buffers? Unsaved changes in ${dirty.map((b) => b.title).join(', ')} will be lost.`,
    )) return;
    setState((s) => {
      const buffers = s.buffers.filter((b) => !kill.has(b.id));
      let activeId = s.activeId;
      if (activeId != null && kill.has(activeId)) {
        const order = lruRef.current;
        activeId = buffers
          .map((b) => b.id)
          .sort((a, b) => order.indexOf(a) - order.indexOf(b))
          .pop() ?? null;
      }
      return { ...s, buffers, activeId };
    });
  }, []);

  const setDirty = useCallback((id: string, dirty: boolean) => {
    setState((s) => {
      const b = s.buffers.find((x) => x.id === id);
      if (!b || b.dirty === dirty) return s;
      return { ...s, buffers: s.buffers.map((x) => (x.id === id ? { ...x, dirty } : x)) };
    });
  }, []);

  const setTitle = useCallback((id: string, title: string) => {
    setState((s) => {
      const b = s.buffers.find((x) => x.id === id);
      if (!b || b.title === title) return s;
      return { ...s, buffers: s.buffers.map((x) => (x.id === id ? { ...x, title } : x)) };
    });
  }, []);

  const setRail = useCallback((rail: RailSection) => {
    setState((s) => (s.rail === rail ? s : { ...s, rail }));
  }, []);
  const setSidebarCollapsed = useCallback((sidebarCollapsed: boolean) => {
    setState((s) => ({ ...s, sidebarCollapsed }));
  }, []);
  const setChatDock = useCallback((chatDock: ChatDockState) => {
    setState((s) => (s.chatDock === chatDock ? s : { ...s, chatDock }));
  }, []);
  const setChatWidth = useCallback((px: number) => {
    setState((s) => {
      const chatWidth = clampChat(px, s.sidebarCollapsed ? 0 : s.sidebarWidth);
      return s.chatWidth === chatWidth ? s : { ...s, chatWidth };
    });
  }, []);
  const setSidebarWidth = useCallback((px: number) => {
    setState((s) => {
      const sidebarWidth = clampSidebar(px, s.chatDock === 'docked' ? s.chatWidth : 0);
      return s.sidebarWidth === sidebarWidth ? s : { ...s, sidebarWidth };
    });
  }, []);
  const setGitRepo = useCallback((gitRepo: RepoName) => {
    setState((s) => (s.gitRepo === gitRepo ? s : { ...s, gitRepo }));
  }, []);

  // Shrinking the window can leave a persisted panel wider than there's room
  // for; re-clamp both against the new viewport so the editor is never crushed.
  useEffect(() => {
    const onResize = () => {
      setSidebarWidth(stateRef.current.sidebarWidth);
      setChatWidth(stateRef.current.chatWidth);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [setSidebarWidth, setChatWidth]);

  const api = useMemo<WorkspaceApi>(() => ({
    ...state,
    drawerOpen,
    open,
    close,
    closeMany,
    activate,
    setDirty,
    setTitle,
    setRail,
    setSidebarCollapsed,
    setDrawerOpen,
    setChatDock,
    setChatWidth,
    setSidebarWidth,
    setGitRepo,
  }), [state, drawerOpen, open, close, closeMany, activate, setDirty, setTitle, setRail,
    setSidebarCollapsed, setChatDock, setChatWidth, setSidebarWidth, setGitRepo]);

  return <WorkspaceContext.Provider value={api}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceApi {
  const api = useContext(WorkspaceContext);
  if (!api) throw new Error('useWorkspace outside WorkspaceProvider');
  return api;
}
