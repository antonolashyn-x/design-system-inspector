import { useMemo, useState, type CSSProperties } from 'react';
import type { CssToken, TypeTokenRef, TypographyEntry } from '../../shared/types';
import { Copyable, Empty, FontStack, HighlightButton, Icons, Search, Segmented, ShowMore, useActions } from '../ui';

type Sort = 'usage' | 'size';
type SubTab = 'styles' | 'font-family' | 'font-size' | 'font-weight';
type Prop = Exclude<SubTab, 'styles'>;

const WEIGHT_NAMES: Record<string, string> = {
  '100': 'Thin',
  '200': 'ExtraLight',
  '300': 'Light',
  '400': 'Regular',
  '500': 'Medium',
  '600': 'SemiBold',
  '700': 'Bold',
  '800': 'ExtraBold',
  '900': 'Black',
};

const px = (v: string) => (v.endsWith('px') ? String(Math.round(parseFloat(v) * 100) / 100) : v);
const weightName = (w: string) => WEIGHT_NAMES[w] ?? w;

/** Size/line-height spec, e.g. "32/40" (or "32/auto" for `line-height: normal`). */
const specOf = (e: TypographyEntry) => `${px(e.fontSize)}/${e.lineHeight === 'normal' ? 'auto' : px(e.lineHeight)}`;

/** Heading tags rendering this style ("<h1> <h2>"); other tags (span, p, div…) say nothing useful. */
const headingTags = (e: TypographyEntry) =>
  Object.keys(e.tags)
    .filter((t) => /^h[1-6]$/.test(t))
    .sort()
    .map((t) => `<${t}>`)
    .join(' ');

// ---- Styles: type-scale table ---------------------------------------------
// One row per text style: Type (name, style token, heading tag) · Font family · Font size · Line height · Font weight
// · Letter spacing (hidden when no style on the page sets one).
// Wide panels get a real table; the narrow sidebar stacks each row into a card with a 2-column grid.

const SIZE_WORD = /^(\d*x*[sml]|sm|md|lg|\d*x[sl]|xx[sl]|base|\d{1,3})$/i;
// Property words that trail token names: "--heading-xxs-size", "--body-weight".
const PROP_WORD = /^(size|font|weight|family|line|height|leading|letter|spacing|tracking)$/i;

// Only names that obviously say what the text is. Earlier entries win: ".display-4.text-muted" is Display.
const ROLES: [RegExp, string][] = [
  [/^display$/, 'Display'],
  [/^h[1-6]$/, 'Heading'],
  [/^(heading|headline)$/, 'Heading'],
  [/^title$/, 'Title'],
  [/^(btn|button)$/, 'Button'],
  [/^link$/, 'Link'],
  [/^body$/, 'Body'],
  [/^text$/, 'Text'],
];
// Roles a name may also start with: ".btn-primary", ".link-secondary".
const LEADING_ROLES = new Set(['Button', 'Link']);

const roleOf = (word: string) => {
  const rank = ROLES.findIndex(([re]) => re.test(word));
  return rank < 0 ? null : { role: ROLES[rank][1], rank };
};

/**
 * The role is the word that ends the name, so containers and colors don't count:
 * "card-title" → Title, "btn-lg" → Button LG, "display-4" → Display 4, "h3" → Heading 3,
 * "hds-text--xl" → Text XL, "--text-heading-2xl" → Heading 2XL, but "text-center", "text-gray-500"
 * and "footer-cta-section__description" → null. BEM: only the element after "__" describes this text.
 */
function roleName(name: string): { role: string; rank: number; label: string } | null {
  let raw = name.replace(/^(--|\.)/, '').toLowerCase();
  if (raw.includes('__')) raw = raw.slice(raw.lastIndexOf('__') + 2);
  const [base, ...mods] = raw.split('--');
  const parts = base.split(/[-_]/).filter(Boolean);
  while (parts.length > 1 && PROP_WORD.test(parts[parts.length - 1])) parts.pop();
  const sizes: string[] = [];
  while (parts.length > 1 && SIZE_WORD.test(parts[parts.length - 1])) sizes.unshift(parts.pop()!);
  const modSize = mods.find((m) => SIZE_WORD.test(m));
  if (modSize) sizes.push(modSize);
  if (!parts.length) return null;

  let hit = roleOf(parts[parts.length - 1]);
  if (!hit && parts.length > 1) {
    const lead = roleOf(parts[0]);
    if (lead && LEADING_ROLES.has(lead.role)) hit = lead;
  }
  if (!hit) return null;
  const heading = /^h([1-6])$/.exec(parts[parts.length - 1]);
  const size = heading?.[1] ?? sizes[sizes.length - 1];
  const sizeLabel = size ? (size === 'base' ? 'Base' : size.toUpperCase()) : '';
  return { ...hit, label: sizeLabel ? `${hit.role} ${sizeLabel}` : hit.role };
}

/** Best role among a style's token and class names. */
function bestRole(names: string[]) {
  let best: ReturnType<typeof roleName> = null;
  for (const n of names) {
    const r = roleName(n);
    // Same role: prefer the variant that carries a size ("btn-lg" over "btn").
    if (r && (!best || r.rank < best.rank || (r.rank === best.rank && r.label.length > best.label.length))) best = r;
  }
  return best;
}

const PLACEHOLDER_NAME = 'Lorem Ipsum';

/** Names that may say what a style is: applied style tokens, else its most common classes. */
const styleNames = (e: TypographyEntry) => {
  const declared = e.styleTokens.filter((t) => t.declared);
  // A class names the style only if it's on a fair share of its elements, not on one stray element.
  return declared.length ? declared.map((t) => t.name) : e.classes.filter((c) => c.count * 4 >= e.count).map((c) => c.name);
};

/** "Button LG", "Title", … when a token or class says what the text is; otherwise a placeholder. */
export function styleName(e: TypographyEntry): { name: string; known: boolean } {
  const role = bestRole(styleNames(e));
  return role ? { name: role.label, known: true } : { name: PLACEHOLDER_NAME, known: false };
}

/** Same purple badge as the token badges elsewhere; dashed with "≈" when the token only shares the value. */
function TokenBadgeChip({ token }: { token: TypeTokenRef }) {
  const { copy } = useActions();
  const title = token.declared
    ? `CSS variable declared on ${token.scope} — click to copy`
    : `Same value as var(${token.name}), but the CSS doesn’t reference it — click to copy`;
  return (
    <button className={`badge badge-token${token.declared ? '' : ' approx'}`} title={title} onClick={() => copy(`var(${token.name})`, token.name)}>
      {token.declared ? Icons.braces(11) : <span aria-label="same value">≈</span>}
      <span className="mono">{token.name}</span>
    </button>
  );
}

/** The first token, then "+N" for the others: hover lists them, click shows them all. */
function TokenChips({ tokens }: { tokens: TypeTokenRef[] }) {
  const [open, setOpen] = useState(false);
  if (!tokens.length) return null;
  const rest = tokens.slice(1);
  const noun = rest.length === 1 ? 'other token' : 'other tokens';
  const what = tokens[0].declared ? `${noun} applied here` : `${noun} with the same value`;
  return (
    <span className="badge-row ts-chips">
      {(open ? tokens : tokens.slice(0, 1)).map((t) => (
        <TokenBadgeChip key={t.name} token={t} />
      ))}
      {rest.length > 0 && (
        <button
          className="badge badge-more"
          title={open ? 'Show fewer' : `${rest.length} ${what}:\n${rest.map((t) => t.name).join('\n')}\n\nClick to show them`}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? 'Less' : `+${rest.length}`}
        </button>
      )}
    </span>
  );
}

function PropCell({
  label,
  tokens,
  value,
  note,
  title,
  className = '',
}: {
  label: string;
  tokens: TypeTokenRef[];
  value: string;
  note?: string;
  title?: string;
  className?: string;
}) {
  return (
    <div className={`ts-cell ${className}`}>
      <span className="ts-label">{label}</span>
      <TokenChips tokens={tokens} />
      <span className="ts-value" title={title}>
        {value}
        {note && <span className="muted"> {note}</span>}
      </span>
    </div>
  );
}

const em = (px: number, size: number) => `${Math.round((px / size) * 1000) / 1000}em`;

function Styles({ styles }: { styles: TypographyEntry[] }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('size');
  const [limit, setLimit] = useState(80);
  const names = useMemo(() => new Map(styles.map((s) => [s.key, styleName(s)])), [styles]);
  const nameOf = (s: TypographyEntry) => names.get(s.key)!;

  const list = useMemo(() => {
    const query = q.trim().toLowerCase();
    const out = styles.filter(
      (s) =>
        !query ||
        s.fontFamily.toLowerCase().includes(query) ||
        s.fontSize.includes(query) ||
        s.fontWeight.includes(query) ||
        nameOf(s).name.toLowerCase().includes(query) ||
        Object.keys(s.tags).includes(query.replace(/[<>]/g, '')) ||
        s.styleTokens.some((t) => t.name.toLowerCase().includes(query)) ||
        s.classes.some((c) => c.name.toLowerCase().includes(query)) ||
        s.tokens.some((t) => t.token.name.toLowerCase().includes(query)),
    );
    return sort === 'size' ? [...out].sort((a, b) => b.fontSizePx - a.fontSizePx || b.count - a.count) : out;
  }, [styles, q, sort, names]);

  const hasLetterSpacing = useMemo(() => styles.some((s) => s.letterSpacing !== 'normal' && parseFloat(s.letterSpacing) !== 0), [styles]);

  const tokensFor = (s: TypographyEntry, prop: TypographyEntry['tokens'][number]['property']) =>
    s.tokens.filter((t) => t.property === prop).map((t) => t.token);

  return (
    <>
      <div className="toolbar">
        <Search value={q} onChange={setQ} placeholder="Search style, token, class or size" />
        <Segmented
          value={sort}
          onChange={setSort}
          options={[
            { value: 'size', label: 'Type scale' },
            { value: 'usage', label: 'Most used' },
          ]}
        />
      </div>

      {list.length === 0 ? (
        <Empty title="No text styles match" />
      ) : (
        <div className="ts-table" role="table" style={{ '--ts-cols': hasLetterSpacing ? 5 : 4 } as CSSProperties}>
          <div className="ts-head" role="row">
            <span>Type</span>
            <span>Font family</span>
            <span>Font size</span>
            <span>Line height</span>
            <span>Font weight</span>
            {hasLetterSpacing && <span>Letter spacing</span>}
          </div>
          {list.slice(0, limit).map((s) => {
            const { name, known } = nameOf(s);
            const declaredStyle = s.styleTokens.filter((t) => t.declared);
            const styleTokens = declaredStyle.length ? declaredStyle : s.styleTokens;
            const headings = headingTags(s);
            const lh = parseFloat(s.lineHeight);
            const ls = s.letterSpacing === 'normal' ? 0 : parseFloat(s.letterSpacing);
            return (
              <div className="ts-row" role="row" key={s.key}>
                <div className="ts-type">
                  <span
                    className="ts-name"
                    style={{
                      fontFamily: s.fontFamily,
                      fontWeight: s.fontWeight as CSSProperties['fontWeight'],
                      fontSize: `${Math.min(s.fontSizePx, 32)}px`,
                      letterSpacing: s.letterSpacing,
                      textTransform: s.textTransform as CSSProperties['textTransform'],
                    }}
                    title={`${known ? '' : 'No token or class says what this text is (button, link, heading, title, display, body, text). '}${s.primaryFamily} — “${s.sample}” · used ${s.count.toLocaleString()}×`}
                  >
                    {name}
                  </span>
                  <TokenChips tokens={styleTokens} />
                  <span className="ts-meta">
                    <span className="muted">{headings}</span>
                    <HighlightButton id={s.key} label={`${name} · ${specOf(s)}`} />
                  </span>
                </div>
                <PropCell
                  label="Font family"
                  tokens={tokensFor(s, 'font-family')}
                  value={s.primaryFamily}
                  title={s.fontFamily}
                  className="ts-family"
                />
                <PropCell label="Font size" tokens={tokensFor(s, 'font-size')} value={`${px(s.fontSize)}px`} />
                <PropCell
                  label="Line height"
                  tokens={tokensFor(s, 'line-height')}
                  value={Number.isNaN(lh) ? s.lineHeight : `${px(s.lineHeight)}px`}
                  note={Number.isNaN(lh) ? undefined : `(${Math.round((lh / s.fontSizePx) * 100) / 100})`}
                />
                <PropCell label="Font weight" tokens={tokensFor(s, 'font-weight')} value={s.fontWeight} note={WEIGHT_NAMES[s.fontWeight]} />
                {hasLetterSpacing && (
                  <PropCell
                    label="Letter spacing"
                    tokens={tokensFor(s, 'letter-spacing')}
                    value={ls ? `${px(s.letterSpacing)}px` : '0'}
                    note={ls ? `(${em(ls, s.fontSizePx)})` : undefined}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
      <ShowMore shown={limit} total={list.length} onMore={() => setLimit((l) => l + 200)} />
      <p className="hint ts-tip">Tip: drag the panel’s left edge to widen it and see the full table.</p>
    </>
  );
}

// ---- Per-property token views (family / size / weight) --------------------

interface ValueRow {
  value: string; // computed value, e.g. "14px", "600", "Inter, sans-serif"
  count: number;
  tokens: Set<string>;
}

const REG_PREFIX: Record<Prop, string> = { 'font-family': 'ff', 'font-size': 'fs', 'font-weight': 'fw' };
const LABEL: Record<Prop, string> = { 'font-family': 'font family', 'font-size': 'font size', 'font-weight': 'font weight' };

const entryValue = (e: TypographyEntry, prop: Prop) =>
  prop === 'font-family' ? e.fontFamily : prop === 'font-size' ? e.fontSize : e.fontWeight;

const sortValues = (prop: Prop) => (a: ValueRow, b: ValueRow) =>
  prop === 'font-size' ? parseFloat(b.value) - parseFloat(a.value) : prop === 'font-weight' ? parseFloat(a.value) - parseFloat(b.value) : b.count - a.count;

function previewStyle(prop: Prop, value: string): CSSProperties {
  if (prop === 'font-family') return { fontFamily: value };
  if (prop === 'font-weight') return { fontWeight: value as CSSProperties['fontWeight'] };
  return { fontSize: `${Math.min(Math.max(parseFloat(value) || 14, 9), 28)}px` };
}

function Preview({ prop, value }: { prop: Prop; value: string }) {
  return (
    <span className="tp-preview" style={previewStyle(prop, value)} aria-hidden="true">
      Aa
    </span>
  );
}

function PropertyView({ prop, styles, tokens }: { prop: Prop; styles: TypographyEntry[]; tokens: CssToken[] }) {
  const { copy } = useActions();

  const values = useMemo(() => {
    const map = new Map<string, ValueRow>();
    for (const e of styles) {
      const v = entryValue(e, prop);
      let row = map.get(v);
      if (!row) map.set(v, (row = { value: v, count: 0, tokens: new Set() }));
      row.count += e.count;
      for (const t of e.tokens) if (t.property === prop) row.tokens.add(t.token.name);
    }
    return [...map.values()].sort(sortValues(prop));
  }, [styles, prop]);

  const propTokens = useMemo(() => {
    const list = tokens
      .filter((t) => t.typeProperty === prop)
      .map((t) => {
        const matched = values.filter((v) => v.tokens.has(t.name));
        return { token: t, matched, count: matched.reduce((n, v) => n + v.count, 0) };
      });
    const num = (t: CssToken) => parseFloat(t.resolved ?? t.value) || 0;
    return list.sort((a, b) =>
      prop === 'font-size' ? num(b.token) - num(a.token) : prop === 'font-weight' ? num(a.token) - num(b.token) : b.count - a.count || a.token.name.localeCompare(b.token.name),
    );
  }, [tokens, values, prop]);

  const untokenized = values.filter((v) => v.tokens.size === 0);
  const maxCount = Math.max(1, ...values.map((v) => v.count));
  const keysFor = (vals: ValueRow[]) => vals.map((v) => `${REG_PREFIX[prop]}:${v.value}`);

  return (
    <>
      <section className="token-section">
        <h4 className="group-title">
          Tokens <span className="muted">{propTokens.length}</span>
        </h4>
        {propTokens.length === 0 ? (
          <p className="hint">This site doesn’t declare {LABEL[prop]} tokens. The values below are detected from rendered text.</p>
        ) : (
          <div className="list">
            {propTokens.map(({ token, matched, count }) => (
              <div className="row tp-row" key={token.name}>
                <Preview prop={prop} value={matched[0]?.value ?? token.resolved ?? token.value} />
                <div className="tk-main">
                  <button className="tk-name mono" onClick={() => copy(`var(${token.name})`, token.name)} title="Copy var()">
                    {token.name}
                  </button>
                  <div className="tk-values">
                    {prop === 'font-family' ? (
                      <FontStack value={token.value} className="mono small tk-value" />
                    ) : (
                      <Copyable text={token.value} className="mono small tk-value" />
                    )}
                    {token.resolved && token.resolved !== token.value && <span className="mono small muted">= {token.resolved}</span>}
                    {prop === 'font-weight' && token.resolved && <span className="small muted">{weightName(token.resolved)}</span>}
                    {token.aliasOf && <span className="tk-alias mono small">→ {token.aliasOf}</span>}
                  </div>
                </div>
                {count > 0 ? (
                  <>
                    <span className="usage-count">{count.toLocaleString()}×</span>
                    <HighlightButton id={`tok:${prop}:${token.name}`} label={token.name} keys={keysFor(matched)} />
                  </>
                ) : (
                  <span className="muted small tp-unused">Not used here</span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {untokenized.length > 0 && (
        <section className="token-section">
          <h4 className="group-title">
            {propTokens.length ? 'Values without a token' : 'Detected values'} <span className="muted">{untokenized.length}</span>
          </h4>
          <div className="list">
            {untokenized.map((v) => (
              <div className="row tp-row" key={v.value}>
                <Preview prop={prop} value={v.value} />
                <div className="tk-main">
                  {prop === 'font-family' ? (
                    <FontStack value={v.value} className="mono strong tp-value" />
                  ) : (
                    <Copyable text={v.value} className="mono strong tp-value">
                      {prop === 'font-weight' ? `${v.value} · ${weightName(v.value)}` : v.value}
                    </Copyable>
                  )}
                  <span className="usage-bar tp-bar">
                    <span style={{ width: `${Math.max(4, (v.count / maxCount) * 100)}%` }} />
                  </span>
                </div>
                <span className="usage-count">{v.count.toLocaleString()}×</span>
                <HighlightButton id={`val:${prop}:${v.value}`} label={`${LABEL[prop]} ${v.value}`} keys={keysFor([v])} />
              </div>
            ))}
          </div>
        </section>
      )}

      {values.length > untokenized.length && propTokens.length > 0 && (
        <p className="hint">
          {values.length - untokenized.length} of {values.length} detected {LABEL[prop]} values match a token.
        </p>
      )}
    </>
  );
}

export function Typography({ styles, tokens }: { styles: TypographyEntry[]; tokens: CssToken[] }) {
  const [sub, setSub] = useState<SubTab>('styles');
  const count = (p: Prop) => tokens.filter((t) => t.typeProperty === p).length;

  return (
    <div className="view">
      <Segmented
        full
        value={sub}
        onChange={setSub}
        options={[
          { value: 'styles', label: 'Styles', count: styles.length },
          { value: 'font-family', label: 'Font family', count: count('font-family') },
          { value: 'font-size', label: 'Font size', count: count('font-size') },
          { value: 'font-weight', label: 'Font weight', count: count('font-weight') },
        ]}
      />
      {styles.length === 0 ? (
        <Empty title="No text found on this page" />
      ) : sub === 'styles' ? (
        <Styles styles={styles} />
      ) : (
        <PropertyView key={sub} prop={sub} styles={styles} tokens={tokens} />
      )}
      <p className="hint">Previews use fonts installed on your computer; the site’s web fonts may fall back.</p>
    </div>
  );
}
