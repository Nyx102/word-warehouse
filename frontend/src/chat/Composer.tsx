import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';

const MAX_ROWS = 6;

/** Sticky message composer: one flex row on the --ctl-h grid. Enter sends,
 * Shift+Enter inserts a newline, Ctrl/Cmd+Enter also sends; never sends
 * mid-IME-composition. The textarea auto-grows from one row (exactly --ctl-h
 * tall, so the button sits centered against it) to MAX_ROWS, then scrolls;
 * Stop replaces Send while a turn is running. */
export function Composer({ turnActive, onSend, onStop }: {
  turnActive: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    const cs = window.getComputedStyle(ta);
    const lh = parseFloat(cs.lineHeight) || 20;
    const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const border = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
    const max = Math.round(lh * MAX_ROWS + pad + border);
    // Collapse first so scrollHeight reports the real content height
    ta.style.height = 'auto';
    const want = ta.scrollHeight + border;
    ta.style.height = Math.min(Math.max(want, lh + pad + border), max) + 'px';
    ta.style.overflowY = want > max ? 'auto' : 'hidden';
  }, [text]);

  const submit = () => {
    const t = text.trim();
    if (!t || turnActive) return;
    setText('');
    onSend(t);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return; // CJK IME conversion in progress
    if (e.key !== 'Enter') return;
    if (e.ctrlKey || e.metaKey || !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="composer">
      <textarea
        ref={taRef}
        rows={1}
        value={text}
        placeholder="Message…  (Enter to send, Shift+Enter for newline)"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {turnActive ? (
        <button className="btn danger composer-btn" onClick={onStop}>Stop</button>
      ) : (
        <button className="btn primary composer-btn" onClick={submit} disabled={!text.trim()}>
          Send
        </button>
      )}
    </div>
  );
}
