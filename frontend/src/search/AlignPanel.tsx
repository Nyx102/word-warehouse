import { useState } from 'react';
import { api } from '../api';
import { hashHue } from '../util';
import type { AlignRow } from '../types';

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

/** Chapter alignment matrix: volumes down the page, one column per
 * source/lang; rows sharing subtitle_key get the same pastel tint. */
export function AlignPanel() {
  const [series, setSeries] = useState('any');
  const [volume, setVolume] = useState('');
  const [rows, setRows] = useState<AlignRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = async () => {
    const params = new URLSearchParams();
    if (series !== 'any') params.set('series', series);
    if (volume.trim()) params.set('volume', volume.trim());
    setLoading(true);
    setFailed(false);
    try {
      const d = await api<{ rows: AlignRow[] }>('/api/align?' + params.toString());
      setRows(d.rows || []);
    } catch {
      setFailed(true);
      setRows(null);
    } finally {
      setLoading(false);
    }
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
    <details className="align-panel">
      <summary>Alignment</summary>
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
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void load(); }}
        />
        <button className="btn" onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading…' : 'Load alignment'}
        </button>
      </div>
      <div className="align-results">
        {failed && <div className="empty">Failed to load alignment.</div>}
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
                      const title = [ch.title, ch.subtitle].filter(Boolean).join(' — ')
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
    </details>
  );
}
