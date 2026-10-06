export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

const cache = new Map<string, RGBA | null>();
let ctx: CanvasRenderingContext2D | null = null;

const RGB_RE = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i;
const NON_COLORS = /^(none|transparent|inherit|initial|unset|revert|currentcolor|auto)$/i;

function canvasParse(value: string): RGBA | null {
  if (!ctx) {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
  }
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = '#000';
  ctx.fillStyle = value;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  return { r, g, b, a: Math.round((a / 255) * 100) / 100 };
}

/**
 * Parses any CSS color string into sRGB. Fast path for rgb()/rgba() (what
 * getComputedStyle returns for most colors); falls back to painting a pixel
 * for modern formats like oklch(), lab() or color().
 */
export function parseColor(value: string): RGBA | null {
  const v = value.trim();
  // Any value containing var() passes CSS.supports(), so unresolved references can't be trusted.
  if (!v || NON_COLORS.test(v) || v.includes('var(')) return null;
  if (cache.has(v)) return cache.get(v)!;

  let out: RGBA | null = null;
  const m = RGB_RE.exec(v);
  if (m) {
    const alpha = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    out = { r: Math.round(+m[1]), g: Math.round(+m[2]), b: Math.round(+m[3]), a: Math.round(alpha * 100) / 100 };
  } else if (CSS.supports('color', v)) {
    out = canvasParse(v);
  }
  cache.set(v, out);
  return out;
}

const hex2 = (n: number) => n.toString(16).padStart(2, '0');

export function toHex({ r, g, b, a }: RGBA): string {
  const base = `#${hex2(r)}${hex2(g)}${hex2(b)}`;
  return a >= 1 ? base.toUpperCase() : (base + hex2(Math.round(a * 255))).toUpperCase();
}

export function toRgbString({ r, g, b, a }: RGBA): string {
  return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`;
}

const HSL_CHANNELS = /^-?[\d.]+(deg|turn|rad)?\s+[\d.]+%\s+[\d.]+%(\s*\/\s*[\d.]+%?)?$/;
const RGB_CHANNELS = /^\d{1,3}(\s*,\s*|\s+)\d{1,3}(\s*,\s*|\s+)\d{1,3}$/;

/**
 * Returns a renderable color for a custom property value, including the
 * "bare channel" convention used by Tailwind/shadcn (`--primary: 222 47% 11%`).
 */
export function colorFromTokenValue(value: string): string | null {
  const v = value.trim();
  if (!v || NON_COLORS.test(v)) return null;
  if (/^-?[\d.]+$/.test(v)) return null; // plain numbers are never colors
  if (v.includes('var(')) return null; // unresolved reference — CSS.supports() would accept anything
  if (CSS.supports('color', v)) return v;
  if (HSL_CHANNELS.test(v)) return `hsl(${v})`;
  if (RGB_CHANNELS.test(v)) return `rgb(${v.replace(/\s*,\s*|\s+/g, ', ')})`;
  return null;
}
