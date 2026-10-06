import { createContext, useContext, useState, type ReactNode } from 'react';
import type { TokenRef } from '../shared/types';

// ---- App-wide actions (copy + highlight) ---------------------------------

export interface Actions {
  copy(text: string, label?: string): void;
  /** `id` identifies the toggle; `keys` (default `[id]`) are the registry keys to outline. */
  toggleHighlight(id: string, label: string, opts?: { color?: string; keys?: string[] }): void;
  activeHighlight: string | null;
}

export const ActionsContext = createContext<Actions>({
  copy: () => {},
  toggleHighlight: () => {},
  activeHighlight: null,
});
export const useActions = () => useContext(ActionsContext);

// ---- Icons -----------------------------------------------------------------

const icon = (d: ReactNode, size = 16) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);

export const Icons = {
  target: (s?: number) => icon(<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /><path d="M12 1v3M12 20v3M1 12h3M20 12h3" /></>, s),
  refresh: (s?: number) => icon(<><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></>, s),
  download: (s?: number) => icon(<><path d="M12 3v12M7 10l5 5 5-5" /><path d="M5 21h14" /></>, s),
  search: (s?: number) => icon(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>, s),
  copy: (s?: number) => icon(<><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>, s),
  braces: (s?: number) => icon(<><path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1" /><path d="M16 21h1a2 2 0 0 0 2-2v-5a2 2 0 0 1 2-2 2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1" /></>, s),
  warn: (s?: number) => icon(<><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></>, s),
  arrow: (s?: number) => icon(<path d="M5 12h14M13 6l6 6-6 6" />, s),
  chevron: (s?: number) => icon(<path d="m9 18 6-6-6-6" />, s),
  panelClose: (s?: number) => icon(<><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M15 3v18" /><path d="m8 9 3 3-3 3" /></>, s),
  close: (s?: number) => icon(<path d="M18 6 6 18M6 6l12 12" />, s),
  sun: (s?: number) => icon(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>, s),
  moon: (s?: number) => icon(<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />, s),
  monitor: (s?: number) => icon(<><rect x="2" y="4" width="20" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></>, s),
};

// ---- Primitives ------------------------------------------------------------

/** Solid badge = value comes from a real CSS custom property declared by the site. */
export function TokenBadge({ token, prefix }: { token: TokenRef; prefix?: string }) {
  const { copy } = useActions();
  return (
    <button
      className="badge badge-token"
      title={`CSS variable declared on ${token.scope} — click to copy`}
      onClick={(e) => {
        e.stopPropagation();
        copy(`var(${token.name})`, token.name);
      }}
    >
      {Icons.braces(11)}
      {prefix && <span className="badge-prefix">{prefix}</span>}
      <span className="mono">{token.name}</span>
    </button>
  );
}

/** Outline badge = value was detected on rendered elements but no variable resolves to it. */
export function RawBadge() {
  return (
    <span className="badge badge-raw" title="Detected in computed styles. No CSS variable on this page resolves to this exact value.">
      Raw value
    </span>
  );
}

export function TokenList({ tokens, max = 2 }: { tokens: TokenRef[]; max?: number }) {
  const [open, setOpen] = useState(false);
  if (!tokens.length) return <RawBadge />;
  const shown = open ? tokens : tokens.slice(0, max);
  return (
    <span className="badge-row">
      {shown.map((t) => (
        <TokenBadge key={t.name} token={t} />
      ))}
      {tokens.length > max && !open && (
        <button className="badge badge-more" onClick={() => setOpen(true)}>
          +{tokens.length - max}
        </button>
      )}
    </span>
  );
}

export function Copyable({ text, children, className = '' }: { text: string; children?: ReactNode; className?: string }) {
  const { copy } = useActions();
  return (
    <button className={`copyable ${className}`} title="Click to copy" onClick={() => copy(text)}>
      {children ?? text}
    </button>
  );
}

export function HighlightButton({ id, label, color, keys }: { id: string; label: string; color?: string; keys?: string[] }) {
  const { toggleHighlight, activeHighlight } = useActions();
  const active = activeHighlight === id;
  return (
    <button
      className={`icon-btn highlight-btn ${active ? 'is-active' : ''}`}
      title={active ? 'Clear highlight' : 'Highlight on page'}
      aria-pressed={active}
      onClick={(e) => {
        e.stopPropagation();
        toggleHighlight(id, label, { color, keys });
      }}
    >
      {Icons.target(15)}
      <span>{active ? 'Shown' : 'Find'}</span>
    </button>
  );
}

export function Usage({ count }: { count: number }) {
  return (
    <div className="usage" title={`Used on ${count} element${count === 1 ? '' : 's'}`}>
      <span className="usage-count">{count.toLocaleString()}×</span>
    </div>
  );
}

export function Search({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="search">
      {Icons.search(14)}
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} spellCheck={false} />
      {value && (
        <button className="search-clear" onClick={() => onChange('')} aria-label="Clear search">
          ✕
        </button>
      )}
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  full,
}: {
  value: T;
  options: { value: T; label: string; count?: number }[];
  onChange: (v: T) => void;
  /** Stretch across the row like the main tab bar. */
  full?: boolean;
}) {
  return (
    <div className={`segmented${full ? ' full' : ''}`} role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} className={value === o.value ? 'is-active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
          {o.count !== undefined && <span className="seg-count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

export function ShowMore({ shown, total, onMore }: { shown: number; total: number; onMore: () => void }) {
  if (shown >= total) return null;
  return (
    <button className="show-more" onClick={onMore}>
      Show {Math.min(200, total - shown)} more <span className="muted">({total - shown} hidden)</span>
    </button>
  );
}

export const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
