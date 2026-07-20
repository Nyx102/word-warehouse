/* Markdown rendering for chat, help, coverage and other rendered prose.
 * Backed by react-markdown + remark-gfm with raw HTML disabled, so untrusted
 * input renders safely without manual escaping. */

import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/* HTML-escape for callers that assemble their own highlighted markup */
export function esc(s: unknown): string {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>
  )[c] as string);
}

const components: Components = {
  a({ node, href, children, ...rest }) {
    // http(s) links open in a new tab
    const external = typeof href === 'string' && /^https?:\/\//.test(href);
    const target = external ? { target: '_blank', rel: 'noopener noreferrer' } : {};
    return <a href={href} {...target} {...rest}>{children}</a>;
  },
};

export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={'md' + (className ? ' ' + className : '')}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
