import type { AnalysisResult, TokenGroup } from '../../shared/types';
import { Icons, plural, useActions } from '../ui';
import { GROUP_LABELS } from './Tokens';
import type { TabId } from '../App';

export function Overview({ data, go }: { data: AnalysisResult; go: (t: TabId) => void }) {
  const { copy } = useActions();
  const tokenBackedColors = data.colors.filter((c) => c.tokens.length).length;
  const aliases = data.tokens.filter((t) => t.aliasOf).length;
  const families = data.fonts.length;

  const groups = new Map<TokenGroup, number>();
  for (const t of data.tokens) groups.set(t.group, (groups.get(t.group) ?? 0) + 1);
  const groupRows = [...groups.entries()].sort((a, b) => b[1] - a[1]);
  const maxGroup = Math.max(1, ...groupRows.map(([, n]) => n));
  const maxFont = Math.max(1, ...data.fonts.map((f) => f.count));

  const stats: { tab: TabId; label: string; value: number; sub: string }[] = [
    { tab: 'colors', label: 'Colors', value: data.colors.length, sub: `${tokenBackedColors} match a token` },
    { tab: 'typography', label: 'Text styles', value: data.typography.length, sub: `${families} font ${families === 1 ? 'family' : 'families'}` },
    { tab: 'tokens', label: 'CSS tokens', value: data.tokens.length, sub: aliases ? `${aliases} are aliases` : `${groupRows.length} groups` },
    { tab: 'shadows', label: 'Shadows', value: data.shadows.length, sub: `${data.shadows.filter((s) => s.tokens.length).length} match a token` },
  ];

  return (
    <div className="view overview">
      <div className="stat-grid">
        {stats.map((s) => (
          <button key={s.tab} className="stat card" onClick={() => go(s.tab)}>
            <span className="stat-label">{s.label}</span>
            <span className="stat-value">{s.value.toLocaleString()}</span>
            <span className="stat-sub">{s.sub}</span>
            <span className="stat-go">{Icons.chevron(14)}</span>
          </button>
        ))}
      </div>

      {data.themes?.length > 0 && (
        <button className="card theme-summary" onClick={() => go('tokens')}>
          <span className="theme-dots" aria-hidden="true">
            {data.themes.slice(0, 4).map((t) => (
              <i key={t.id} className={`theme-dot theme-${t.id.includes('dark') ? 'dark' : 'light'}`} />
            ))}
          </span>
          <span className="theme-summary-text">
            <b>{data.themes.length} themes:</b> {data.themes.map((t) => t.label + (t.active ? ' (on page)' : '')).join(', ')}
            <span className="muted"> · {data.tokens.filter((t) => t.themeValues).length} tokens change per theme</span>
          </span>
          <span className="stat-go">{Icons.chevron(14)}</span>
        </button>
      )}

      {data.stylesheets.blocked > 0 && (
        <div className="notice">
          {Icons.warn(16)}
          <div>
            <strong>{plural(data.stylesheets.blocked, 'stylesheet')} couldn’t be read</strong> (cross-origin). Tokens on <code>:root</code> were still
            recovered from computed styles, but variables scoped to other selectors in those files may be missing.
          </div>
        </div>
      )}

      <section className="card">
        <header className="section-head">
          <h3>Palette</h3>
          <button className="link" onClick={() => go('colors')}>
            All {data.colors.length} colors {Icons.arrow(12)}
          </button>
        </header>
        {data.colors.length ? (
          <div className="palette">
            {data.colors.slice(0, 18).map((c) => (
              <button key={c.hex} className="palette-chip" onClick={() => copy(c.hex)} title={`${c.hex} · ${c.count}× — click to copy`}>
                <span className="palette-swatch checker">
                  <span style={{ background: c.rgb }} />
                </span>
                <span className="mono palette-hex">{c.hex}</span>
                <span className="palette-meta">
                  {c.tokens[0] ? <span className="mono token-text">{c.tokens[0].name}</span> : <span className="muted">{c.count}×</span>}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="muted">No colors detected.</p>
        )}
      </section>

      <div className="two-col">
        <section className="card">
          <header className="section-head">
            <h3>Font families</h3>
            <button className="link" onClick={() => go('typography')}>
              Styles {Icons.arrow(12)}
            </button>
          </header>
          {data.fonts.length ? (
            <ul className="bars">
              {data.fonts.slice(0, 6).map((f) => (
                <li key={f.family}>
                  <span className="bar-label" style={{ fontFamily: `"${f.family}", system-ui` }}>
                    {f.family}
                  </span>
                  <span className="bar-track">
                    <span style={{ width: `${(f.count / maxFont) * 100}%` }} />
                  </span>
                  <span className="bar-value">{f.count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No text found.</p>
          )}
        </section>

        <section className="card">
          <header className="section-head">
            <h3>Token groups</h3>
            <button className="link" onClick={() => go('tokens')}>
              Tokens {Icons.arrow(12)}
            </button>
          </header>
          {groupRows.length ? (
            <ul className="bars">
              {groupRows.map(([g, n]) => (
                <li key={g}>
                  <span className="bar-label">{GROUP_LABELS[g]}</span>
                  <span className="bar-track accent">
                    <span style={{ width: `${(n / maxGroup) * 100}%` }} />
                  </span>
                  <span className="bar-value">{n}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">This site doesn’t declare CSS custom properties. Colors, type and shadows below are detected from rendered elements only.</p>
          )}
        </section>
      </div>

      <section className="card legend">
        <h3>How to read this</h3>
        <div className="legend-row">
          <span className="badge badge-token">
            {Icons.braces(11)}
            <span className="mono">--token-name</span>
          </span>
          <span>A real CSS custom property declared by the site whose resolved value matches. Click to copy <code>var(…)</code>.</span>
        </div>
        <div className="legend-row">
          <span className="badge badge-raw">Raw value</span>
          <span>Detected on rendered elements via <code>getComputedStyle()</code>, but no variable on the page resolves to it.</span>
        </div>
        <div className="legend-row">
          <span className="badge badge-neutral">{Icons.target(11)} Find</span>
          <span>Outlines every element that uses the value on the page. Use ‹ › in the page pill to step through, Esc to clear.</span>
        </div>
      </section>

      <p className="footnote">
        Scanned {data.elementsScanned.toLocaleString()} visible of {data.elementsTotal.toLocaleString()} elements
        {data.truncated ? ' (capped)' : ''} in {data.durationMs} ms · {data.stylesheets.readable}/{data.stylesheets.total} stylesheets readable · runs
        locally, nothing leaves your browser.
      </p>
    </div>
  );
}
