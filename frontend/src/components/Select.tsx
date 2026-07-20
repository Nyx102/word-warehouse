import {
  useEffect, useId, useLayoutEffect, useRef, useState,
  type KeyboardEvent, type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { IconCheck, IconChevronDown } from '@/components/layout/icons';

export interface SelectOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
  /** Plain text used for type-ahead; defaults to the label when it's a string. */
  text?: string;
}

interface Pos { left: number; top: number; maxHeight?: number; minWidth: number; }

/** Themed dropdown replacing the native <select>. A button trigger plus a
 * portalled listbox popup, so the option list follows the app's doom-one theme
 * instead of the browser's OS-native menu. The popup is fixed-positioned off
 * the trigger's rect (so a sidebar or modeline's overflow never clips it) and
 * flips above the trigger when there isn't room below. Keyboard, type-ahead,
 * and outside-click behave like a real select. */
export function Select({
  value, options, onChange, disabled, className, title, ariaLabel,
  placeholder, align = 'left',
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  title?: string;
  ariaLabel?: string;
  /** Trigger text when `value` matches no option (e.g. a detached branch). */
  placeholder?: ReactNode;
  /** Which trigger edge the popup lines up with. */
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0); // keyboard-highlighted index while open
  const [pos, setPos] = useState<Pos | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const typeahead = useRef({ str: '', at: 0 });
  const listId = useId();

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;
  const optText = (o: SelectOption) => o.text ?? (typeof o.label === 'string' ? o.label : o.value);

  const openMenu = () => {
    if (disabled) return;
    setActive(selectedIndex >= 0 ? selectedIndex : firstEnabled());
    setPos(null);
    setOpen(true);
  };
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };
  const choose = (i: number) => {
    const o = options[i];
    if (!o || o.disabled) return;
    onChange(o.value);
    close();
  };

  const firstEnabled = () => {
    const i = options.findIndex((o) => !o.disabled);
    return i < 0 ? 0 : i;
  };
  const lastEnabled = () => {
    for (let i = options.length - 1; i >= 0; i--) if (!options[i].disabled) return i;
    return 0;
  };
  const move = (dir: 1 | -1) => setActive((cur) => {
    let i = cur;
    for (let n = 0; n < options.length; n++) {
      i = (i + dir + options.length) % options.length;
      if (!options[i].disabled) return i;
    }
    return cur;
  });

  // Place the popup once it's mounted: measure the trigger + menu, flip above
  // when there's more room there, and clamp inside the viewport.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const t = triggerRef.current, m = menuRef.current;
      if (!t || !m) return;
      const r = t.getBoundingClientRect();
      const gap = 4, margin = 8;
      const vw = window.innerWidth, vh = window.innerHeight;
      const spaceBelow = vh - r.bottom - margin;
      const spaceAbove = r.top - margin;
      // Full border-box height as currently rendered (no max-height applied
      // yet), rounded up so a fractional pixel doesn't trip the scrollbar.
      const natural = Math.ceil(m.getBoundingClientRect().height);
      const up = spaceBelow < Math.min(natural, 220) && spaceAbove > spaceBelow;
      const room = Math.min(up ? spaceAbove : spaceBelow, 360);
      // Only cap (and thus scroll) when the list genuinely overflows the space.
      const maxHeight = natural > room ? room : undefined;
      const shownH = maxHeight ?? natural;
      const width = Math.min(m.offsetWidth, vw - margin * 2);
      let left = align === 'right' ? r.right - width : r.left;
      left = Math.min(Math.max(margin, left), vw - width - margin);
      const top = up ? Math.max(margin, r.top - shownH - gap) : r.bottom + gap;
      setPos({ left, top, maxHeight, minWidth: r.width });
    };
    place();
    // Scrolling or resizing the page moves the trigger out from under the
    // popup; close rather than chase it, but ignore scrolls inside the list.
    const onScroll = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      setOpen(false);
    };
    const onResize = () => setOpen(false);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, align]);

  // Focus the listbox for keyboard nav once it's positioned and visible — a
  // visibility:hidden element (its state before placement) can't take focus.
  useEffect(() => {
    if (open && pos) menuRef.current?.focus();
  }, [open, pos]);

  // Keep the highlighted option scrolled into view.
  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('.ww-select-opt.active')
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const onTriggerKey = (e: KeyboardEvent) => {
    if (open) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openMenu();
    }
  };

  const onMenuKey = (e: KeyboardEvent) => {
    // The open popup owns the keyboard: don't let Escape reach a surrounding
    // Modal, or a letter reach a global shortcut, while navigating options.
    e.stopPropagation();
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); move(1); break;
      case 'ArrowUp': e.preventDefault(); move(-1); break;
      case 'Home': e.preventDefault(); setActive(firstEnabled()); break;
      case 'End': e.preventDefault(); setActive(lastEnabled()); break;
      case 'Enter':
      case ' ': e.preventDefault(); choose(active); break;
      case 'Escape': e.preventDefault(); close(); break;
      case 'Tab': close(); break;
      default:
        if (e.key.length === 1) {
          const now = performance.now();
          const ta = typeahead.current;
          ta.str = now - ta.at > 600 ? e.key : ta.str + e.key;
          ta.at = now;
          const q = ta.str.toLowerCase();
          const hit = options.findIndex((o) => !o.disabled && optText(o).toLowerCase().startsWith(q));
          if (hit >= 0) setActive(hit);
        }
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={'ww-select' + (className ? ' ' + className : '')}
        disabled={disabled}
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={onTriggerKey}
      >
        <span className="ww-select-label">
          {selected ? selected.label : (placeholder ?? '')}
        </span>
        <span className="ww-select-caret"><IconChevronDown /></span>
      </button>
      {open && createPortal(
        <>
          <div className="ww-select-backdrop" onClick={() => close(false)} />
          <div
            ref={menuRef}
            id={listId}
            role="listbox"
            tabIndex={-1}
            className="ww-select-menu"
            style={{
              left: pos?.left ?? 0,
              top: pos?.top ?? 0,
              minWidth: pos?.minWidth,
              maxHeight: pos?.maxHeight,
              visibility: pos ? 'visible' : 'hidden',
            }}
            onKeyDown={onMenuKey}
          >
            {options.map((o, i) => (
              <div
                key={o.value}
                role="option"
                aria-selected={o.value === value}
                aria-disabled={o.disabled || undefined}
                className={'ww-select-opt'
                  + (i === active ? ' active' : '')
                  + (o.value === value ? ' selected' : '')
                  + (o.disabled ? ' disabled' : '')}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => !o.disabled && setActive(i)}
                onClick={() => choose(i)}
              >
                <span className="ww-select-opt-label">{o.label}</span>
                {o.value === value && <span className="ww-select-check"><IconCheck /></span>}
              </div>
            ))}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
