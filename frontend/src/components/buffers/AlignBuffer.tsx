import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useWorkspace } from '@/context/workspace';
import { useKeyboardScroll } from '@/hooks/useKeyboardScroll';
import { hashHue } from '@/lib/util';
import type { AlignRow } from '@/lib/types';

const SRC_ORDER = ['official', 'fan', 'jp', 'zh', 'raw', 'notes', 'docs'];
const srcIdx = (s: string | null | undefined) => {
  const i = SRC_ORDER.indexOf(s || '');
  return i === -1 ? 99 : i;
};

interface AlignCol {
  source: string;
  lang: string;
  rows: AlignRow[];
}

interface VolBlock {
  vol: string;
  cols: AlignCol[];
}

/** Chapter alignment matrix buffer: volumes down the page, one column per
 * source/lang; rows sharing subtitle_key get the same pastel tint. */
export function AlignBuffer() {
  const ws = useWorkspace();
  const [series, setSeries] = useState('any');
  const [volume, setVolume] = useState('');
  // The series/volume committed by the last Load press; null = never loaded.
  const [submitted, setSubmitted] = useState<{ series: string; volume: string } | null>(null);
  const scroll = useKeyboardScroll(ws.activeId === 'align');

  const align = useQuery({
    queryKey: ['align', submitted?.series, submitted?.volume],
    queryFn: () => {
      const params = new URLSearchParams();
      if (submitted!.series !== 'any') params.set('series', submitted!.series);
      if (submitted!.volume) params.set('volume', submitted!.volume);
      return api<{ rows: AlignRow[] }>('/api/align?' + params.toString());
    },
    enabled: submitted != null,
    placeholderData: keepPreviousData, // keep the current matrix while a new one loads
  });
  const failed = align.isError;
  // Clear the matrix on failure to match the old load()'s setRows(null); a
  // background reload keeps the previous matrix via keepPreviousData.
  const rows = failed ? null : (align.data?.rows ?? null);
  const loading = align.isFetching;

  const load = () => {
    setSubmitted({ series, volume: volume.trim() });
  };

  // volume -> (source/lang key -> column)
  const volBlocks: VolBlock[] = [];
  if (rows) {
    const volumes = new Map<string, Map<string, AlignCol>>();
    for (const r of rows) {
      const vk = String(r.volume == null ? '?' : r.volume);
      if (!volumes.has(vk)) volumes.set(vk, new Map());
      const cols = volumes.get(vk) as Map<string, AlignCol>;
      const ck = (r.source || '?') + '/' + (r.lang || '?');
      if (!cols.has(ck)) cols.set(ck, { source: r.source, lang: r.lang, rows: [] });
      (cols.get(ck) as AlignCol).rows.push(r);
    }
    const volKeys = [...volumes.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    for (const vk of volKeys) {
      const cols = [...(volumes.get(vk) as Map<string, AlignCol>).values()]
        .sort((a, b) => srcIdx(a.source) - srcIdx(b.source));
      volBlocks.push({ vol: vk, cols });
    }
  }

  return (
    <div className="align-buffer" {...scroll}>
      <div className="align-controls">
        <select value={series} onChange={(e) => setSeries(e.target.value)} title="Series">
          <option value="any">series: any</option>
          <option value="1">1</option>
          <option value="2">2</option>
        </select>
        <input
          value={volume}
          placeholder="volume (blank = all)"
          size={16}
          onChange={(e) => setVolume(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) load(); }}
        />
        <button className="btn" onClick={() => load()} disabled={loading}>
          {loading ? 'Loading…' : 'Load alignment'}
        </button>
      </div>
      <div className="align-results">
        {failed && <div className="empty">Failed to load alignment.</div>}
        {!rows && !failed && !loading && (
          <div className="empty">Pick a series or volume and load the alignment.</div>
        )}
        {rows && rows.length === 0 && <div className="empty">No alignment rows.</div>}
        {volBlocks.map((vb) => (
          <div key={vb.vol}>
            <h3 className="al-vol">Volume {vb.vol}</h3>
            <div className="al-row">
              {vb.cols.map((col) => (
                <div className="al-col" key={(col.source || '?') + '/' + (col.lang || '?')}>
                  <div className="al-col-head">
                    <span className={'badge badge-' + (col.source || 'unknown')}>{col.source || '?'}</span>
                    {col.lang && <span className="lang-tag">{col.lang}</span>}
                  </div>
                  {col.rows
                    .slice()
                    .sort((a, b) => (a.ord || 0) - (b.ord || 0))
                    .map((ch) => {
                      const style = ch.subtitle_key
                        ? { background: `hsla(${hashHue(String(ch.subtitle_key))},60%,60%,0.16)` }
                        : undefined;
                      const title = [ch.title, ch.subtitle].filter(Boolean).join('—')
                        + (ch.part_title ? ' · ' + ch.part_title : '');
                      return (
                        <div
                          className="al-ch"
                          style={style}
                          title={ch.path}
                          key={ch.path + ':' + ch.start_line}
                        >
                          <span className="al-label">{ch.chapter_label || ''}</span>
                          <span className="al-title" title={title}>{title}</span>
                          <span className="al-lines mono">{ch.start_line}-{ch.end_line}</span>
                        </div>
                      );
                    })}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
