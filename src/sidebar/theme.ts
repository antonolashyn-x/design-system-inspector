import { useEffect, useState } from 'react';

export type Theme = 'system' | 'light' | 'dark';
const KEY = 'dsi-theme';

function read(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

/** Applies the theme as `data-theme` on <html>; "system" follows prefers-color-scheme. */
export function applyStoredTheme() {
  const t = read();
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(read);
  useEffect(() => {
    try {
      if (theme === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, theme);
    } catch {
      /* storage unavailable — theme still applies for this session */
    }
    applyStoredTheme();
    if (theme !== 'system') document.documentElement.dataset.theme = theme;
  }, [theme]);
  return [theme, setTheme];
}
