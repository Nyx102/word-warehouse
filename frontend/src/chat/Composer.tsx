import { KeyboardEvent, useState } from 'react';

/** Sticky message composer. Enter sends, Shift+Enter inserts a newline,
 * Ctrl/Cmd+Enter also sends; never sends mid-IME-composition. */
export function Composer({ turnActive, onSend, onStop }: {
  turnActive: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState('');

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
        rows={2}
        value={text}
        placeholder="Message…  (Enter to send, Shift+Enter for newline)"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="composer-btns">
        {turnActive && <button className="btn danger" onClick={onStop}>Stop</button>}
        <button className="btn primary" onClick={submit} disabled={turnActive || !text.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}
