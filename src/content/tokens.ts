import type { CssToken, ThemeInfo, ThemeValue, TokenGroup } from '../shared/types';
import { colorFromTokenValue } from './color';
import { BASE, selectorIsActive, sortThemes, substituteVars, themeLabel, themeOfDeclaration } from './themes';

interface Declaration {
  name: string;
  raw: string;
  scope: string;
  /** Enclosing @media condition(s), if any. */
  media: string | null;
}

/** A style rule that sets a typography property through `var()`, e.g. `.link { font-size: var(--body-sm) }`. */
export interface TypeRule {
  selector: string;
  media: string | null;
  /** Property → custom properties referenced in its value, in source order. `font` is the shorthand. */
  props: Partial<Record<TypeRuleProp, string[]>>;
}

export type TypeRuleProp = 'font' | 'font-family' | 'font-size' | 'font-weight' | 'line-height' | 'letter-spacing';
const TYPE_RULE_PROPS: TypeRuleProp[] = ['font', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing'];

/** Custom properties referenced by a declared value, e.g. "calc(var(--a) * 2)" → ["--a"]. */
export const varRefs = (value: string) => [...value.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]);

export interface TokenScan {
  tokens: CssToken[];
  /** Rules that set typography through tokens, in cascade (source) order. */
  typeRules: TypeRule[];
  themes: ThemeInfo[];
  stylesheets: { total: number; readable: number; blocked: number };
}

const isRootScope = (scope: string) => scope.split(',').some((s) => /^(:root|html|:host|body|\*)$/i.test(s.trim()));
const VAR_REF_RE = /var\(\s*(--[\w-]+)/g;
const ALIAS_RE = /^var\(\s*(--[\w-]+)\s*(?:,.*)?\)$/;

/** Walks every readable stylesheet (incl. @media/@supports/@layer/@import and nested rules). */
function collectFromStylesheets(decls: Declaration[], refs: Map<string, number>, typeRules: TypeRule[]) {
  const stats = { total: 0, readable: 0, blocked: 0 };
  const seenSheets = new Set<CSSStyleSheet>();

  const walkRules = (rules: CSSRuleList, media: string | null = null) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule) {
        const style = rule.style;
        for (let i = 0; i < style.length; i++) {
          const prop = style[i];
          if (prop.startsWith('--')) {
            decls.push({ name: prop, raw: style.getPropertyValue(prop).trim(), scope: rule.selectorText, media });
          }
        }
        const text = style.cssText;
        if (text.includes('var(--')) {
          for (const m of text.matchAll(VAR_REF_RE)) refs.set(m[1], (refs.get(m[1]) ?? 0) + 1);
          const props: TypeRule['props'] = {};
          for (const p of TYPE_RULE_PROPS) {
            const vars = varRefs(style.getPropertyValue(p));
            if (vars.length) props[p] = vars;
          }
          if (Object.keys(props).length) typeRules.push({ selector: rule.selectorText, media, props });
        }
        // CSS nesting: style rules can contain child rules.
        if (rule.cssRules?.length) walkRules(rule.cssRules, media);
      } else if (rule instanceof CSSImportRule) {
        if (rule.styleSheet) walkSheet(rule.styleSheet);
      } else if (rule instanceof CSSMediaRule) {
        const cond = rule.conditionText || rule.media.mediaText;
        walkRules(rule.cssRules, media ? `${media} and ${cond}` : cond);
      } else if ('cssRules' in rule && (rule as CSSGroupingRule).cssRules) {
        walkRules((rule as CSSGroupingRule).cssRules, media);
      }
    }
  };

  const walkSheet = (sheet: CSSStyleSheet) => {
    if (seenSheets.has(sheet)) return;
    seenSheets.add(sheet);
    stats.total++;
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      stats.blocked++; // cross-origin stylesheet without CORS headers
      return;
    }
    stats.readable++;
    walkRules(rules);
  };

  for (const sheet of Array.from(document.styleSheets)) walkSheet(sheet);
  for (const sheet of document.adoptedStyleSheets ?? []) walkSheet(sheet);
  return stats;
}

/** Custom properties visible in computed style — works even for blocked stylesheets. */
function collectComputed(el: Element): Map<string, string> {
  const out = new Map<string, string>();
  const cs = getComputedStyle(el);
  for (let i = 0; i < cs.length; i++) {
    const prop = cs[i];
    if (prop.startsWith('--')) out.set(prop, cs.getPropertyValue(prop).trim());
  }
  return out;
}

function resolveOnScope(name: string, scope: string): string | null {
  // Strip pseudo-classes/elements so "a:hover" or ".btn::before" can still be matched.
  const selector = scope.split(',')[0].replace(/::?[\w-]+(\([^)]*\))?/g, '').trim();
  if (!selector) return null;
  try {
    const el = document.querySelector(selector);
    if (!el) return null;
    const v = getComputedStyle(el).getPropertyValue(name).trim();
    return v || null;
  } catch {
    return null;
  }
}

// ---- Classification --------------------------------------------------------

const LENGTH_RE = /^-?[\d.]+(px|rem|em|%|vh|vw|vmin|vmax|ch|ex|pt|svh|dvh|lvh|cqw|cqh)$/;
const TIME_RE = /^-?[\d.]+m?s$/;

export function classifyToken(name: string, value: string): { group: TokenGroup; previewColor?: string } {
  const n = name.toLowerCase();
  const v = value.trim();

  if (/shadow|elevation/.test(n)) return { group: 'shadow' };

  const color = colorFromTokenValue(v);
  if (color) return { group: 'color', previewColor: color };

  if (/radius|rounded|corner/.test(n)) return { group: 'radius' };
  if (/(^--z-|z-?index|zindex|-layer)/.test(n)) return { group: 'z-index' };
  if (/duration|easing|ease|transition|animation|motion|delay|timing/.test(n) || TIME_RE.test(v) || /cubic-bezier|steps\(/.test(v))
    return { group: 'motion' };
  if (/breakpoint|screen|(^|-)bp(-|$)|media/.test(n)) return { group: 'breakpoint' };
  if (/font|typo|line-height|leading|tracking|letter-spacing|weight|family|(^|-)text-(xs|sm|base|md|lg|xl|\d)|heading|body-size|display/.test(n))
    return { group: 'typography' };
  if (/space|spacing|gap|padding|margin|inset|gutter|offset/.test(n)) return { group: 'spacing' };
  if (/size|width|height|container|max-|min-|(^|-)w-|(^|-)h-/.test(n)) return { group: 'size' };
  if (/color|colour|bg|background|border|fill|stroke|surface|foreground/.test(n) && v.startsWith('var(')) return { group: 'color' };

  // Value-only fallbacks
  if (/\d(px|rem|em)?\s+-?\d.*(rgba?|hsla?|#|oklch)/.test(v) || /(rgba?|hsla?|#)[^,]*\s+-?\d+px\s+-?\d+px/.test(v)) return { group: 'shadow' };
  if (/,/.test(v) && /(sans|serif|mono|system-ui|-apple-system|"|')/.test(v)) return { group: 'typography' };
  if (LENGTH_RE.test(v)) return { group: 'spacing' };
  return { group: 'other' };
}

export function scanTokens(): TokenScan {
  const decls: Declaration[] = [];
  const refs = new Map<string, number>();
  const typeRules: TypeRule[] = [];
  const stylesheets = collectFromStylesheets(decls, refs, typeRules);

  const rootComputed = collectComputed(document.documentElement);
  const bodyComputed = document.body ? collectComputed(document.body) : new Map<string, string>();

  const map = new Map<string, CssToken>();
  const upsert = (name: string, init: () => Omit<CssToken, 'group' | 'previewColor'>) => {
    let t = map.get(name);
    if (!t) {
      t = { ...init(), group: 'other' };
      map.set(name, t);
    }
    return t;
  };

  const hasRootRaw = new Set<string>();
  for (const d of decls) {
    const t = upsert(d.name, () => ({
      name: d.name,
      rawValue: d.raw,
      value: '',
      scopes: [],
      references: 0,
      source: 'stylesheet',
    }));
    if (!t.scopes.includes(d.scope)) t.scopes.push(d.scope);
    // Prefer the root-level declaration as the canonical raw value (others are usually theme overrides).
    if (isRootScope(d.scope) && !hasRootRaw.has(d.name)) {
      t.rawValue = d.raw;
      hasRootRaw.add(d.name);
    }
  }
  for (const t of map.values()) t.scopes.sort((a, b) => Number(isRootScope(b)) - Number(isRootScope(a)));

  // Tokens only visible via computed style (blocked stylesheets, inline style on <html>, JS-set vars).
  for (const [name, value] of [...bodyComputed, ...rootComputed]) {
    if (!map.has(name)) {
      map.set(name, {
        name,
        rawValue: '',
        value,
        scopes: [rootComputed.has(name) ? ':root' : 'body'],
        references: 0,
        source: 'computed',
        group: 'other',
      });
    }
  }

  for (const t of map.values()) {
    t.references = refs.get(t.name) ?? 0;
    if (!t.value) {
      t.value =
        rootComputed.get(t.name) ??
        bodyComputed.get(t.name) ??
        (t.scopes.length ? resolveOnScope(t.name, t.scopes[0]) : null) ??
        t.rawValue;
    }
    const alias = ALIAS_RE.exec(t.rawValue);
    if (alias) t.aliasOf = alias[1];
    const { group, previewColor } = classifyToken(t.name, t.value || t.rawValue);
    t.group = group;
    if (previewColor) t.previewColor = previewColor;
  }

  const themes = applyThemes(decls, map, rootComputed);
  const tokens = [...map.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return { tokens, typeRules, themes, stylesheets };
}

/**
 * Groups declarations by theme (light/dark/…), resolves every themed token's value
 * per theme, and returns the detected themes. Mutates tokens in `map`.
 */
function applyThemes(decls: Declaration[], map: Map<string, CssToken>, rootComputed: Map<string, string>): ThemeInfo[] {
  const raw = new Map<string, Map<string, string>>(); // theme -> token -> raw value (later declarations win)
  const declaredIn = new Map<string, Set<string>>(); // token -> non-base themes it's declared in
  const sources = new Map<string, Set<string>>();
  const active = new Set<string>();
  const defaultVotes = new Map<string, number>();
  const activeCache = new Map<string, boolean>();

  const put = (theme: string, name: string, value: string) => {
    if (!raw.has(theme)) raw.set(theme, new Map());
    raw.get(theme)!.set(name, value);
  };

  for (const d of decls) {
    const dt = themeOfDeclaration(d.scope, d.media);
    if (!dt) continue;
    for (const theme of dt.themes) {
      put(theme, d.name, d.raw);
      if (theme === BASE) continue;
      if (!declaredIn.has(d.name)) declaredIn.set(d.name, new Set());
      declaredIn.get(d.name)!.add(theme);
      const where = d.media ? `@media ${d.media} { ${d.scope} }` : d.scope;
      if (!sources.has(theme)) sources.set(theme, new Set());
      sources.get(theme)!.add(where);
      if (!activeCache.has(where)) activeCache.set(where, selectorIsActive(d.scope, d.media));
      if (activeCache.get(where)) active.add(theme);
    }
    if (dt.alsoRoot) {
      put(BASE, d.name, d.raw);
      for (const theme of dt.themes) defaultVotes.set(theme, (defaultVotes.get(theme) ?? 0) + 1);
    }
  }

  const ids = [...sources.keys()];
  if (!ids.length) return [];

  // The default theme is the one declared together with :root; otherwise plain :root is the
  // counterpart of the detected theme(s) (":root + .dark" means the default is light).
  let defaultId = [...defaultVotes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!defaultId) {
    defaultId = ids.includes('dark') && !ids.includes('light') ? 'light' : ids.includes('light') && !ids.includes('dark') ? 'dark' : 'default';
    if (raw.get(BASE)?.size) {
      ids.push(defaultId);
      sources.set(defaultId, new Set([':root']));
    }
  }
  const order = sortThemes(ids, defaultId);
  if (![...active].some((id) => id !== defaultId)) active.add(defaultId);

  const lookupFor = (theme: string) => (name: string) => raw.get(theme)?.get(name) ?? raw.get(BASE)?.get(name) ?? rootComputed.get(name);
  const counts = new Map<string, number>();

  for (const [name, themesDeclared] of declaredIn) {
    const t = map.get(name);
    if (!t) continue;
    const values: Record<string, ThemeValue> = {};
    for (const theme of order) {
      const explicit = raw.get(theme)?.get(name);
      const rawValue = explicit ?? raw.get(BASE)?.get(name);
      if (rawValue === undefined) continue;
      const value = substituteVars(rawValue, lookupFor(theme));
      const previewColor = colorFromTokenValue(value);
      const inherited = explicit === undefined && theme !== defaultId && !themesDeclared.has(theme);
      values[theme] = { raw: rawValue, value, ...(previewColor ? { previewColor } : {}), ...(inherited ? { inherited } : {}) };
    }
    // Same value everywhere → not really theme-dependent.
    if (new Set(Object.values(values).map((v) => v.value)).size < 2) continue;
    t.themeValues = values;
    const activeId = order.find((id) => active.has(id) && values[id]);
    if (activeId) t.rawValue = values[activeId].raw;
    if (t.group === 'other' || !t.previewColor) {
      const first = Object.values(values).find((v) => v.previewColor);
      if (first && t.group !== 'shadow') {
        t.group = 'color';
        t.previewColor ??= first.previewColor;
      }
    }
    for (const [id, v] of Object.entries(values)) if (!v.inherited) counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const themed = order.filter((id) => counts.get(id));
  if (themed.length < 2) {
    for (const t of map.values()) delete t.themeValues;
    return [];
  }
  return themed.map((id) => ({
    id,
    label: themeLabel(id),
    isDefault: id === defaultId,
    active: active.has(id),
    sources: [...(sources.get(id) ?? [])].slice(0, 6),
    tokenCount: counts.get(id) ?? 0,
  }));
}

/** Adds tokens declared through inline `style="--x: …"` attributes on arbitrary elements. */
export function addInlineToken(tokens: CssToken[], seen: Set<string>, el: Element) {
  const style = (el as HTMLElement).style;
  if (!style) return;
  for (let i = 0; i < style.length; i++) {
    const prop = style[i];
    if (!prop.startsWith('--') || seen.has(prop)) continue;
    seen.add(prop);
    const raw = style.getPropertyValue(prop).trim();
    const value = getComputedStyle(el).getPropertyValue(prop).trim() || raw;
    const scope = el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + (el.classList[0] ? `.${el.classList[0]}` : '');
    const { group, previewColor } = classifyToken(prop, value);
    const alias = ALIAS_RE.exec(raw);
    tokens.push({
      name: prop,
      rawValue: raw,
      value,
      scopes: [`${scope} (inline)`],
      references: 0,
      source: 'inline',
      group,
      ...(previewColor ? { previewColor } : {}),
      ...(alias ? { aliasOf: alias[1] } : {}),
    });
  }
}
