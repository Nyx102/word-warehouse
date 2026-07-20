import { useRef, useState, type KeyboardEvent } from 'react';
import { IconSend, IconStop } from '../../components/layout/icons';
import { useAutoGrow } from '../../hooks/useAutoGrow';
import { ModelPicker } from './ModelPicker';
import type { ModelName } from '@/lib/types';

const MAX_ROWS = 10;

/** Message composer, standard LLM-composer shape: the textarea on top with a
 * control bar underneath (model picker on the left, Send on the right). Enter
 * sends, Shift+Enter inserts a newline, Ctrl/Cmd+Enter also sends; never sends
 * mid-IME-composition. The textarea auto-grows to MAX_ROWS then scrolls (its
 * scrollbar hidden); Stop replaces Send while a turn is running. */
export function Composer({ turnActive, model, onModelChange, onSend, onStop }: {
  turnActive: boolean;
  model: ModelName;
  onModelChange: (m: ModelName) => void;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(taRef, text, MAX_ROWS);

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
      <div className="field-box">
        <textarea
          ref={taRef}
          rows={1}
          value={text}
          placeholder="Message…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="field-bar">
          <ModelPicker value={model} disabled={turnActive} onChange={onModelChange} />
          {turnActive ? (
            <button className="field-send stop" onClick={onStop} aria-label="Stop generating" title="Stop">
              <IconStop />
            </button>
          ) : (
            <button
              className="field-send"
              onClick={submit}
              disabled={!text.trim()}
              aria-label="Send message"
              title="Send · Enter"
            >
              <IconSend />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
