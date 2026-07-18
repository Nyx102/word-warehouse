import { useEffect, useState } from 'react';

export type ToastKind = 'info' | 'ok' | 'error';

interface ToastMsg {
  id: number;
  text: string;
  kind: ToastKind;
  fading: boolean;
}

let nextId = 1;
let pushFn: ((text: string, kind: ToastKind, ms: number) => void) | null = null;

/** Fire-and-forget toast; callable from anywhere (api errors, save results). */
export function toast(text: string, kind: ToastKind = 'info', ms = 4000): void {
  if (pushFn) pushFn(String(text), kind, ms);
}

export function Toasts() {
  const [items, setItems] = useState<ToastMsg[]>([]);

  useEffect(() => {
    pushFn = (text, kind, ms) => {
      const id = nextId++;
      setItems((l) => [...l, { id, text, kind, fading: false }]);
      window.setTimeout(() => {
        setItems((l) => l.map((t) => (t.id === id ? { ...t, fading: true } : t)));
      }, ms);
      window.setTimeout(() => {
        setItems((l) => l.filter((t) => t.id !== id));
      }, ms + 350);
    };
    return () => { pushFn = null; };
  }, []);

  return (
    <div className="toasts" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={'toast ' + t.kind + (t.fading ? ' fade' : '')}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
