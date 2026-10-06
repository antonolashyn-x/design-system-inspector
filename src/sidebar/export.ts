import type { AnalysisResult } from '../shared/types';

/**
 * Downloads the scan as JSON. Tokens are additionally emitted in the W3C
 * Design Tokens shape ({ $value, $type }) so they can be pasted into Figma
 * variable/token plugins.
 */
export function exportJson(data: AnalysisResult) {
  type DT = { $value: string; $type: string; $description?: string; $extensions?: { modes: Record<string, string> } };
  const designTokens: Record<string, Record<string, DT>> = {};
  for (const t of data.tokens) {
    const group = (designTokens[t.group] ??= {});
    group[t.name.replace(/^--/, '')] = {
      $value: t.aliasOf ? `{${t.aliasOf.replace(/^--/, '')}}` : t.value || t.rawValue,
      $type: t.group === 'color' ? 'color' : t.group === 'shadow' ? 'shadow' : t.group === 'typography' ? 'typography' : 'dimension',
      ...(t.scopes.length ? { $description: `Declared on ${t.scopes.join(', ')}` } : {}),
      // Per-theme values (Figma variable modes / Tokens Studio themes).
      ...(t.themeValues
        ? { $extensions: { modes: Object.fromEntries(Object.entries(t.themeValues).map(([theme, v]) => [theme, v.value])) } }
        : {}),
    };
  }

  const payload = {
    source: { url: data.url, title: data.title, analyzedAt: new Date(data.analyzedAt).toISOString() },
    colors: data.colors.map(({ hex, rgb, count, roles, tokens }) => ({ hex, rgb, count, roles, tokens: tokens.map((t) => t.name) })),
    typography: data.typography.map(({ fontFamily, fontSize, fontWeight, lineHeight, letterSpacing, textTransform, count, tags, tokens }) => ({
      fontFamily,
      fontSize,
      fontWeight,
      lineHeight,
      letterSpacing,
      textTransform,
      count,
      tags,
      tokens: tokens.map((t) => ({ property: t.property, token: t.token.name })),
    })),
    shadows: data.shadows.map(({ value, layers, count, tokens }) => ({ value, layers, count, tokens: tokens.map((t) => t.name) })),
    themes: data.themes,
    tokens: data.tokens,
    designTokens,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  let host = 'page';
  try {
    host = new URL(data.url).hostname.replace(/^www\./, '');
  } catch {
    /* keep default */
  }
  a.href = url;
  a.download = `design-system-${host}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
