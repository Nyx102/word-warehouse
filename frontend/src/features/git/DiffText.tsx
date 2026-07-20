/* Read-only colorized unified diff on --vc-* tokens, promoted from
 * MergeEditor's fallback renderer. Pure presentation, no fetch; monospace,
 * horizontal scroll instead of wrapping (git.css) */

const META_RE = /^(diff --git|index |new file|deleted file|old mode|new mode|similarity|dissimilarity|rename|copy (from|to)|Binary files |GIT binary)/;

function lineClass(line: string): string {
  if (META_RE.test(line)) return 'meta';
  if (line.startsWith('+++') || line.startsWith('---')) return 'file';
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('\\')) return 'meta';
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'del';
  return 'ctx';
}

export function DiffText({ text }: { text: string }) {
  if (!text.trim()) return <div className="empty">No diff.</div>;
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return (
    <div className="difftext mono">
      {lines.map((raw, i) => {
        const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
        return (
          <div key={i} className={'dl ' + lineClass(line)}>{line || ' '}</div>
        );
      })}
    </div>
  );
}
