import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type Theme = 'dark' | 'light';
export type KeymapName = 'normal' | 'vim';

interface Settings {
  theme: Theme;
  keymap: KeymapName;
}

interface SettingsApi extends Settings {
  setTheme: (t: Theme) => void;
  setKeymap: (k: KeymapName) => void;
}

const STORAGE_KEY = 'worldend.settings.v1';

function readStored(): Settings {
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Record<string, unknown>;
  } catch { /* Corrupted -> defaults */ }
  return {
    theme: raw.theme === 'light' ? 'light' : 'dark',
    keymap: raw.keymap === 'vim' ? raw.keymap : 'normal',
  };
}

function writeStored(patch: Partial<Settings>) {
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Record<string, unknown>;
  } catch { /* Corrupted -> replace */ }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...raw, ...patch }));
  } catch { /* Storage unavailable -> settings live for the session only */ }
}

/** Flip the palette and keep the PWA titlebar color in sync. The meta content
 * comes from the computed --bg token so index.html's boot script and tokens.css
 * stay the single sources of the actual color values. */
function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && bg) meta.setAttribute('content', bg);
}

const SettingsContext = createContext<SettingsApi | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(readStored);

  const setTheme = useCallback((theme: Theme) => {
    setSettings((s) => ({ ...s, theme }));
    writeStored({ theme });
    applyTheme(theme);
  }, []);

  const setKeymap = useCallback((keymap: KeymapName) => {
    setSettings((s) => ({ ...s, keymap }));
    writeStored({ keymap });
  }, []);

  const api = useMemo(
    () => ({ ...settings, setTheme, setKeymap }),
    [settings, setTheme, setKeymap],
  );
  return <SettingsContext.Provider value={api}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsApi {
  const api = useContext(SettingsContext);
  if (!api) throw new Error('useSettings outside SettingsProvider');
  return api;
}
