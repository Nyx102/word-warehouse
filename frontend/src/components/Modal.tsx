import { ReactNode, useEffect } from 'react';

export function Modal({ title, onClose, children, footer, wide, className }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  className?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={'modal' + (wide ? ' wide' : '') + (className ? ' ' + className : '')} role="dialog" aria-label={title}>
        <div className="modal-head">
          <span className="modal-title mono" title={title}>{title}</span>
          <button className="icon-btn" onClick={onClose} title="Close (Esc)">×</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer != null && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
