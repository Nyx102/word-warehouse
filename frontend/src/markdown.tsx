/* Minimal hand-written markdown renderer, ported from the vanilla UI.
 * Supports bold/italic/inline code, fenced code blocks, headings, lists,
 * blockquotes, http(s) links and pipe tables. Everything is HTML-escaped
 * before inline markup is applied, so dangerouslySetInnerHTML is safe here. */

export function esc(s: unknown): string {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>
  )[c] as string);
}

/* Inline spans on an already HTML-escaped string. Code spans are protected
 * first so bold/italic markers inside them survive. */
function mdInline(s: string): string {
  return s.split(/(`[^`]+`)/).map((part) => {
    if (part.length > 1 && part.startsWith('`') && part.endsWith('`')) {
      return '<code>' + part.slice(1, -1) + '</code>';
    }
    let t = part;
    t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, txt: string, url: string) =>
      /^https?:\/\//.test(url)
        ? '<a href="' + url + '" target="_blank" rel="noopener">' + txt + '</a>'
        : m);
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/(^|[^*\w])\*([^*]+)\*/g, '$1<em>$2</em>');
    t = t.replace(/(^|[^\w])_([^_]+)_(?!\w)/g, '$1<em>$2</em>');
    return t;
  }).join('');
}

function mdTable(rows: string[]): string {
  let html = '<table>';
  rows.forEach((r, idx) => {
    if (/^[|\s:-]+$/.test(r)) return; // |---|---| separator row
    const tag = idx === 0 ? 'th' : 'td';
    const cells = r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
    html += '<tr>' + cells.map((c) => '<' + tag + '>' + mdInline(esc(c.trim())) + '</' + tag + '>').join('') + '</tr>';
  });
  return html + '</table>';
}

export function renderMarkdown(src: string): string {
  const lines = String(src == null ? '' : src).split('\n');
  const out: string[] = [];
  let i = 0;
  const isBlockStart = (l: string) => /^(#{1,6}\s|```|\s*[-*]\s|>\s?|\s*\|)/.test(l);
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; // closing fence (or EOF)
      out.push('<pre class="md-code"><code>' + esc(buf.join('\n')) + '</code></pre>');
      continue;
    }
    const hm = line.match(/^(#{1,6})\s+(.*)$/);
    if (hm) {
      const lvl = hm[1].length;
      out.push('<h' + lvl + '>' + mdInline(esc(hm[2])) + '</h' + lvl + '>');
      i++;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push('<li>' + mdInline(esc(lines[i].replace(/^\s*[-*]\s+/, ''))) + '</li>');
        i++;
      }
      out.push('<ul>' + items.join('') + '</ul>');
      continue;
    }
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
      out.push('<blockquote>' + mdInline(esc(buf.join(' '))) + '</blockquote>');
      continue;
    }
    if (/^\s*\|/.test(line)) {
      const rows: string[] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(lines[i]); i++; }
      out.push(mdTable(rows));
      continue;
    }
    if (line.trim() === '') { i++; continue; }
    const buf = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== '' && !isBlockStart(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    out.push('<p>' + buf.map((l) => mdInline(esc(l))).join('<br>') + '</p>');
  }
  return out.join('\n');
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div
      className={'md' + (className ? ' ' + className : '')}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
    />
  );
}
