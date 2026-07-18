import { useState } from 'react';
import { api } from '../api';
import { toast } from '../components/Toasts';
import { useAsync } from '../hooks/useAsync';
import type { GitLogEntry, RepoName } from '../types';

export function CommitBox({ repo, checkedPaths, refreshKey, onCommitted }: {
  repo: RepoName;
  checkedPaths: string[];
  refreshKey: number;
  onCommitted: () => void;
}) {
  const [msg, setMsg] = useState('');
  const [committing, setCommitting] = useState(false);

  const log = useAsync(
    () => api<{ log: GitLogEntry[] }>(`/api/git/log?repo=${repo}&n=20`),
    [repo, refreshKey],
  );

  const commit = async () => {
    const message = msg.trim();
    if (!message) { toast('Commit message required', 'error'); return; }
    if (!checkedPaths.length) { toast('No files checked', 'error'); return; }
    setCommitting(true);
    try {
      const d = await api<{ ok?: boolean; hash?: string; error?: string }>('/api/git/commit', {
        method: 'POST',
        body: { repo, message, paths: checkedPaths },
      });
      if (d.error) { toast(d.error, 'error'); return; }
      toast('Committed ' + String(d.hash || '').slice(0, 8), 'ok');
      setMsg('');
      onCommitted();
    } catch {
      /* toast already shown */
    } finally {
      setCommitting(false);
    }
  };

  return (
    <div className="commit-box">
      <div className="commit-row">
        <input
          value={msg}
          placeholder={`Commit message…  (${checkedPaths.length} file${checkedPaths.length === 1 ? '' : 's'} checked)`}
          autoComplete="off"
          onChange={(e) => setMsg(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void commit(); }}
        />
        <button className="btn primary" onClick={() => void commit()} disabled={committing}>
          Commit
        </button>
      </div>
      <h3 className="side-h">Recent commits</h3>
      <div className="git-log">
        {(log.data?.log ?? []).map((c) => (
          <div className="log-row" key={c.hash}>
            <span className="mono log-hash">{String(c.hash || '').slice(0, 8)}</span>
            <span className="log-subject" title={c.subject}>{c.subject}</span>
            <span className="log-date dim">{c.date}</span>
          </div>
        ))}
        {log.data && !(log.data.log || []).length && <div className="empty">No commits.</div>}
      </div>
    </div>
  );
}
