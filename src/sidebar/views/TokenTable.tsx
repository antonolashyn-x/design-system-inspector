import { Fragment, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement, type ReactNode, type RefObject } from 'react';
import type { CssToken, ThemeInfo, TokenGroup } from '../../shared/types';
import { Copyable, Empty, FontStack, Icons, ShowMore, useActions } from '../ui';

// Figma-style table layout for the Tokens tab: collections (token categories) and name groups on the left,
// a Name | Value table on the right with one value column per theme, like Figma's modes.

export const ALIAS_RE = /^var\(\s*(--[\w-]+)\s*(?:,.*)?\)$/;

export type CollectionId = TokenGroup | 'all';
export interface Collection {
  id: CollectionId;
  label: string;
  /** Tokens in it that pass the current search and filters. */
  count: number;
}

const GROUP_ICONS: Record<TokenGroup, (s?: number) => ReactElement> = {
  color: Icons.palette,
  typography: Icons.type,
  spacing: Icons.spacing,
  radius: Icons.radius,
  shadow: Icons.shadow,
  size: Icons.ruler,
  motion: Icons.timer,
  'z-index': Icons.layers,
  breakpoint: Icons.monitor,
  other: Icons.braces,
};

// ---- Groups from token names ------------------------------------------------
// Figma groups variables by slash paths; CSS names use dashes: "--color-text-brand-bold" sits in
// color / text / brand as "bold". A prefix becomes a group when at least two longer names share it,
// unless all of them only add a state ("bold-hovered", "bold-selected" stay next to "bold").
// A group holding nothing but one subgroup merges into it ("hds-font").

export interface GroupNode {
  /** Name prefix without "--", e.g. "color-text". Empty for the root. */
  path: string;
  /** Sidebar label: the last word of the path, or several for a merged chain. */
  label: string;
  depth: number;
  parent: GroupNode | null;
  tokens: CssToken[];
  children: GroupNode[];
}

const MAX_DEPTH = 4;
const STATE_WORD = /^(hover|hovered|active|pressed|focus|focused|selected|checked|disabled|visited|current|open|expanded|dragged)$/;

/** T-shirt sizes in scale order: xs < s/sm < m/md/base < l/lg < xl < 2xl. */
function sizeRank(w: string): number | null {
  if (/^(sm|small)$/.test(w)) return -1;
  if (/^(m|md|base|medium|default|regular)$/.test(w)) return 0;
  if (/^(lg|large)$/.test(w)) return 1;
  const m = /^(\d*)(x*)([sl])$/.exec(w);
  if (!m || (m[1] && m[2] !== 'x')) return null;
  const n = m[1] ? Number(m[1]) : m[2].length;
  return m[3] === 's' ? -(n + 1) : n + 1;
}

/** Sort key of one name word: "none" first, then sizes in scale order, then words and numbers, then "full". */
function wordKey(w: string): [number, number] {
  if (/^(none|0)$/.test(w)) return [0, 0];
  const size = sizeRank(w);
  if (size !== null) return [1, size];
  if (/^(full|pill|round|circle|max)$/.test(w)) return [3, 0];
  return [2, 0];
}

/** Orders names word by word, so "sm, md, lg, full" and "50, 100, 900" read in scale order. */
export function compareNames(a: string, b: string) {
  const wa = a.split('-');
  const wb = b.split('-');
  for (let i = 0; i < Math.min(wa.length, wb.length); i++) {
    if (wa[i] === wb[i]) continue;
    const [ca, ra] = wordKey(wa[i]);
    const [cb, rb] = wordKey(wb[i]);
    return ca - cb || ra - rb || wa[i].localeCompare(wb[i], undefined, { numeric: true });
  }
  return wa.length - wb.length;
}

export function buildGroups(tokens: CssToken[]) {
  const words = tokens.map((t) => t.name.replace(/^--/, '').split('-').filter(Boolean));
  const shared = new Map<string, number>(); // prefix → longer names starting with it
  const grouping = new Set<string>(); // prefixes followed by something other than a state
  for (const w of words)
    for (let k = 1; k < w.length && k <= MAX_DEPTH; k++) {
      const p = w.slice(0, k).join('-');
      shared.set(p, (shared.get(p) ?? 0) + 1);
      if (!STATE_WORD.test(w[k])) grouping.add(p);
    }

  const root: GroupNode = { path: '', label: '', depth: 0, parent: null, tokens: [], children: [] };
  const nodes = new Map<string, GroupNode>();
  const leaf = new Map<string, string>(); // token name → name within its group
  tokens.forEach((t, i) => {
    const w = words[i];
    let node = root;
    let used = 0;
    for (let k = 1; k < w.length && k <= MAX_DEPTH; k++) {
      const p = w.slice(0, k).join('-');
      if ((shared.get(p) ?? 0) < 2 || !grouping.has(p)) break;
      let next = nodes.get(p);
      if (!next) {
        next = { path: p, label: w[k - 1], depth: 0, parent: node, tokens: [], children: [] };
        nodes.set(p, next);
        node.children.push(next);
      }
      node = next;
      used = k;
    }
    node.tokens.push(t);
    leaf.set(t.name, w.slice(used).join('-') || t.name);
  });

  const byPath = new Map<string, GroupNode>([['', root]]);
  const finish = (node: GroupNode, depth: number) => {
    node.depth = depth;
    node.tokens.sort((a, b) => compareNames(leaf.get(a.name)!, leaf.get(b.name)!));
    for (const c of node.children) {
      while (!c.tokens.length && c.children.length === 1) {
        const only = c.children[0];
        c.label += `-${only.label}`;
        c.path = only.path;
        c.tokens = only.tokens;
        c.children = only.children;
        for (const g of c.children) g.parent = c;
      }
      byPath.set(c.path, c);
      finish(c, depth + 1);
    }
    node.children.sort((a, b) => compareNames(a.label, b.label));
  };
  finish(root, 0);
  return { root, leaf, byPath };
}

const groupLabels = (node: GroupNode) => {
  const labels: string[] = [];
  for (let n: GroupNode | null = node; n?.parent; n = n.parent) labels.unshift(n.label);
  return labels;
};

/** "color / text / brand" with the last group in bold. */
function groupPath(node: GroupNode): ReactNode {
  const labels = groupLabels(node);
  const last = labels.pop();
  return (
    <>
      {labels.map((l) => `${l} / `).join('')}
      <b>{last}</b>
    </>
  );
}

function useWidth(ref: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

// ---- Cells --------------------------------------------------------------------

function Swatch({ color }: { color: string }) {
  return (
    <span className="tt-swatch checker">
      <span style={{ background: color }} />
    </span>
  );
}

/** Small previews where the value alone is hard to picture. */
function Mini({ group, value }: { group: TokenGroup; value: string }) {
  if (group === 'radius')
    return (
      <span className="tt-mini tt-mini-radius">
        <span style={{ borderTopLeftRadius: value }} />
      </span>
    );
  if (group === 'shadow')
    return (
      <span className="tt-mini tt-mini-shadow">
        <span style={{ boxShadow: value }} />
      </span>
    );
  return null;
}

function ValueCell({
  t,
  raw,
  value,
  color,
  inherited,
  span = 1,
  onFocusAlias,
}: {
  t: CssToken;
  raw: string;
  value: string;
  color?: string;
  inherited?: boolean;
  span?: number;
  onFocusAlias: (name: string) => void;
}) {
  const alias = ALIAS_RE.exec(raw)?.[1];
  const isStack = t.typeProperty === 'font-family';
  return (
    <div
      role="cell"
      className={`tt-cell tt-value${inherited ? ' is-inherited' : ''}`}
      style={span > 1 ? { gridColumn: `span ${span}` } : undefined}
      title={inherited ? 'Not declared in this theme: inherited from the default' : undefined}
    >
      {/* The muted second value wraps onto a clipped line when it doesn't fit whole, instead of shrinking to "#1…". */}
      <div className="tt-fit">
        {alias ? (
          <>
            <button className="tt-pill" title={`Alias of ${alias}\n\nClick to jump to it`} onClick={() => onFocusAlias(alias)}>
              {color && <Swatch color={color} />}
              <span className="mono">{alias}</span>
            </button>
            {value && value !== raw && <Copyable text={value} className="mono tt-sub" />}
          </>
        ) : (
          <>
            <span className="tt-lead">
              {color ? <Swatch color={color} /> : <Mini group={t.group} value={value} />}
              {isStack ? <FontStack value={value} className="mono tt-text" /> : <Copyable text={value} className="mono tt-text" />}
            </span>
            {!isStack && raw && raw !== value && (
              <span className="mono tt-sub" title="As written in the stylesheet">
                {raw}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

interface Column {
  /** Theme id; empty when the site has no themes. */
  id: string;
  label: string;
  active?: boolean;
  title?: string;
}

function Row({ t, leaf, columns, refs, onFocusAlias }: { t: CssToken; leaf: string; columns: Column[]; refs: boolean; onFocusAlias: (name: string) => void }) {
  const { copy } = useActions();
  const tv = t.themeValues;
  const where = t.source === 'computed' ? '\nFound in computed styles' : t.source === 'inline' ? '\nDeclared in an inline style attribute' : '';
  return (
    <div className="tt-row" role="row" id={`tk-${t.name}`}>
      <div className="tt-cell tt-name" role="cell">
        <span className="tt-icon">{GROUP_ICONS[t.group](14)}</span>
        <button className="tt-name-btn mono" onClick={() => copy(`var(${t.name})`, t.name)} title={`${t.name}\nDeclared on ${t.scopes.join(', ')}${where}\n\nClick to copy var()`}>
          {leaf}
        </button>
      </div>
      {tv && columns[0].id ? (
        columns.map((c) => {
          const v = tv[c.id];
          return v ? (
            <ValueCell key={c.id} t={t} raw={v.raw} value={v.value} color={v.previewColor} inherited={v.inherited} onFocusAlias={onFocusAlias} />
          ) : (
            <div key={c.id} role="cell" className="tt-cell tt-value is-missing" title={`Not declared for ${c.label}`}>
              —
            </div>
          );
        })
      ) : (
        // Same value in every theme: one cell across all theme columns.
        <ValueCell t={t} raw={t.rawValue} value={t.value || t.rawValue} color={t.previewColor} span={columns.length} onFocusAlias={onFocusAlias} />
      )}
      {refs && (
        <div role="cell" className={`tt-cell tt-refs${t.references ? '' : ' muted'}`} title={`Referenced ${t.references}× through var() in readable stylesheets`}>
          {t.references}
        </div>
      )}
    </div>
  );
}

function NavItem({
  label,
  count,
  depth = 0,
  active,
  dim,
  onClick,
  open,
  onToggle,
}: {
  label: string;
  count: number;
  /** Groups only (1 = top level): indents the row and reserves the chevron slot. */
  depth?: number;
  active: boolean;
  dim?: boolean;
  onClick: () => void;
  /** Set for groups with subgroups. */
  open?: boolean;
  onToggle?: (open: boolean) => void;
}) {
  const item = (
    <button
      className={`tt-item${active ? ' is-active' : ''}${dim ? ' is-dim' : ''}`}
      aria-current={active || undefined}
      aria-expanded={onToggle ? open : undefined}
      title={label}
      onClick={onClick}
      onKeyDown={(e) => {
        // Tree keys: → expands, ← collapses.
        if (!onToggle || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
        e.preventDefault();
        onToggle(e.key === 'ArrowRight');
      }}
    >
      <span className="tt-item-label">{label}</span>
      <span className="tt-item-count">{count.toLocaleString()}</span>
    </button>
  );
  if (!depth) return item;
  return (
    <div className="tt-node" style={{ '--depth': depth } as CSSProperties}>
      {onToggle ? (
        <button
          className={`tt-chev${open ? '' : ' is-closed'}`}
          tabIndex={-1}
          aria-label={`${open ? 'Collapse' : 'Expand'} ${label}`}
          title={open ? 'Collapse' : 'Expand'}
          onClick={() => onToggle(!open)}
        >
          {Icons.chevron(12)}
        </button>
      ) : (
        <span className="tt-chev" />
      )}
      {item}
    </div>
  );
}

// ---- Table ----------------------------------------------------------------------

export function TokenTable({
  tokens,
  shown,
  collections,
  collection,
  onCollection,
  path,
  onPath,
  themes,
  view,
  limit,
  onMore,
  onFocusAlias,
}: {
  /** Every token in the selected collection: the groups are built from these, so they don't shift while searching. */
  tokens: CssToken[];
  /** The ones that pass the search and filters. */
  shown: CssToken[];
  collections: Collection[];
  collection: CollectionId;
  onCollection: (id: CollectionId) => void;
  /** Selected group ("" = all). */
  path: string;
  onPath: (path: string) => void;
  themes: ThemeInfo[];
  /** "all" or a theme id. */
  view: string;
  limit: number;
  onMore: () => void;
  onFocusAlias: (name: string) => void;
}) {
  const { root, leaf, byPath } = useMemo(() => buildGroups(tokens), [tokens]);
  const shownSet = useMemo(() => new Set(shown.map((t) => t.name)), [shown]);
  const selected = byPath.get(path) ?? root;

  const counts = useMemo(() => {
    const m = new Map<GroupNode, number>();
    const walk = (n: GroupNode): number => {
      let c = n.tokens.filter((t) => shownSet.has(t.name)).length;
      for (const ch of n.children) c += walk(ch);
      m.set(n, c);
      return c;
    };
    walk(root);
    return m;
  }, [root, shownSet]);

  const sections = useMemo(() => {
    const out: { node: GroupNode; rows: CssToken[] }[] = [];
    const walk = (n: GroupNode) => {
      const rows = n.tokens.filter((t) => shownSet.has(t.name));
      if (rows.length) out.push({ node: n, rows });
      n.children.forEach(walk);
    };
    walk(selected);
    return out;
  }, [selected, shownSet]);

  // Docked sidebar when there's room; on a narrow panel it slides over the table and closes after a pick.
  const boxRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const wide = useWidth(boxRef) >= 640;
  const [navPref, setNavPref] = useState<boolean | null>(null);
  const navOpen = navPref ?? wide;
  const overlay = navOpen && !wide;

  useLayoutEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [collection, path]);

  const pickGroup = (p: string) => {
    onPath(p);
    if (overlay) setNavPref(null);
  };

  // Collapsed groups, by path. Kept across collections, so "color" stays shut in All and in Color.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const setOpen = (p: string, open: boolean) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (open) next.delete(p);
      else next.add(p);
      return next;
    });
  const parents = useMemo(() => [...byPath.values()].filter((n) => n.children.length).map((n) => n.path), [byPath]);
  const allCollapsed = parents.length > 0 && parents.every((p) => collapsed.has(p));

  const onActivePath = new Set<GroupNode>();
  for (let n: GroupNode | null = selected; n; n = n.parent) onActivePath.add(n);
  const shownInNav = (n: GroupNode) => !!counts.get(n) || onActivePath.has(n);
  const renderNode = (n: GroupNode): ReactNode => {
    const kids = n.children.filter(shownInNav);
    const open = !collapsed.has(n.path);
    return (
      <Fragment key={n.path}>
        <NavItem
          label={n.label}
          count={counts.get(n) ?? 0}
          depth={n.depth}
          active={n === selected}
          onClick={() => pickGroup(n.path)}
          open={open}
          onToggle={kids.length ? (o) => setOpen(n.path, o) : undefined}
        />
        {open && kids.map(renderNode)}
      </Fragment>
    );
  };

  const columns: Column[] = !themes.length
    ? [{ id: '', label: 'Value' }]
    : themes
        .filter((th) => view === 'all' || th.id === view)
        .map((th) => ({ id: th.id, label: th.label, active: th.active, title: `${th.label}: ${th.sources.join(', ')}` }));
  const cols = wide
    ? `minmax(140px, 1.2fr) repeat(${columns.length}, minmax(120px, 1fr)) 60px`
    : `minmax(112px, 1.2fr) repeat(${columns.length}, minmax(104px, 1fr))`;

  let budget = limit;
  const visible: typeof sections = [];
  for (const s of sections) {
    if (budget <= 0) break;
    visible.push({ node: s.node, rows: s.rows.slice(0, budget) });
    budget -= s.rows.length;
  }
  const total = counts.get(selected) ?? 0;
  const current = collections.find((c) => c.id === collection);
  const elsewhere = collections.filter((c) => c.id !== 'all' && c.id !== collection && c.count > 0);

  return (
    <div ref={boxRef} className={`tt${wide ? '' : ' is-narrow'}`}>
      {navOpen && (
        <nav className="tt-nav" aria-label="Token collections and groups" onKeyDown={(e) => e.key === 'Escape' && overlay && setNavPref(null)}>
          <div className="tt-nav-head">
            <span>Collections</span>
            <button className="icon-ghost" onClick={() => setNavPref(false)} title="Hide sidebar" aria-label="Hide sidebar" aria-expanded>
              {Icons.sidebar(15)}
            </button>
          </div>
          <div className="tt-nav-list">
            {collections.map((c) => (
              <NavItem key={c.id} label={c.label} count={c.count} active={c.id === collection} dim={!c.count} onClick={() => onCollection(c.id)} />
            ))}
          </div>
          <div className="tt-nav-title">
            Groups
            {parents.length > 0 && (
              <button
                className="icon-ghost"
                onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(parents))}
                title={allCollapsed ? 'Expand all groups' : 'Collapse all groups'}
                aria-label={allCollapsed ? 'Expand all groups' : 'Collapse all groups'}
              >
                {allCollapsed ? Icons.expandAll(14) : Icons.collapseAll(14)}
              </button>
            )}
          </div>
          <div className="tt-nav-list tt-nav-groups">
            <NavItem label="All" count={counts.get(root) ?? 0} active={selected === root} onClick={() => pickGroup('')} />
            {root.children.filter(shownInNav).map(renderNode)}
          </div>
        </nav>
      )}
      {overlay && <div className="tt-scrim" onClick={() => setNavPref(null)} />}

      <div className="tt-main" ref={mainRef}>
        <div className="tt-grid" role="table" style={{ '--tt-cols': cols } as CSSProperties}>
          <div className="tt-row tt-head" role="row">
            <div className="tt-cell" role="columnheader">
              {navOpen ? (
                'Name'
              ) : (
                // Sidebar hidden: the header says where you are and brings it back.
                <button className="tt-loc" onClick={() => setNavPref(true)} title="Show collections and groups" aria-expanded={false}>
                  {Icons.sidebar(15)}
                  <span className="tt-loc-text">
                    {current?.label}
                    {selected !== root && <span className="muted"> / {groupLabels(selected).join(' / ')}</span>}
                  </span>
                </button>
              )}
            </div>
            {columns.map((c) => (
              <div key={c.id} className="tt-cell" role="columnheader" title={c.title}>
                {c.label}
                {c.active && columns.length > 1 && <span className="tt-th-dot" title="Applied on the page now" />}
              </div>
            ))}
            {wide && (
              <div className="tt-cell tt-refs" role="columnheader" title="How many times var() references the token in readable stylesheets">
                Refs
              </div>
            )}
          </div>
          {visible.map(({ node, rows }) => (
            <Fragment key={node.path || '/'}>
              {node !== root && (
                <div className="tt-section" role="row">
                  <span role="rowheader">{groupPath(node)}</span>
                </div>
              )}
              {rows.map((t) => (
                <Row key={t.name} t={t} leaf={leaf.get(t.name)!} columns={columns} refs={wide} onFocusAlias={onFocusAlias} />
              ))}
            </Fragment>
          ))}
        </div>

        {total === 0 &&
          (selected !== root && counts.get(root) ? (
            <Empty title="No matches in this group">
              <button className="link" onClick={() => onPath('')}>
                Show all {counts.get(root)} in {current?.label}
              </button>
            </Empty>
          ) : (
            <Empty title={collection === 'all' ? 'No tokens match' : `No tokens match in ${current?.label}`}>
              {elsewhere.length > 0 && (
                <span className="tt-elsewhere">
                  Found in
                  {elsewhere.map((c) => (
                    <button key={c.id} className="link" onClick={() => onCollection(c.id)}>
                      {c.label} <span className="muted">{c.count}</span>
                    </button>
                  ))}
                </span>
              )}
            </Empty>
          ))}
        <div className="tt-more">
          <ShowMore shown={limit} total={total} onMore={onMore} />
        </div>
      </div>
    </div>
  );
}
