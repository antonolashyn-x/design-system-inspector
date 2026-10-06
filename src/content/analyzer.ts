import type {
  AnalysisResult,
  ColorEntry,
  ColorRole,
  CssToken,
  ShadowEntry,
  ShadowLayer,
  TokenRef,
  TypeTokenRef,
  TypographyEntry,
  TypoProperty,
} from '../shared/types';
import { colorFromTokenValue, parseColor, toHex, toRgbString } from './color';
import { addInlineToken, scanTokens, tokenWords, varRefs, type TypeRule, type TypeRuleProp } from './tokens';
import { OVERLAY_HOST_ID } from './highlight';
import { HANDLE_HOST_ID, PANEL_HOST_ID } from './panel';

const MAX_ELEMENTS = 20000;
const MAX_REGISTRY_PER_KEY = 3000;

const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'LINK', 'META', 'HEAD', 'TITLE', 'NOSCRIPT', 'TEMPLATE', 'BR', 'WBR', 'BASE', 'SOURCE', 'TRACK', 'PARAM',
]);
const SVG_SHAPES = new Set(['path', 'circle', 'rect', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'use']);

/** Elements per highlight key ("color:#FFFFFF", "type:…", "shadow:…") from the last scan. */
export const registry = new Map<string, Element[]>();

function register(key: string, el: Element) {
  let list = registry.get(key);
  if (!list) registry.set(key, (list = []));
  if (list.length < MAX_REGISTRY_PER_KEY && list[list.length - 1] !== el) list.push(el);
}

function isVisible(el: Element, cs: CSSStyleDeclaration): boolean {
  if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
  if (typeof el.checkVisibility === 'function') return el.checkVisibility();
  return el.getClientRects().length > 0;
}

function directText(el: Element): string {
  let text = '';
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? '';
  }
  return text.replace(/\s+/g, ' ').trim();
}

const unquote = (s: string) => s.trim().replace(/^["']|["']$/g, '');
const normalizeFamily = (s: string) =>
  s
    .split(',')
    .map((f) => unquote(f).toLowerCase())
    .filter(Boolean)
    .join(',');

/** Splits on top-level commas (ignores commas inside parentheses). */
function splitTopLevel(value: string, sep = ','): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (depth === 0 && (sep === ' ' ? /\s/.test(ch) : ch === sep)) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function parseShadow(value: string): ShadowLayer[] {
  return splitTopLevel(value).map((layer) => {
    const parts = splitTopLevel(layer, ' ');
    const lengths: string[] = [];
    let color = 'rgba(0, 0, 0, 1)';
    let inset = false;
    for (const p of parts) {
      if (p === 'inset') inset = true;
      else if (/^-?[\d.]/.test(p)) lengths.push(p);
      else color = p;
    }
    return { inset, x: lengths[0] ?? '0px', y: lengths[1] ?? '0px', blur: lengths[2] ?? '0px', spread: lengths[3] ?? '0px', color };
  });
}

// ---- Token matching --------------------------------------------------------

interface Probe {
  normalize(prop: string, value: string): string;
  /** Computed size / line-height / weight of a `font` shorthand value. */
  fontParts(value: string): { size: string; lineHeight: string; weight: string } | null;
  dispose(): void;
}

/** A hidden element used to let the browser normalize token values into computed form. */
function createProbe(): Probe {
  const el = document.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = 'position:absolute!important;visibility:hidden!important;pointer-events:none!important;left:-9999px;top:0;';
  (document.body ?? document.documentElement).appendChild(el);
  return {
    normalize(prop, value) {
      el.style.setProperty(prop, '');
      el.style.setProperty(prop, value);
      if (!el.style.getPropertyValue(prop)) return '';
      return getComputedStyle(el).getPropertyValue(prop).trim();
    },
    fontParts(value) {
      el.style.font = '';
      el.style.font = value;
      if (!el.style.font) return null;
      const cs = getComputedStyle(el);
      const out = { size: cs.fontSize, lineHeight: cs.lineHeight, weight: cs.fontWeight };
      el.style.font = '';
      return out;
    },
    dispose: () => el.remove(),
  };
}

/** `font` shorthand values such as "600 40px/48px Inter, sans-serif". */
function isFontShorthand(value: string): boolean {
  const v = value.trim();
  if (!v || v.includes('var(')) return false;
  const looksLike = /\d(?:px|rem|em|%)?\s*\/\s*[\d.]/.test(v) || /^(?:(?:italic|oblique|normal|bold|bolder|lighter|\d{3})\s+)*[\d.]+(?:px|rem|em|pt|%)\s+\S/.test(v);
  return looksLike && CSS.supports('font', v);
}

/** Hashed / generated class names (CSS modules, styled-components, …) say nothing about naming. */
function isGeneratedClass(c: string): boolean {
  return (
    /^(css|sc|jsx|svelte|astro|emotion|chakra|tw)-/.test(c) ||
    (/\d/.test(c) && /[_-][A-Za-z0-9]{5,}$/.test(c)) ||
    // styled-components hashes like "fkCphf": short, mixed case, (almost) no vowels.
    (/^[a-zA-Z]{5,8}$/.test(c) && /[a-z][A-Z]/.test(c) && (c.match(/[aeiou]/gi)?.length ?? 0) <= 1) ||
    c.length > 40
  );
}

const ref = (t: CssToken): TokenRef => ({ name: t.name, scope: t.scopes[0] ?? ':root' });

type TypoProp = TypoProperty;

function typographyProperty(t: CssToken): TypoProp | null {
  const n = tokenWords(t.name);
  const v = t.value;
  if (/family|font-(sans|serif|mono|body|heading|display|base|primary|secondary)$/.test(n) || (/,/.test(v) && /[a-z]/i.test(v)))
    return 'font-family';
  if (/line-height|leading/.test(n)) return 'line-height';
  if (/tracking|letter-spacing|letter/.test(n)) return 'letter-spacing';
  if (/weight/.test(n)) return 'font-weight';
  if (/size|text-|font-/.test(n) && /^[\d.]+(px|rem|em)$/.test(v)) return 'font-size';
  return null;
}

/** Converts a simple length token into px given font-size context. Returns null if not resolvable. */
function lengthToPx(value: string, fontSizePx: number, rootFontSizePx: number, unitlessIsEm: boolean): number | null {
  const m = /^(-?[\d.]+)(px|rem|em|%)?$/.exec(value.trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  switch (m[2]) {
    case 'px':
      return n;
    case 'rem':
      return n * rootFontSizePx;
    case 'em':
      return n * fontSizePx;
    case '%':
      return (n / 100) * fontSizePx;
    default:
      return unitlessIsEm ? n * fontSizePx : null;
  }
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.05;

// ---- Declared typography tokens ---------------------------------------------
// Value matching alone is ambiguous: 14px may equal six different tokens. Instead, find the rule
// that sets each property on the element (or the ancestor it inherits from) and read its var().

type DeclaredTokens = Map<TypographyEntry, Map<TypeRuleProp, Map<string, number>>>;

const COMPUTED_PROP: Record<Exclude<TypeRuleProp, 'font'>, keyof CSSStyleDeclaration> = {
  'font-family': 'fontFamily',
  'font-size': 'fontSize',
  'font-weight': 'fontWeight',
  'line-height': 'lineHeight',
  'letter-spacing': 'letterSpacing',
};
const LONGHANDS = Object.keys(COMPUTED_PROP) as Exclude<TypeRuleProp, 'font'>[];
const MAX_DEPTH = 40;

function findDeclaredTypeTokens(typeRules: TypeRule[], textEls: [TypographyEntry, Element][], rootFs: number): DeclaredTokens {
  // Rules per element, latest in source order first (a stand-in for the cascade; values are verified below).
  const rulesOn = new Map<Element, TypeRule[]>();
  for (const rule of typeRules) {
    if (rule.media && !matchMedia(rule.media).matches) continue;
    let matched: NodeListOf<Element>;
    try {
      matched = document.querySelectorAll(rule.selector);
    } catch {
      continue; // nested "&…" selectors, unsupported pseudo-elements
    }
    for (const el of Array.from(matched)) {
      const list = rulesOn.get(el);
      if (list) list.unshift(rule);
      else rulesOn.set(el, [rule]);
    }
  }

  const csCache = new Map<Element, CSSStyleDeclaration>();
  const cs = (el: Element) => {
    let s = csCache.get(el);
    if (!s) csCache.set(el, (s = getComputedStyle(el)));
    return s;
  };

  /** var() names set for `prop` directly on `node`: inline style first, then matching rules. */
  const varsOn = (node: Element, prop: TypeRuleProp) => {
    const out: string[] = [];
    const inline = (node as HTMLElement).style;
    if (inline) out.push(...varRefs(inline.getPropertyValue(prop)), ...(prop === 'font' ? [] : varRefs(inline.getPropertyValue('font'))));
    for (const r of rulesOn.get(node) ?? []) out.push(...(r.props[prop] ?? []), ...(prop === 'font' ? [] : r.props.font ?? []));
    return out;
  };

  /** Does the custom property's value, as resolved on `el`, produce the element's computed value? */
  const matches = (el: Element, name: string, prop: Exclude<TypeRuleProp, 'font'>) => {
    const value = cs(el).getPropertyValue(name).trim();
    if (!value) return false;
    const s = cs(el);
    const actual = String(s[COMPUTED_PROP[prop]]);
    const parentFs = el.parentElement ? parseFloat(cs(el.parentElement).fontSize) : rootFs;
    if (prop === 'font-family') return normalizeFamily(value) === normalizeFamily(actual);
    if (prop === 'font-weight') return value === actual || (value === 'bold' && actual === '700') || (value === 'normal' && actual === '400');
    const px =
      prop === 'font-size'
        ? lengthToPx(value, parentFs, rootFs, false)
        : lengthToPx(value, parseFloat(s.fontSize), rootFs, prop === 'line-height');
    return px !== null && near(px, prop === 'letter-spacing' && actual === 'normal' ? 0 : parseFloat(actual));
  };

  /** A `font` shorthand token matches when the element's size, line height and weight all follow from it. */
  const matchesShorthand = (el: Element, name: string) => {
    const value = cs(el).getPropertyValue(name).trim();
    if (!value || !CSS.supports('font', value)) return false;
    return LONGHANDS.every((p) => p === 'letter-spacing' || p === 'font-family' || matches(el, name, p) || shorthandPart(el, value, p));
  };
  const probeEl = document.createElement('span');
  const shorthandPart = (el: Element, value: string, prop: Exclude<TypeRuleProp, 'font'>) => {
    probeEl.style.font = value;
    const want = probeEl.style.getPropertyValue(prop);
    if (!want) return false;
    if (prop === 'font-weight') return want === String(cs(el).fontWeight) || (want === 'normal' && cs(el).fontWeight === '400') || (want === 'bold' && cs(el).fontWeight === '700');
    if (prop === 'line-height' && want === 'normal') return cs(el).lineHeight === 'normal';
    const fs = prop === 'font-size' ? (el.parentElement ? parseFloat(cs(el.parentElement).fontSize) : rootFs) : parseFloat(cs(el).fontSize);
    const px = lengthToPx(want, fs, rootFs, prop === 'line-height');
    return px !== null && near(px, parseFloat(String(cs(el)[COMPUTED_PROP[prop]])));
  };

  /** Walks from the element up through the ancestors it inherits `prop` from. */
  const declaredFor = (el: Element, prop: TypeRuleProp): string | null => {
    let node: Element | null = el;
    for (let depth = 0; node && depth < MAX_DEPTH; depth++, node = node.parentElement) {
      const vars = varsOn(node, prop);
      const hit = vars.find((n) => (prop === 'font' ? matchesShorthand(node!, n) : matches(node!, n, prop)));
      if (hit) return hit;
      // This node sets the property itself (e.g. via a `font` shorthand token), so don't credit an ancestor.
      if (vars.length) return null;
      const parent: Element | null = node.parentElement;
      if (!parent) return null;
      // Inherited only while the value is unchanged; a different value means this node set it without a token.
      if (prop === 'font') {
        if (LONGHANDS.some((p) => cs(node!)[COMPUTED_PROP[p]] !== cs(parent)[COMPUTED_PROP[p]])) return null;
      } else if (cs(node)[COMPUTED_PROP[prop]] !== cs(parent)[COMPUTED_PROP[prop]]) return null;
    }
    return null;
  };

  const out: DeclaredTokens = new Map();
  if (!typeRules.length && !textEls.some(([, el]) => (el as HTMLElement).style?.cssText.includes('var('))) return out;
  for (const [entry, el] of textEls) {
    let byProp = out.get(entry);
    if (!byProp) out.set(entry, (byProp = new Map()));
    for (const prop of ['font', ...LONGHANDS] as TypeRuleProp[]) {
      const name = declaredFor(el, prop);
      if (!name) continue;
      let counts = byProp.get(prop);
      if (!counts) byProp.set(prop, (counts = new Map()));
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return out;
}

// ---- Main ------------------------------------------------------------------

export function analyzePage(): AnalysisResult {
  const started = performance.now();
  registry.clear();

  const { tokens, typeRules, themes, stylesheets } = scanTokens();
  const seenTokenNames = new Set(tokens.map((t) => t.name));

  const colors = new Map<string, ColorEntry>();
  const typo = new Map<string, TypographyEntry>();
  const shadows = new Map<string, ShadowEntry>();
  const fonts = new Map<string, number>();

  const addColor = (raw: string, role: ColorRole, el: Element) => {
    const rgba = parseColor(raw);
    if (!rgba || rgba.a === 0) return;
    const hex = toHex(rgba);
    let entry = colors.get(hex);
    if (!entry) {
      entry = { key: `color:${hex}`, hex, rgb: toRgbString(rgba), alpha: rgba.a, count: 0, roles: {}, tokens: [] };
      colors.set(hex, entry);
    }
    entry.count++;
    entry.roles[role] = (entry.roles[role] ?? 0) + 1;
    register(entry.key, el);
  };

  // Class names per text style, e.g. ".h2", ".text-lg" — often the site's own style names.
  const classCounts = new Map<string, Map<string, number>>();
  const countClasses = (key: string, el: Element) => {
    if (!el.classList.length) return;
    let m = classCounts.get(key);
    if (!m) classCounts.set(key, (m = new Map()));
    for (const c of Array.from(el.classList).slice(0, 6)) if (!isGeneratedClass(c)) m.set(c, (m.get(c) ?? 0) + 1);
  };

  const textEls: [TypographyEntry, Element][] = [];

  const all = document.body ? document.body.querySelectorAll('*') : document.querySelectorAll('*');
  const elementsTotal = all.length + 1;
  const elements: Element[] = document.body ? [document.body] : [];
  for (let i = 0; i < all.length && elements.length < MAX_ELEMENTS; i++) elements.push(all[i]);

  let scanned = 0;
  for (const el of elements) {
    if (SKIP_TAGS.has(el.tagName) || el.id === OVERLAY_HOST_ID || el.id === PANEL_HOST_ID || el.id === HANDLE_HOST_ID) continue;
    const cs = getComputedStyle(el);
    if (!isVisible(el, cs)) continue;
    scanned++;

    if (el.hasAttribute('style') && el.getAttribute('style')!.includes('--')) addInlineToken(tokens, seenTokenNames, el);

    const isSvg = el instanceof SVGElement;
    const text = isSvg && el.tagName !== 'text' ? '' : directText(el);

    // Colors
    if (text) addColor(cs.color, 'text', el);
    addColor(cs.backgroundColor, 'background', el);

    const sides = ['Top', 'Right', 'Bottom', 'Left'] as const;
    const borderColors = new Set<string>();
    for (const s of sides) {
      const w = parseFloat(cs.getPropertyValue(`border-${s.toLowerCase()}-width`));
      const style = cs.getPropertyValue(`border-${s.toLowerCase()}-style`);
      if (w > 0 && style !== 'none' && style !== 'hidden') borderColors.add(cs.getPropertyValue(`border-${s.toLowerCase()}-color`));
    }
    for (const c of borderColors) addColor(c, 'border', el);

    if (isSvg && SVG_SHAPES.has(el.tagName.toLowerCase())) {
      if (cs.fill && !cs.fill.startsWith('url')) addColor(cs.fill, 'fill', el);
      if (cs.stroke && cs.stroke !== 'none' && !cs.stroke.startsWith('url') && parseFloat(cs.strokeWidth) > 0)
        addColor(cs.stroke, 'stroke', el);
    }

    // Typography (only for elements that actually render their own text)
    if (text) {
      const primaryFamily = unquote(cs.fontFamily.split(',')[0] ?? '');
      const key = `type:${cs.fontFamily}|${cs.fontSize}|${cs.fontWeight}|${cs.lineHeight}|${cs.letterSpacing}|${cs.textTransform}`;
      let entry = typo.get(key);
      if (!entry) {
        entry = {
          key,
          fontFamily: cs.fontFamily,
          primaryFamily,
          fontSize: cs.fontSize,
          fontSizePx: parseFloat(cs.fontSize),
          fontWeight: cs.fontWeight,
          lineHeight: cs.lineHeight,
          letterSpacing: cs.letterSpacing,
          textTransform: cs.textTransform,
          count: 0,
          tags: {},
          sample: text.slice(0, 80),
          tokens: [],
          styleTokens: [],
          classes: [],
        };
        typo.set(key, entry);
      }
      entry.count++;
      const tag = el.tagName.toLowerCase();
      entry.tags[tag] = (entry.tags[tag] ?? 0) + 1;
      if (entry.sample.length < 12 && text.length > entry.sample.length) entry.sample = text.slice(0, 80);
      fonts.set(primaryFamily, (fonts.get(primaryFamily) ?? 0) + 1);
      register(key, el);
      countClasses(key, el);
      textEls.push([entry, el]);
      register(`ff:${cs.fontFamily}`, el);
      register(`fs:${cs.fontSize}`, el);
      register(`fw:${cs.fontWeight}`, el);
    }

    // Shadows
    if (cs.boxShadow && cs.boxShadow !== 'none') {
      const key = `shadow:${cs.boxShadow}`;
      let entry = shadows.get(key);
      if (!entry) {
        entry = { key, value: cs.boxShadow, layers: parseShadow(cs.boxShadow), count: 0, tokens: [] };
        shadows.set(key, entry);
      }
      entry.count++;
      register(key, el);
    }
  }

  // ---- Link detected values back to CSS custom properties (by resolved value) ----
  const probe = createProbe();
  try {
    const rootFs = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const colorTokens = new Map<string, TokenRef[]>();
    const shadowTokens = new Map<string, TokenRef[]>();
    const typoTokens: { prop: TypoProp; token: CssToken; normalized: string }[] = [];

    // Most-referenced tokens first, so the badge shown first is the one the site actually uses most.
    const ranked = [...tokens].sort((a, b) => b.references - a.references);
    const styleTokens = new Map<string, TokenRef[]>(); // "size|line-height|weight" -> font shorthand tokens
    for (const t of ranked) {
      if (t.group !== 'color' && t.group !== 'shadow' && isFontShorthand(t.value)) {
        const parts = probe.fontParts(t.value);
        if (parts) {
          const k = `${parts.size}|${parts.lineHeight}|${parts.weight}`;
          if (!styleTokens.has(k)) styleTokens.set(k, []);
          styleTokens.get(k)!.push(ref(t));
          t.group = 'typography';
          t.fontShorthand = true;
          continue;
        }
      }
      if (t.group === 'color') {
        const c = t.previewColor ?? colorFromTokenValue(t.value);
        const rgba = c ? parseColor(c) ?? parseColor(probe.normalize('color', c)) : null;
        if (rgba) {
          const hex = toHex(rgba);
          if (!colorTokens.has(hex)) colorTokens.set(hex, []);
          colorTokens.get(hex)!.push(ref(t));
        }
      } else if (t.group === 'shadow') {
        const norm = probe.normalize('box-shadow', t.value);
        if (norm && norm !== 'none') {
          if (!shadowTokens.has(norm)) shadowTokens.set(norm, []);
          shadowTokens.get(norm)!.push(ref(t));
        }
      } else if (t.group === 'typography') {
        const prop = typographyProperty(t);
        if (!prop) continue;
        const normalized = prop === 'font-family' ? normalizeFamily(t.value) : prop === 'font-weight' ? probe.normalize('font-weight', t.value) : t.value;
        if (!normalized) continue;
        typoTokens.push({ prop, token: t, normalized });
        t.typeProperty = prop;
        if (prop === 'font-weight') t.resolved = normalized;
        else if (prop === 'font-size') {
          const px = lengthToPx(normalized, rootFs, rootFs, false);
          if (px !== null) t.resolved = `${Math.round(px * 100) / 100}px`;
        }
      }
    }

    for (const c of colors.values()) c.tokens = colorTokens.get(c.hex) ?? [];
    for (const s of shadows.values()) s.tokens = shadowTokens.get(s.value) ?? [];

    // Which tokens the CSS actually applies, per element (falls back to value matching below).
    const declared = findDeclaredTypeTokens(typeRules, textEls, rootFs);
    const tokenByName = new Map(tokens.map((t) => [t.name, t]));
    const declaredRef = (name: string): TypeTokenRef => {
      const t = tokenByName.get(name);
      return { name, scope: t?.scopes[0] ?? ':root', declared: true };
    };
    const byUse = (m: Map<string, number> | undefined) => [...(m ?? [])].sort((a, b) => b[1] - a[1]).map(([n]) => n);

    for (const e of typo.values()) {
      const d = declared.get(e);
      const composite = byUse(d?.get('font'));
      e.styleTokens = composite.length
        ? composite.map(declaredRef)
        : (styleTokens.get(`${e.fontSize}|${e.lineHeight}|${e.fontWeight}`) ?? []).map((t) => ({ ...t, declared: false }));
      e.classes = [...(classCounts.get(e.key) ?? [])]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 3);
      const fam = normalizeFamily(e.fontFamily);
      const firstFam = fam.split(',')[0];
      const fs = e.fontSizePx;
      const lh = parseFloat(e.lineHeight);
      const ls = e.letterSpacing === 'normal' ? 0 : parseFloat(e.letterSpacing);
      const props: TypoProp[] = ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing'];
      const withDeclared = new Set<TypoProp>();
      for (const prop of props) {
        const names = byUse(d?.get(prop));
        if (!names.length) continue;
        withDeclared.add(prop);
        for (const n of names) e.tokens.push({ property: prop, token: declaredRef(n) });
      }
      for (const { prop, token, normalized } of typoTokens) {
        if (withDeclared.has(prop)) continue;
        let hit = false;
        if (prop === 'font-family') hit = normalized === fam || normalized.split(',')[0] === firstFam;
        else if (prop === 'font-weight') hit = normalized === e.fontWeight;
        else if (prop === 'font-size') {
          const px = lengthToPx(normalized, rootFs, rootFs, false);
          hit = px !== null && near(px, fs);
        } else if (prop === 'line-height' && !Number.isNaN(lh)) {
          const px = lengthToPx(normalized, fs, rootFs, true);
          hit = px !== null && near(px, lh);
        } else if (prop === 'letter-spacing' && ls !== 0) {
          const px = lengthToPx(normalized, fs, rootFs, false);
          hit = px !== null && near(px, ls);
        }
        if (hit) e.tokens.push({ property: prop, token: { ...ref(token), declared: false } });
      }
    }
  } finally {
    probe.dispose();
  }

  const byCount = <T extends { count: number }>(a: T, b: T) => b.count - a.count;

  return {
    url: location.href,
    title: document.title,
    analyzedAt: Date.now(),
    durationMs: Math.round(performance.now() - started),
    elementsScanned: scanned,
    elementsTotal,
    truncated: elementsTotal > MAX_ELEMENTS,
    stylesheets,
    colors: [...colors.values()].sort(byCount),
    typography: [...typo.values()].sort(byCount),
    fonts: [...fonts.entries()].map(([family, count]) => ({ family, count })).sort(byCount),
    tokens,
    themes,
    shadows: [...shadows.values()].sort(byCount),
  };
}
