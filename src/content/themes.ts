// Theme detection for CSS custom properties.
//
// Sites declare theme overrides in a handful of conventional ways:
//   :root, [data-bs-theme="light"] { … }        Bootstrap
//   [data-theme="dark"] { … }  /  .dark { … }    Tailwind/shadcn, Radix, most design systems
//   [data-color-mode=dark][data-dark-theme=dark_dimmed] { … }   GitHub Primer
//   @media (prefers-color-scheme: dark) { :root { … } }
// A declaration is "theme-level" when its selector is only a theme marker,
// optionally on :root/html/body. Anything else (".btn", "[data-theme=dark] .card")
// is component-scoped and is not treated as a theme.

const THEME_ATTR = /\[\s*(data-[\w-]*(?:theme|mode|scheme|appearance)[\w-]*)\s*[~|^$*]?=\s*(["']?)([^"'\]\s]+)\2\s*(?:[is]\s*)?\]/gi;
const THEME_CLASS = /\.(?:theme[-_])?(dark|light|dim|dimmed|night|day|high-contrast|contrast)(?:[-_](?:theme|mode))?(?![\w-])/gi;
const SCHEME_MEDIA = /prefers-color-scheme\s*:\s*(dark|light)/i;
const ROOTISH = /:root|:host(\([^)]*\))?|\bhtml\b|\bbody\b|\*/gi;

export const BASE = ''; // plain :root declarations (no theme)

const normalize = (t: string) => t.toLowerCase().replace(/_/g, '-');

/** Splits a selector list on top-level commas (ignores commas inside :is()/:where()). */
export function splitSelectors(selector: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of selector) {
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Theme id for one selector, BASE for :root-like, or null for component selectors. */
function themeOfSelector(part: string, mediaTheme: string | null): string | null {
  let theme: string | null = null;
  let fallback: string | null = null;
  for (const m of part.matchAll(THEME_ATTR)) {
    const value = normalize(m[3]);
    if (value === 'auto' || value === 'system') continue;
    if (/theme/i.test(m[1])) theme = value; // e.g. data-dark-theme=dark_dimmed beats data-color-mode=dark
    else fallback ??= value;
  }
  theme ??= fallback;
  if (!theme) {
    const c = [...part.matchAll(THEME_CLASS)][0];
    if (c) theme = normalize(c[1]);
  }
  const rest = part
    .replace(THEME_ATTR, '')
    .replace(THEME_CLASS, '')
    .replace(ROOTISH, '')
    .replace(/:(where|is)\(\s*\)/g, '')
    .replace(/[\s>+~]/g, '');
  if (rest !== '') return null;
  return theme ?? mediaTheme ?? BASE;
}

export interface DeclTheme {
  /** Theme ids this declaration belongs to (BASE for plain :root). */
  themes: string[];
  /** Also applies to :root unconditionally (e.g. `:root, [data-bs-theme=light]`). */
  alsoRoot: boolean;
}

export function themeOfDeclaration(selector: string, media: string | null): DeclTheme | null {
  const mediaTheme = media ? (SCHEME_MEDIA.exec(media)?.[1].toLowerCase() ?? null) : null;
  const parts = splitSelectors(selector).map((p) => themeOfSelector(p, mediaTheme));
  if (parts.every((p) => p === null)) return null;
  const themes = [...new Set(parts.filter((p): p is string => p !== null && p !== BASE))];
  const alsoRoot = parts.includes(BASE);
  if (!themes.length) return { themes: [BASE], alsoRoot: false };
  return { themes, alsoRoot };
}

/** Whether a theme selector currently applies to the page. */
export function selectorIsActive(selector: string, media: string | null): boolean {
  if (media) {
    try {
      if (!matchMedia(media).matches) return false;
    } catch {
      return false;
    }
  }
  return splitSelectors(selector).some((part) => {
    if (themeOfSelector(part, null) === BASE) return false; // plain :root isn't evidence of a theme
    const s = part.replace(/::?[\w-]+(\([^)]*\))?$/g, '');
    try {
      return document.documentElement.matches(s) || (!!document.body && document.body.matches(s));
    } catch {
      return false;
    }
  }) || (!!media && SCHEME_MEDIA.test(media));
}

/** Replaces var(--x, fallback) references using `lookup`, recursively. */
export function substituteVars(raw: string, lookup: (name: string) => string | undefined, depth = 0): string {
  if (depth > 12 || !raw.includes('var(')) return raw;
  let out = '';
  let i = 0;
  while (i < raw.length) {
    const start = raw.indexOf('var(', i);
    if (start < 0) {
      out += raw.slice(i);
      break;
    }
    out += raw.slice(i, start);
    let level = 0;
    let end = start + 3;
    for (; end < raw.length; end++) {
      if (raw[end] === '(') level++;
      else if (raw[end] === ')' && --level === 0) break;
    }
    const inner = raw.slice(start + 4, end);
    let comma = -1;
    for (let k = 0, d = 0; k < inner.length; k++) {
      if (inner[k] === '(') d++;
      else if (inner[k] === ')') d--;
      else if (inner[k] === ',' && d === 0) {
        comma = k;
        break;
      }
    }
    const name = (comma < 0 ? inner : inner.slice(0, comma)).trim();
    const fallback = comma < 0 ? undefined : inner.slice(comma + 1).trim();
    const value = lookup(name) ?? fallback;
    out += value === undefined ? '' : substituteVars(value, lookup, depth + 1);
    i = end + 1;
  }
  return out.trim();
}

const ORDER = ['light', 'dark'];

/** Display order: default first, then light, dark, the rest alphabetically. */
export function sortThemes(ids: string[], defaultId: string): string[] {
  const rank = (id: string) => (id === defaultId ? -1 : ORDER.includes(id) ? ORDER.indexOf(id) : 10);
  return [...ids].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

export const themeLabel = (id: string) =>
  id
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
