import { fmtAge } from '../util';
import { useSettings, type KeymapName } from '../app/settings';
import { useWorkspace } from '../app/workspace';
import type { RepoName, StatusInfo } from '../types';

/** Status overlay: index freshness, dirty counts (tap to open magit), chat
 * activity. On phones it also carries the theme/keymap/help controls that
 * otherwise live in the rail. Bottom sheet on mobile, centered card above. */
export function StatusSheet({ status, busy, onClose }: {
  status: StatusInfo | null;
  busy: boolean;
  onClose: () => void;
}) {
  const ws = useWorkspace();
  const { theme, setTheme, keymap, setKeymap } = useSettings();
  const idx = status?.index;
  const dirtyCorpus = status?.git?.corpus?.dirty ?? 0;
  const dirtyRepo = status?.git?.repo?.dirty ?? 0;

  const jump = (repo: RepoName) => {
    ws.open({ kind: 'magit', repo });
    onClose();
  };

  return (
    <div
      className="sheet-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
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
        <button className="sheet-row linkish sheet-mobile"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          <span>Theme</span>
          <span>{theme === 'dark' ? 'dark, tap for light' : 'light, tap for dark'}</span>
        </button>
        <div className="sheet-row sheet-mobile">
          <span>Keymap</span>
          <select
            value={keymap}
            onChange={(e) => setKeymap(e.target.value as KeymapName)}
            aria-label="Editor keymap"
          >
            <option value="normal">Normal</option>
            <option value="vim">Vim</option>
            <option value="emacs">Emacs</option>
          </select>
        </div>
        <button className="sheet-row linkish sheet-mobile"
          onClick={() => { ws.open({ kind: 'help' }); onClose(); }}>
          <span>Help</span>
          <span>?</span>
        </button>
        <button className="btn sheet-close" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
