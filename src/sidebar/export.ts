import { parseColor, toHex } from '../content/color';
import type { AnalysisResult, CssToken, ShadowLayer, TypographyEntry } from '../shared/types';
import { styleName } from './views/Typography';

/**
 * Downloads the scan as a .zip a designer can rebuild the system from:
 *
 *   README.md                 what's inside and how to import it
 *   tokens/<category>.json    W3C Design Tokens (DTCG): color, typography, spacing, sizing, radius, shadow, …
 *   tokens/text-styles.json   composite typography styles detected on the page
 *   tokens/themes/<id>.json   per-theme overrides (dark, …), when the site has themes
 *   tokens.css                the same tokens as CSS custom properties
 *   detected/*.json           values the page actually renders (with or without tokens)
 *   raw/scan.json             the full scan, for tooling
 *
 * Only global tokens (declared on :root/html/body or a theme selector) go into tokens/.
 * Tokens scoped to one component class or with generated names are left out.
 */

// ---- Zip (stored, no compression) -----------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(files: { path: string; content: string }[], date = new Date()): Blob {
  const enc = new TextEncoder();
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const f of files) {
    const name = enc.encode(f.path);
    const data = enc.encode(f.content);
    const crc = crc32(data);
    // Shared fields of the local and central headers: version, flags (UTF-8 names), method 0, time, date, crc, sizes, name length.
    const fields = (v: DataView, at: number) => {
      v.setUint16(at, 20, true);
      v.setUint16(at + 2, 0x0800, true);
      v.setUint16(at + 4, 0, true);
      v.setUint16(at + 6, time, true);
      v.setUint16(at + 8, day, true);
      v.setUint32(at + 10, crc, true);
      v.setUint32(at + 14, data.length, true);
      v.setUint32(at + 18, data.length, true);
      v.setUint16(at + 22, name.length, true);
    };
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    fields(lv, 4);
    local.set(name, 30);

    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    fields(cv, 6);
    cv.setUint32(42, offset, true);
    cen.set(name, 46);

    parts.push(local, data);
    central.push(cen);
    offset += local.length + data.length;
  }

  const size = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, size, true);
  ev.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end] as BlobPart[], { type: 'application/zip' });
}

// ---- Token classification ---------------------------------------------------

type Json = Record<string, unknown>;
interface DT {
  $type?: string;
  $value: unknown;
  $description?: string;
  $extensions?: Json;
}

const ROOT_PART = /^(:root|html|:host|body|\*)([.[:\s]|$)/i;
const THEME_PART = /^(\[data-[\w-]*(theme|mode|scheme)|\.(dark|light)([-_][\w-]*)?(\s|$|[.[:]))|prefers-color-scheme/i;

/** Declared on the page root or a theme selector, not on one component. */
const isGlobal = (t: CssToken) =>
  !!t.themeValues ||
  (t.source === 'computed' && !t.scopes.length) ||
  t.scopes.some((s) => s.split(',').some((p) => ROOT_PART.test(p.trim()) || THEME_PART.test(p.trim())));

/** CSS-in-JS / CSS-modules names like "--sx-1dhg814" or "--abc12_def": not meant for people. */
const isGenerated = (name: string) => {
  const raw = name.replace(/^--/, '');
  if (/^(sx|css|jsx|sc|emotion|tw)-/i.test(raw)) return true;
  const last = raw.split(/[-_]/).pop() ?? '';
  // A hash mixes digits and letters ("1dhg814", "x8afrf"); "100dvh", "level0", "gray50" don't.
  return last.length >= 5 && /\d/.test(last) && /[a-z].*[a-z]/i.test(last) && !/^\d+[a-z]{0,4}$/i.test(last) && !/^[a-z]+\d{1,3}$/i.test(last);
};

const NON_VALUE = /^(inherit|initial|unset|revert|revert-layer)?$/i;
const DIMENSION = /^-?(\d+\.?\d*|\.\d+)(px|rem|em|%|vh|vw|dvh|svh|ch|ex)?$/;
const TIME = /^-?(\d+\.?\d*|\.\d+)m?s$/;

/** Top-level groups; each lives in one file. Group names are unique across files so references resolve when files are merged. */
type Group =
  | 'color'
  | 'font-family'
  | 'font-size'
  | 'font-weight'
  | 'line-height'
  | 'letter-spacing'
  | 'font'
  | 'spacing'
  | 'sizing'
  | 'radius'
  | 'shadow'
  | 'duration'
  | 'easing'
  | 'transition'
  | 'z-index'
  | 'breakpoint'
  | 'other';

const FILE_OF: Record<Group, string> = {
  color: 'color',
  'font-family': 'typography',
  'font-size': 'typography',
  'font-weight': 'typography',
  'line-height': 'typography',
  'letter-spacing': 'typography',
  font: 'typography',
  spacing: 'spacing',
  sizing: 'sizing',
  radius: 'radius',
  shadow: 'shadow',
  duration: 'motion',
  easing: 'motion',
  transition: 'motion',
  'z-index': 'z-index',
  breakpoint: 'breakpoint',
  other: 'other',
};

/** `usedAs`: the text property the page's CSS applies the token to, which beats a guess from its name ("--title-9-size"). */
const FILE_ORDER = ['color', 'typography', 'spacing', 'sizing', 'radius', 'shadow', 'motion', 'z-index', 'breakpoint', 'other'];

function groupOf(t: CssToken, usedAs?: Group): Group {
  const v = t.value.trim();
  if (usedAs && t.group !== 'color' && !t.fontShorthand) return usedAs;
  switch (t.group) {
    case 'color':
      return 'color';
    case 'typography':
      return t.fontShorthand ? 'font' : t.typeProperty ?? 'other';
    case 'spacing':
      return 'spacing';
    case 'size':
      return 'sizing';
    case 'radius':
      return 'radius';
    case 'shadow':
      return 'shadow';
    case 'motion':
      return TIME.test(v) ? 'duration' : /^cubic-bezier\(|^(ease|ease-in|ease-out|ease-in-out|linear)$/.test(v) ? 'easing' : 'transition';
    case 'z-index':
      return 'z-index';
    case 'breakpoint':
      return 'breakpoint';
    default:
      return 'other';
  }
}

const tokenKey = (name: string) => name.replace(/^--/, '').replace(/\./g, '_');

const familyList = (v: string) =>
  v
    .split(',')
    .map((f) => f.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);

const WEIGHT_WORDS: Record<string, number> = { normal: 400, bold: 700 };

const splitTop = (value: string, sep: RegExp) => {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (depth === 0 && sep.test(ch)) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
};

/** Splits a `font` shorthand into a DTCG typography value by letting the browser expand it. */
function fontParts(v: string) {
  const st = document.createElement('div').style;
  st.font = v;
  if (!st.fontSize || !st.fontFamily) return null;
  const lh = st.lineHeight;
  const weight = Number(WEIGHT_WORDS[st.fontWeight] ?? st.fontWeight);
  return {
    fontFamily: familyList(st.fontFamily),
    fontSize: st.fontSize,
    fontWeight: Number.isFinite(weight) ? weight : 400,
    lineHeight: !lh || lh === 'normal' ? 1.2 : /^[\d.]+$/.test(lh) ? Number(lh) : lh,
    letterSpacing: '0px',
  };
}

const hexOf = (c: string) => {
  const rgba = parseColor(c);
  return rgba ? toHex(rgba) : null;
};

function shadowValue(layers: ShadowLayer[]) {
  const out = layers.map((l) => ({
    color: hexOf(l.color) ?? l.color,
    offsetX: l.x,
    offsetY: l.y,
    blur: l.blur,
    spread: l.spread,
    ...(l.inset ? { inset: true } : {}),
  }));
  return out.length === 1 ? out[0] : out;
}

function parseShadow(value: string): ShadowLayer[] | null {
  if (value.trim() === 'none') return [{ inset: false, x: '0px', y: '0px', blur: '0px', spread: '0px', color: '#00000000' }];
  if (value.includes('var(')) return null;
  const layers = splitTop(value, /,/).map((layer) => {
    const lengths: string[] = [];
    let color = '#000000';
    let inset = false;
    for (const p of splitTop(layer, /\s/)) {
      if (p === 'inset') inset = true;
      else if (/^-?[\d.]/.test(p)) lengths.push(/^-?[\d.]+$/.test(p) ? `${p}px` : p);
      else color = p;
    }
    return { inset, x: lengths[0] ?? '0px', y: lengths[1] ?? '0px', blur: lengths[2] ?? '0px', spread: lengths[3] ?? '0px', color };
  });
  return layers.every((l) => hexOf(l.color)) ? layers : null;
}

/** The token's DTCG $type and $value, or an untyped value when it doesn't fit its type (calc(), keywords…). */
function typed(group: Group, value: string, resolved?: string): { $type?: string; $value: unknown } {
  const v = value.trim();
  const dim = (x: string) => (DIMENSION.test(x) ? { $type: 'dimension', $value: x === '0' ? '0px' : x } : { $value: x });
  switch (group) {
    case 'color': {
      const hex = hexOf(v);
      return hex ? { $type: 'color', $value: hex } : { $value: v };
    }
    case 'font-family':
      return { $type: 'fontFamily', $value: familyList(v) };
    case 'font-weight': {
      const n = Number(resolved ?? WEIGHT_WORDS[v] ?? v);
      return Number.isFinite(n) ? { $type: 'fontWeight', $value: n } : { $value: v };
    }
    case 'line-height':
      return /^[\d.]+$/.test(v) ? { $type: 'number', $value: Number(v) } : dim(v);
    case 'font-size':
      return dim(resolved ?? v);
    case 'letter-spacing':
    case 'spacing':
    case 'sizing':
    case 'radius':
    case 'breakpoint':
      return dim(v);
    case 'shadow': {
      const layers = parseShadow(v);
      return layers ? { $type: 'shadow', $value: shadowValue(layers) } : { $value: v };
    }
    case 'duration':
      return { $type: 'duration', $value: v };
    case 'easing': {
      const KEYWORDS: Record<string, number[]> = {
        linear: [0, 0, 1, 1],
        ease: [0.25, 0.1, 0.25, 1],
        'ease-in': [0.42, 0, 1, 1],
        'ease-out': [0, 0, 0.58, 1],
        'ease-in-out': [0.42, 0, 0.58, 1],
      };
      const m = /^cubic-bezier\(([^)]+)\)$/.exec(v);
      const nums = m ? m[1].split(',').map(Number) : KEYWORDS[v];
      return nums?.length === 4 && nums.every(Number.isFinite) ? { $type: 'cubicBezier', $value: nums } : { $value: v };
    }
    case 'z-index':
      return /^-?\d+$/.test(v) ? { $type: 'number', $value: Number(v) } : { $value: v };
    case 'font': {
      const f = fontParts(v);
      return f ? { $type: 'typography', $value: f } : { $value: v };
    }
    default:
      return { $value: v };
  }
}

// ---- Build ----------------------------------------------------------------------

const json = (o: unknown) => `${JSON.stringify(o, null, 2)}\n`;
const PLUGIN_EXT = 'com.design-system-inspector';

function build(data: AnalysisResult) {
  const all = data.tokens;
  const kept = all.filter((t) => isGlobal(t) && !isGenerated(t.name) && !NON_VALUE.test((t.value || t.rawValue).trim()));
  const keptNames = new Set(kept.map((t) => t.name));
  const usedAs = new Map<string, Group>();
  for (const s of data.typography) for (const x of s.tokens) if (x.token.declared) usedAs.set(x.token.name, x.property);
  const groups = new Map(kept.map((t) => [t.name, groupOf(t, usedAs.get(t.name))]));
  const path = (name: string) => `${groups.get(name)}.${tokenKey(name)}`;

  // Follow alias chains to a kept token in the same group, so references resolve in token tools.
  const byName = new Map(all.map((t) => [t.name, t]));
  const aliasTarget = (t: CssToken): string | null => {
    let target = t.aliasOf;
    for (let i = 0; target && i < 8; i++) {
      if (keptNames.has(target) && groups.get(target) === groups.get(t.name)) return target;
      target = byName.get(target)?.aliasOf;
    }
    return null;
  };

  const defaultTheme = data.themes.find((th) => th.isDefault)?.id;
  const files = new Map<string, Record<string, Record<string, DT>>>();
  const themeFiles = new Map<string, Record<string, Record<string, DT>>>();
  const counts: Record<string, number> = {};

  for (const t of kept) {
    const group = groups.get(t.name)!;
    const file = FILE_OF[group];
    const target = aliasTarget(t);
    const base = target
      ? { $type: typed(group, byName.get(target)!.value, byName.get(target)!.resolved).$type, $value: `{${path(target)}}` }
      : typed(group, t.value || t.rawValue, t.resolved);
    const token: DT = { ...base };
    if (!base.$type && !target) token.$description = 'Value doesn’t fit a standard token type; kept as written.';

    if (t.themeValues) {
      const modes: Record<string, unknown> = {};
      for (const [theme, tv] of Object.entries(t.themeValues)) {
        const val = typed(group, tv.value).$value;
        modes[theme] = val;
        if (theme === defaultTheme || tv.inherited) continue;
        const out = ((themeFiles.get(theme) ?? themeFiles.set(theme, {}).get(theme)!)[group] ??= {});
        out[tokenKey(t.name)] = { ...typed(group, tv.value) };
      }
      token.$extensions = { [PLUGIN_EXT]: { modes } };
    }

    const f = files.get(file) ?? files.set(file, {}).get(file)!;
    (f[group] ??= {})[tokenKey(t.name)] = token;
    counts[file] = (counts[file] ?? 0) + 1;
  }

  // Text styles: composite typography tokens from the styles the page renders.
  const textStyles: Record<string, DT> = {};
  const used = new Set<string>();
  const refOr = (s: TypographyEntry, prop: string, fallback: unknown) => {
    const tok = s.tokens.find((x) => x.property === prop && x.token.declared && keptNames.has(x.token.name));
    return tok ? `{${path(tok.token.name)}}` : fallback;
  };
  for (const s of [...data.typography].sort((a, b) => b.fontSizePx - a.fontSizePx || b.count - a.count)) {
    const { name, known } = styleName(s);
    const weight = Number(s.fontWeight);
    let key = (known ? name : `text-${Math.round(s.fontSizePx)}-${s.fontWeight}`).toLowerCase().replace(/\s+/g, '-');
    for (let i = 2; used.has(key); i++) key = `${key.replace(/-v\d+$/, '')}-v${i}`;
    used.add(key);
    const lh = parseFloat(s.lineHeight);
    const ls = s.letterSpacing === 'normal' ? '0px' : s.letterSpacing;
    textStyles[key] = {
      $type: 'typography',
      $value: {
        fontFamily: refOr(s, 'font-family', familyList(s.fontFamily)),
        fontSize: refOr(s, 'font-size', s.fontSize),
        fontWeight: refOr(s, 'font-weight', Number.isFinite(weight) ? weight : s.fontWeight),
        lineHeight: refOr(s, 'line-height', Number.isNaN(lh) ? 1.2 : Math.round((lh / s.fontSizePx) * 100) / 100),
        letterSpacing: refOr(s, 'letter-spacing', ls),
      },
      $description: `Used on ${s.count} element${s.count === 1 ? '' : 's'}. Sample: “${s.sample.slice(0, 60)}”`,
      $extensions: {
        [PLUGIN_EXT]: {
          lineHeightPx: s.lineHeight,
          textTransform: s.textTransform,
          tags: s.tags,
          ...(s.styleTokens.length ? { styleTokens: s.styleTokens.map((x) => x.name) } : {}),
        },
      },
    };
  }

  // tokens.css: kept tokens as custom properties; values that point at dropped tokens are resolved.
  const cssValue = (raw: string, resolved: string) =>
    [...raw.matchAll(/var\(\s*(--[\w-]+)/g)].every((m) => keptNames.has(m[1])) && raw ? raw : resolved;
  const cssLines = [':root {', ...kept.map((t) => `  ${t.name}: ${cssValue(t.rawValue, t.value)};`), '}'];
  for (const theme of data.themes) {
    if (theme.id === defaultTheme) continue;
    const decls = kept
      .filter((t) => t.themeValues?.[theme.id] && !t.themeValues[theme.id].inherited)
      .map((t) => `  ${t.name}: ${cssValue(t.themeValues![theme.id].raw, t.themeValues![theme.id].value)};`);
    if (decls.length) cssLines.push('', `/* ${theme.label} — from ${theme.sources.join(', ')} */`, `${theme.sources[0] ?? `[data-theme="${theme.id}"]`} {`, ...decls, '}');
  }

  const out: { path: string; content: string }[] = [];
  for (const file of FILE_ORDER) {
    const f = files.get(file);
    if (f) out.push({ path: `tokens/${file}.json`, content: json(f) });
  }
  if (Object.keys(textStyles).length) out.push({ path: 'tokens/text-styles.json', content: json({ 'text-style': textStyles }) });
  for (const [theme, f] of themeFiles) out.push({ path: `tokens/themes/${theme}.json`, content: json(f) });
  if (kept.length) out.push({ path: 'tokens.css', content: `/* ${data.url} */\n${cssLines.join('\n')}\n` });

  out.push(
    {
      path: 'detected/colors.json',
      content: json(
        data.colors.map((c) => ({ hex: c.hex, rgb: c.rgb, alpha: c.alpha, usage: c.count, usedAs: c.roles, tokens: c.tokens.map((t) => t.name) })),
      ),
    },
    {
      path: 'detected/text-styles.json',
      content: json(
        data.typography.map((s) => ({
          name: styleName(s).known ? styleName(s).name : null,
          fontFamily: s.fontFamily,
          fontSize: s.fontSize,
          fontWeight: s.fontWeight,
          lineHeight: s.lineHeight,
          letterSpacing: s.letterSpacing,
          textTransform: s.textTransform,
          usage: s.count,
          tags: s.tags,
          sample: s.sample,
          tokens: Object.fromEntries(s.tokens.filter((t) => t.token.declared).map((t) => [t.property, t.token.name])),
          classes: s.classes.map((c) => c.name),
        })),
      ),
    },
    { path: 'detected/fonts.json', content: json(data.fonts.map((f) => ({ family: f.family, usage: f.count }))) },
    {
      path: 'detected/shadows.json',
      content: json(data.shadows.map((s) => ({ value: s.value, layers: s.layers, usage: s.count, tokens: s.tokens.map((t) => t.name) }))),
    },
    { path: 'raw/scan.json', content: json(data) },
  );

  out.unshift({ path: 'README.md', content: readme(data, counts, kept.length, all.length, Object.keys(textStyles).length, [...themeFiles.keys()]) });
  return out;
}

function readme(data: AnalysisResult, counts: Record<string, number>, kept: number, total: number, textStyles: number, themes: string[]) {
  const date = new Date(data.analyzedAt).toISOString().slice(0, 10);
  const rows = FILE_ORDER.filter((f) => counts[f]).map((file) => `| \`tokens/${file}.json\` | ${counts[file]} |`);
  return `# Design system — ${data.title || data.url}

Extracted from ${data.url} on ${date} by Design System Inspector.${data.focus ? `\n\n**Note:** detected values cover only \`${data.focus.label}\`, not the whole page.` : ''}

## Tokens (W3C Design Tokens format)

The site's CSS variables, one file per category. Import them into Tokens Studio for Figma,
Figma variables (JSON import), Style Dictionary, or any tool that reads the W3C Design Tokens (DTCG) format.

| File | Tokens |
| --- | --- |
${rows.join('\n') || '| — | This site declares no global CSS variables |'}
${textStyles ? `| \`tokens/text-styles.json\` | ${textStyles} text styles |\n` : ''}
- References like \`{color.color-accent}\` point to other tokens; load all files together.
- Values that don't fit a standard type (\`calc()\`, keywords) have no \`$type\` and are kept as written.
- Text styles are built from the text the page renders. Their names come from the site's tokens or class names
  (Heading, Title, Body, Button…); styles without one are named by size and weight (\`text-16-400\`).
${themes.length ? `- Theme overrides: ${themes.map((t) => `\`tokens/themes/${t}.json\``).join(', ')}. The base files hold the default theme; every token's per-theme values are also in \`$extensions.${PLUGIN_EXT}.modes\`.\n` : ''}- ${kept} of ${total} CSS variables are included: the ones declared on \`:root\`, \`html\`, \`body\` or a theme selector.
  Variables scoped to a single component, with generated names, or set to \`inherit\` are left out (they're all in \`raw/scan.json\`).

## tokens.css

The same tokens as CSS custom properties, ready to paste into a stylesheet.

## detected/

What the page actually renders, with usage counts — useful when a site has few or no tokens:
colors (and where they're used: text, background, border…), text styles, fonts and shadows.

## raw/scan.json

The complete scan, for scripts and tooling.
`;
}

export function exportZip(data: AnalysisResult) {
  let host = 'page';
  try {
    host = new URL(data.url).hostname.replace(/^www\./, '');
  } catch {
    /* keep default */
  }
  // No dots: macOS opens a folder named "….app" as an application.
  const name = `design-system-${host.replace(/\./g, '-')}`;
  const blob = zip(build(data).map((f) => ({ ...f, path: `${name}/${f.path}` })));
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** For tests and the dev harness. */
export const buildExportFiles = build;
