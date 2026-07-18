import { api } from '../api';
import { Modal } from '../components/Modal';
import { useAsync } from '../hooks/useAsync';
import { Markdown } from '../markdown';

export function CoverageModal({ onClose }: { onClose: () => void }) {
  const cov = useAsync(() => api<{ markdown: string }>('/api/coverage'), []);
  return (
    <Modal title="Coverage" onClose={onClose} wide>
      {cov.loading && <div className="empty">Loading…</div>}
      {cov.error && !cov.loading && <div className="empty">Failed to load coverage.</div>}
      {cov.data && <Markdown className="coverage" text={cov.data.markdown || ''} />}
    </Modal>
  );
}
