import { useState } from 'react';
import { api } from '@/lib/api';
import { Modal } from '@/components/Modal';
import { useAsync } from '@/hooks/useAsync';
import type { FilePage } from '@/lib/types';

const PAGE = 200;

/** Windowed file viewer: pages through /api/file?path&start&count. */
export function ChunkModal({ path, initialStart, onClose, onEdit }: {
  path: string;
  initialStart: number;
  onClose: () => void;
  onEdit?: (path: string, line: number) => void;
}) {
  const [start, setStart] = useState(Math.max(1, initialStart || 1));

  const page = useAsync(
    () => api<FilePage>(`/api/file?path=${encodeURIComponent(path)}&start=${start}&count=${PAGE}`),
    [path, start],
  );

  const d = page.data;
  const lines = d?.lines ?? [];
  const effStart = d?.start ?? start;
  const end = effStart + lines.length - 1;
  const total = d?.total_lines ?? 0;
  const width = String(effStart + lines.length).length;

  return (
    <Modal
      title={d?.path ?? path}
      onClose={onClose}
      wide
      footer={(
        <>
          <button
            className="btn"
            disabled={effStart <= 1 || page.loading}
            onClick={() => setStart(Math.max(1, effStart - PAGE))}
          >← Prev</button>
          <span className="dim">
            {d ? `lines ${effStart}–${end} of ${total}` : page.error ? 'failed to load' : 'loading…'}
          </span>
          {onEdit && (
            <button className="btn" onClick={() => onEdit(path, effStart)}>Open in editor</button>
          )}
          <button
            className="btn"
            disabled={!d || end >= total || page.loading}
            onClick={() => setStart(effStart + PAGE)}
          >Next →</button>
        </>
      )}
    >
      <pre className="file-view mono">
        {lines.map((ln, i) => String(effStart + i).padStart(width) + '  ' + ln).join('\n')}
      </pre>
    </Modal>
  );
}
