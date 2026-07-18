import { api } from '../api';
import { Modal } from './Modal';
import { useAsync } from '../hooks/useAsync';
import { Markdown } from '../markdown';

export function HelpModal({ onClose }: { onClose: () => void }) {
  const help = useAsync(() => api<{ markdown: string }>('/api/help'), []);
  return (
    <Modal title="Help" onClose={onClose} wide>
      {help.loading && <div className="empty">Loading…</div>}
      {help.error && !help.loading && <div className="empty">Failed to load help.</div>}
      {help.data && <Markdown className="coverage" text={help.data.markdown || ''} />}
    </Modal>
  );
}
