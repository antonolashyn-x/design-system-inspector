import { useMemo, useState } from 'react';
import type { CssToken, ThemeInfo, TokenGroup } from '../../shared/types';
import { Copyable, Empty, FontStack, Icons, Search, Segmented, ShowMore, useActions } from '../ui';

export const GROUP_LABELS: Record<TokenGroup, string> = {
  color: 'Color',
  typography: 'Typography',
  spacing: 'Spacing',
  radius: 'Radius',
  shadow: 'Shadow',
  size: 'Size',
  motion: 'Motion',
  'z-index': 'Z-index',
  breakpoint: 'Breakpoint',
  other: 'Other',
};

const ORDER: TokenGroup[] = ['color', 'typography', 'spacing', 'radius', 'shadow', 'size', 'motion', 'z-index', 'breakpoint', 'other'];

// Typography tokens split by the property they set.
type TypeCat = 'style' | 'font-family' | 'font-size' | 'font-weight' | 'line-height' | 'letter-spacing' | 'other';
const TYPE_CATS: TypeCat[] = ['style', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'other'];
const TYPE_CAT_LABELS: Record<TypeCat, string> = {
  style: 'Text style',
  'font-family': 'Font family',
  'font-size': 'Font size',
  'font-weight': 'Font weight',
  'line-height': 'Line height',
  'letter-spacing': 'Letter spacing',
  other: 'Other',
};
const typeCat = (t: CssToken): TypeCat => (t.fontShorthand ? 'style' : (t.typeProperty ?? 'other'));

/** Numeric tokens in scale order (small → large); families, styles and the rest by name. */
function sortTypeTokens(cat: TypeCat, list: CssToken[]) {
  const byName = (a: CssToken, b: CssToken) => a.name.localeCompare(b.name, undefined, { numeric: true });
  if (cat === 'style' || cat === 'font-family' || cat === 'other') return [...list].sort(byName);
  const num = (t: CssToken) => {
    const v = parseFloat(t.resolved ?? t.value);
    return Number.isNaN(v) ? Infinity : v;
  };
  return [...list].sort((a, b) => num(a) - num(b) || byName(a, b));
}

/** Length in px for ordering: px and rem/em (at 16px) by size, then percentages, then anything else. */
function lengthRank(value: string): number {
  const m = /^(-?[\d.]+)(px|rem|em|%)?$/.exec(value.trim());
  if (!m) return Number.MAX_VALUE;
  const n = parseFloat(m[1]);
  if (m[2] === '%') return 1e9 + n;
  return m[2] === 'rem' || m[2] === 'em' ? n * 16 : n;
}

/** Radii from the smallest to the largest; equal values by name. */
const sortRadius = (list: CssToken[]) =>
  [...list].sort((a, b) => lengthRank(a.value) - lengthRank(b.value) || a.name.localeCompare(b.name, undefined, { numeric: true }));

const ALIAS_RE = /^var\(\s*(--[\w-]+)\s*(?:,.*)?\)$/;

function Preview({
  group,
  value,
  color,
  colors,
  typeProp,
}: {
  group: TokenGroup;
  value: string;
  color?: string;
  colors?: string[];
  typeProp?: CssToken['typeProperty'];
}) {
  const v = value;
  switch (group) {
    case 'color': {
      // Several themes: one vertical stripe per theme, left to right in theme order.
      const bg =
        colors && colors.length > 1
          ? `linear-gradient(90deg, ${colors.map((c, i) => `${c} ${(i / colors.length) * 100}% ${((i + 1) / colors.length) * 100}%`).join(', ')})`
          : (color ?? v);
      return (
        <span className="tk-preview checker">
          <span style={{ background: bg }} />
        </span>
      );
    }
    case 'shadow':
      return (
        <span className="tk-preview tk-shadow-wrap">
          <span className="tk-shadow" style={{ boxShadow: v }} />
        </span>
      );
    case 'radius':
      return (
        <span className="tk-preview tk-radius-wrap">
          <span className="tk-radius" style={{ borderTopLeftRadius: v }} />
        </span>
      );
    case 'spacing':
    case 'size': {
      const ok = /^-?[\d.]+(px|rem|em)$/.test(v.trim());
      return (
        <span className="tk-preview tk-space-wrap">
          {ok && <span className="tk-space" style={{ width: `min(${v}, 100%)` }} />}
        </span>
      );
    }
    case 'typography': {
      if (typeProp === 'font-size' && /^[\d.]+(px|rem|em)$/.test(v.trim()))
        return (
          <span className="tk-preview tk-type" style={{ fontSize: `clamp(9px, ${v}, 26px)` }}>
            Aa
          </span>
        );
      const isFamily = /,|sans|serif|mono/i.test(v);
      const isWeight = /^\d{3}$/.test(v.trim()) || /^(bold|normal)$/.test(v);
      return (
        <span
          className="tk-preview tk-type"
          style={isFamily ? { fontFamily: v } : isWeight ? { fontWeight: v as unknown as number } : undefined}
        >
          Aa
        </span>
      );
    }
    default:
      return <span className="tk-preview tk-empty">{Icons.braces(14)}</span>;
  }
}

function AliasLink({ name, onFocus }: { name: string; onFocus: (name: string) => void }) {
  return (
    <button className="tk-alias mono small" title="Alias — jump to the referenced token" onClick={() => onFocus(name)}>
      {Icons.arrow(11)} {name}
    </button>
  );
}

function TokenRow({ t, view, themes, onFocusAlias }: { t: CssToken; view: string; themes: ThemeInfo[]; onFocusAlias: (name: string) => void }) {
  const { copy } = useActions();
  const tv = t.themeValues;
  const allThemes = !!tv && view === 'all';
  const current = tv && view !== 'all' ? tv[view] : undefined;

  const value = current?.value ?? t.value ?? t.rawValue;
  const raw = current ? current.raw : t.rawValue;
  const alias = (current ? ALIAS_RE.exec(current.raw)?.[1] : t.aliasOf) ?? undefined;
  const shownThemes = tv ? themes.filter((th) => tv[th.id]) : [];
  // Font stacks are long; they're shortened to the first font and the raw form is left out.
  const isStack = t.typeProperty === 'font-family';

  return (
    <div className={`row token-row${tv ? ' is-themed' : ''}`} id={`tk-${t.name}`}>
      <Preview
        group={t.group}
        value={value}
        color={current?.previewColor ?? t.previewColor}
        colors={allThemes ? shownThemes.map((th) => tv![th.id].previewColor).filter((c): c is string => !!c) : undefined}
        typeProp={t.typeProperty}
      />
      <div className="tk-main">
        <button className="tk-name mono" onClick={() => copy(`var(${t.name})`, t.name)} title="Copy var()">
          {t.name}
        </button>
        {allThemes ? (
          <div className="theme-vals">
            {shownThemes.map((th) => {
              const v = tv![th.id];
              return (
                <div className="theme-val" key={th.id} title={`${th.label}: ${v.raw}${v.inherited ? ' (inherited)' : ''}`}>
                  {v.previewColor ? (
                    <span className="mini-swatch checker">
                      <span style={{ background: v.previewColor }} />
                    </span>
                  ) : (
                    <span className="mini-swatch blank" />
                  )}
                  <span className="tv-label">{th.label}</span>
                  <Copyable text={v.value} className={`mono small tk-value${v.inherited ? ' muted' : ''}`} />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="tk-values">
            {isStack ? <FontStack value={value} className="mono small tk-value" /> : <Copyable text={value} className="mono small tk-value" />}
            {current?.inherited && <span className="small muted">inherited</span>}
            {alias ? (
              <AliasLink name={alias} onFocus={onFocusAlias} />
            ) : (
              !isStack &&
              raw &&
              raw !== value && (
                <span className="mono small muted tk-raw" title="As written in the stylesheet">
                  {raw}
                </span>
              )
            )}
          </div>
        )}
      </div>
      <div className="tk-meta">
        {!tv && (
          <span className="scope-chip mono" title={t.scopes.join('\n')}>
            {t.scopes[0]}
            {t.scopes.length > 1 && <b> +{t.scopes.length - 1}</b>}
          </span>
        )}
        {t.references > 0 && <span className="muted small">{t.references} refs</span>}
        {t.source !== 'stylesheet' && (
          <span
            className="src-chip"
            title={t.source === 'computed' ? 'Found in computed styles (stylesheet unreadable or set via JS)' : 'Declared in an inline style attribute'}
          >
            {t.source}
          </span>
        )}
      </div>
    </div>
  );
}

export function Tokens({ tokens, themes }: { tokens: CssToken[]; themes: ThemeInfo[] }) {
  const [q, setQ] = useState('');
  const [view, setView] = useState<string>('all'); // 'all' or a theme id
  const [themedOnly, setThemedOnly] = useState(false);
  const [group, setGroupState] = useState<TokenGroup | 'all'>('all');
  const [cat, setCat] = useState<TypeCat | 'all'>('all');
  const setGroup = (g: TokenGroup | 'all') => {
    setGroupState(g);
    setCat('all');
  };
  const [aliasesOnly, setAliasesOnly] = useState(false);
  const [limit, setLimit] = useState(250);

  const counts = useMemo(() => {
    const m = new Map<TokenGroup, number>();
    for (const t of tokens) m.set(t.group, (m.get(t.group) ?? 0) + 1);
    return m;
  }, [tokens]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return tokens.filter((t) => {
      const tv = t.themeValues;
      if (group !== 'all' && t.group !== group) return false;
      if (group === 'typography' && cat !== 'all' && typeCat(t) !== cat) return false;
      if (aliasesOnly && !t.aliasOf) return false;
      if (tv && view !== 'all' && !tv[view]) return false; // e.g. a dark-only token in the light view
      if (themedOnly && !(tv && (view === 'all' || !tv[view]?.inherited))) return false;
      if (!query) return true;
      const values = tv ? Object.values(tv).map((v) => v.value.toLowerCase()) : [];
      return t.name.toLowerCase().includes(query) || t.value.toLowerCase().includes(query) || t.rawValue.toLowerCase().includes(query) || values.some((v) => v.includes(query));
    });
  }, [tokens, q, group, cat, aliasesOnly, view, themedOnly]);

  const catCounts = useMemo(() => {
    const m = new Map<TypeCat, number>();
    for (const t of tokens) if (t.group === 'typography') m.set(typeCat(t), (m.get(typeCat(t)) ?? 0) + 1);
    return m;
  }, [tokens]);

  const sections = useMemo(() => {
    const visible = filtered.slice(0, limit);
    return ORDER.map((g) => [g, visible.filter((t) => t.group === g)] as const).filter(([, list]) => list.length);
  }, [filtered, limit]);

  const focusAlias = (name: string) => {
    setQ('');
    setGroup('all');
    setAliasesOnly(false);
    setThemedOnly(false);
    setLimit(tokens.length);
    requestAnimationFrame(() => {
      const el = document.getElementById(`tk-${name}`);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el?.classList.add('flash');
      setTimeout(() => el?.classList.remove('flash'), 1200);
    });
  };

  if (!tokens.length)
    return (
      <div className="view">
        <Empty title="No CSS custom properties found">
          This site doesn’t declare <code>--variables</code> (or they live in unreadable cross-origin stylesheets). Use the Colors, Typography and
          Shadows tabs — they’re detected from rendered elements.
        </Empty>
      </div>
    );

  const aliasCount = tokens.filter((t) => t.aliasOf).length;
  const themedCount = tokens.filter((t) => t.themeValues).length;
  const activeTheme = themes.find((t) => t.active);
  const defaultTheme = themes.find((t) => t.isDefault);

  return (
    <div className="view">
      {themes.length > 0 && (
        <div className="theme-bar">
          <Segmented
            full
            value={view}
            onChange={setView}
            options={[{ value: 'all', label: 'All themes' }, ...themes.map((t) => ({ value: t.id, label: t.label, count: t.tokenCount }))]}
          />
          <div className="theme-meta">
            <span className="small muted">
              {themedCount} tokens change per theme
              {activeTheme && <> · page shows <b>{activeTheme.label}</b></>}
              {defaultTheme && defaultTheme !== activeTheme && <> · default {defaultTheme.label}</>}
            </span>
            <label className="toggle" title="Hide tokens that are the same in every theme">
              <input type="checkbox" checked={themedOnly} onChange={(e) => setThemedOnly(e.target.checked)} />
              Theme-specific only
            </label>
          </div>
        </div>
      )}
      <div className="toolbar">
        <Search value={q} onChange={setQ} placeholder="Search token name or value" />
        {aliasCount > 0 && (
          <label className="toggle" title="Show only semantic tokens that point at another token">
            <input type="checkbox" checked={aliasesOnly} onChange={(e) => setAliasesOnly(e.target.checked)} />
            Aliases only <span className="seg-count">{aliasCount}</span>
          </label>
        )}
      </div>
      <div className="chips">
        <button className={`chip ${group === 'all' ? 'is-active' : ''}`} onClick={() => setGroup('all')}>
          All <span>{tokens.length}</span>
        </button>
        {ORDER.filter((g) => counts.get(g)).map((g) => (
          <button key={g} className={`chip ${group === g ? 'is-active' : ''}`} onClick={() => setGroup(g)}>
            {GROUP_LABELS[g]} <span>{counts.get(g)}</span>
          </button>
        ))}
      </div>
      {group === 'typography' && (
        <div className="chips sub-chips">
          <button className={`chip ${cat === 'all' ? 'is-active' : ''}`} onClick={() => setCat('all')}>
            All <span>{counts.get('typography')}</span>
          </button>
          {TYPE_CATS.filter((c) => catCounts.get(c)).map((c) => (
            <button key={c} className={`chip ${cat === c ? 'is-active' : ''}`} onClick={() => setCat(c)}>
              {TYPE_CAT_LABELS[c]} <span>{catCounts.get(c)}</span>
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <Empty title="No tokens match" />
      ) : (
        <>
          {sections.map(([g, list]) => (
            <section key={g} className="token-section">
              <h4 className="group-title">
                {GROUP_LABELS[g]} <span className="muted">{filtered.filter((t) => t.group === g).length}</span>
              </h4>
              {g === 'typography' ? (
                TYPE_CATS.map((c) => [c, list.filter((t) => typeCat(t) === c)] as const)
                  .filter(([, sub]) => sub.length)
                  .map(([c, sub]) => (
                    <div key={c} className="token-subsection">
                      <h5 className="subgroup-title">
                        {TYPE_CAT_LABELS[c]} <span className="muted">{sub.length}</span>
                      </h5>
                      <div className="list">
                        {sortTypeTokens(c, sub).map((t) => (
                          <TokenRow key={t.name} t={t} view={view} themes={themes} onFocusAlias={focusAlias} />
                        ))}
                      </div>
                    </div>
                  ))
              ) : (
                <div className="list">
                  {(g === 'radius' ? sortRadius(list) : list).map((t) => (
                    <TokenRow key={t.name} t={t} view={view} themes={themes} onFocusAlias={focusAlias} />
                  ))}
                </div>
              )}
            </section>
          ))}
          <ShowMore shown={limit} total={filtered.length} onMore={() => setLimit((l) => l + 200)} />
        </>
      )}
    </div>
  );
}
