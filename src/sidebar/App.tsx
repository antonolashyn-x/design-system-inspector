import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { AnalysisResult } from '../shared/types';
import type { Bridge } from './bridge';
import { ActionsContext, Icons, type Actions } from './ui';
import { Overview } from './views/Overview';
import { Colors } from './views/Colors';
import { Typography } from './views/Typography';
import { Tokens } from './views/Tokens';
import { Shadows } from './views/Shadows';
import { exportJson } from './export';
import { useTheme, type Theme } from './theme';

export type TabId = 'overview' | 'colors' | 'typography' | 'tokens' | 'shadows';

type Status = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; data: AnalysisResult };

export function App({ bridge }: { bridge: Bridge }) {
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [tab, setTab] = useState<TabId>('overview');
  const [activeHighlight, setActiveHighlight] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [theme, setTheme] = useTheme();
  const toastTimer = useRef<number>(undefined);
  const scrollRef = useRef<HTMLElement>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1600);
  }, []);

  const analyze = useCallback(async () => {
    setStatus({ kind: 'loading' });
    setActiveHighlight(null);
    try {
      const data = await bridge.analyze();
      setStatus({ kind: 'ready', data });
    } catch (e) {
      setStatus({ kind: 'error', message: (e as Error).message || 'Something went wrong while analysing this page.' });
    }
  }, [bridge]);

  useEffect(() => {
    analyze();
  }, [analyze]);

  // The sidebar stays open across tabs: re-scan whenever the active tab changes or finishes loading.
  useEffect(() => {
    let timer: number | undefined;
    const off = bridge.onPageChange?.(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(analyze, 350);
    });
    return () => {
      window.clearTimeout(timer);
      off?.();
    };
  }, [bridge, analyze]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [tab]);

  // Esc inside the panel clears the on-page highlight (the page's own Esc handler can't see keys typed here).
  useEffect(() => {
    if (!activeHighlight) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      bridge.clear();
      setActiveHighlight(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeHighlight, bridge]);

  const actions = useMemo<Actions>(
    () => ({
      activeHighlight,
      copy(text, label) {
        navigator.clipboard.writeText(text).then(
          () => showToast(`Copied ${label ?? text}`),
          () => showToast('Clipboard unavailable'),
        );
      },
      async toggleHighlight(id, label, opts) {
        try {
          if (activeHighlight === id) {
            await bridge.clear();
            setActiveHighlight(null);
            return;
          }
          const { count } = await bridge.highlight(opts?.keys ?? [id], label, opts?.color);
          setActiveHighlight(count ? id : null);
          showToast(count ? `Highlighted ${count} element${count === 1 ? '' : 's'} on the page` : 'Those elements are no longer on the page — try re-scanning');
        } catch {
          showToast('The page changed — re-scan to highlight');
        }
      },
    }),
    [activeHighlight, bridge, showToast],
  );

  const data = status.kind === 'ready' ? status.data : null;
  const host = data ? safeHost(data.url) : '';

  const tabs: { id: TabId; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'colors', label: 'Colors' },
    { id: 'typography', label: 'Typography' },
    { id: 'tokens', label: 'Tokens' },
    { id: 'shadows', label: 'Shadows' },
  ];

  return (
    <ActionsContext.Provider value={actions}>
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <span className="logo" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </span>
            <h1 className="brand-name">Design System Inspector</h1>
          </div>
          <div className="top-actions">
            <button className="icon-ghost" onClick={analyze} disabled={status.kind === 'loading'} title="Rescan page" aria-label="Rescan page">
              <span className={status.kind === 'loading' ? 'spin' : ''}>{Icons.refresh(16)}</span>
            </button>
            {data && (
              <button className="icon-ghost" onClick={() => exportJson(data)} title="Export JSON (W3C design tokens, for Figma token plugins)" aria-label="Export JSON">
                {Icons.download(16)}
              </button>
            )}
            {bridge.collapse && (
              <button className="icon-ghost" onClick={() => bridge.collapse?.()} title="Collapse (highlights stay on the page)" aria-label="Collapse panel">
                {Icons.panelClose(16)}
              </button>
            )}
            {bridge.close && (
              <button className="icon-ghost" onClick={() => bridge.close?.()} title="Close panel" aria-label="Close panel">
                {Icons.close(16)}
              </button>
            )}
          </div>
        </header>

        <div className="tabs-bar">
          <div className="tabs-list" role="tablist">
            {tabs.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'is-active' : ''} onClick={() => setTab(t.id)} disabled={!data}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <main className="content" ref={scrollRef}>
          {status.kind === 'loading' && <Skeleton />}
          {status.kind === 'error' && (
            <div className="error-state">
              <div className="error-icon">{Icons.warn(22)}</div>
              <h2>Can’t inspect this page</h2>
              <p>{status.message}</p>
              <button className="btn" onClick={analyze}>
                {Icons.refresh(15)} Try again
              </button>
            </div>
          )}
          {data && tab === 'overview' && <Overview data={data} go={setTab} />}
          {data && tab === 'colors' && <Colors colors={data.colors} />}
          {data && tab === 'typography' && <Typography styles={data.typography} tokens={data.tokens} />}
          {data && tab === 'tokens' && <Tokens tokens={data.tokens} themes={data.themes ?? []} />}
          {data && tab === 'shadows' && <Shadows shadows={data.shadows} />}
        </main>

        <footer className="footbar">
          <span className="foot-site" title={data?.url}>
            {data ? (
              <>
                {host} · {data.elementsScanned.toLocaleString()} elements · {data.durationMs} ms
              </>
            ) : status.kind === 'loading' ? (
              'Analysing page…'
            ) : (
              'Not available'
            )}
          </span>
          <ThemeSwitch theme={theme} onChange={setTheme} />
        </footer>

        <div className={`toast ${toast ? 'is-visible' : ''}`} role="status" aria-live="polite">
          {toast}
        </div>
      </div>
    </ActionsContext.Provider>
  );
}

const THEMES: { value: Theme; label: string; icon: (s?: number) => ReactElement }[] = [
  { value: 'system', label: 'System theme', icon: Icons.monitor },
  { value: 'light', label: 'Light theme', icon: Icons.sun },
  { value: 'dark', label: 'Dark theme', icon: Icons.moon },
];

function ThemeSwitch({ theme, onChange }: { theme: Theme; onChange: (t: Theme) => void }) {
  return (
    <div className="theme-switch" role="radiogroup" aria-label="Theme">
      {THEMES.map((t) => (
        <button key={t.value} role="radio" aria-checked={theme === t.value} title={t.label} aria-label={t.label} className={theme === t.value ? 'is-active' : ''} onClick={() => onChange(t.value)}>
          {t.icon(14)}
        </button>
      ))}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="view">
      <div className="stat-grid">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card skeleton" style={{ height: 92 }} />
        ))}
      </div>
      <div className="card skeleton" style={{ height: 150 }} />
      <div className="two-col">
        <div className="card skeleton" style={{ height: 160 }} />
        <div className="card skeleton" style={{ height: 160 }} />
      </div>
    </div>
  );
}

function safeHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
