// Data contract between the content script (analyzer) and the UI.

export type ColorRole = 'text' | 'background' | 'border' | 'fill' | 'stroke' | 'outline';

export interface TokenRef {
  /** Custom property name, e.g. "--color-primary". */
  name: string;
  /** Selector the token was declared on (":root", ".dark", …). */
  scope: string;
}

export interface ColorEntry {
  /** Stable key used for highlighting. */
  key: string;
  hex: string; // #rrggbb or #rrggbbaa
  rgb: string; // rgb(…) / rgba(…)
  alpha: number;
  count: number;
  roles: Partial<Record<ColorRole, number>>;
  /** CSS custom properties whose resolved value equals this color. */
  tokens: TokenRef[];
}

export interface TypeTokenRef extends TokenRef {
  /** True when CSS on these elements references the token; false when it only has the same value. */
  declared: boolean;
}

export interface TypographyEntry {
  key: string;
  fontFamily: string; // full stack as computed
  primaryFamily: string; // first family, unquoted
  fontSize: string; // px
  fontSizePx: number;
  fontWeight: string;
  lineHeight: string;
  letterSpacing: string;
  textTransform: string;
  count: number;
  /** Tag usage, e.g. { h1: 2, p: 14 }. */
  tags: Record<string, number>;
  sample: string;
  /**
   * Tokens per property. `declared` tokens are the ones the site's CSS actually sets on these elements
   * (`font-size: var(--x)`); when none are found, tokens that merely share the value are listed instead.
   */
  tokens: { property: TypoProperty; token: TypeTokenRef }[];
  /** Composite style tokens (font shorthand variables): declared ones, else ones whose size/line-height/weight match. */
  styleTokens: TypeTokenRef[];
  /** Most common class names on elements using this style (often the site's type-style names). */
  classes: { name: string; count: number }[];
}

export type TypoProperty = 'font-family' | 'font-size' | 'font-weight' | 'line-height' | 'letter-spacing';

export interface ShadowLayer {
  inset: boolean;
  x: string;
  y: string;
  blur: string;
  spread: string;
  color: string;
}

export interface ShadowEntry {
  key: string;
  value: string;
  layers: ShadowLayer[];
  count: number;
  tokens: TokenRef[];
}

export type TokenGroup =
  | 'color'
  | 'typography'
  | 'spacing'
  | 'radius'
  | 'shadow'
  | 'size'
  | 'motion'
  | 'z-index'
  | 'breakpoint'
  | 'other';

export interface CssToken {
  name: string;
  /** Value as written in the stylesheet, if the stylesheet was readable. */
  rawValue: string;
  /** Value resolved on the element the token applies to (var() substituted). */
  value: string;
  group: TokenGroup;
  /** All selectors that declare this token. */
  scopes: string[];
  /** If the raw value is a pure alias like var(--blue-500). */
  aliasOf?: string;
  /** Normalized preview helpers. */
  previewColor?: string;
  /** For typography tokens: which CSS property the token represents. */
  typeProperty?: TypoProperty;
  /** For typography tokens: a whole `font` shorthand ("600 14px/20px Inter") — a complete text style. */
  fontShorthand?: boolean;
  /** For typography tokens: the value in computed form (e.g. "14px", "500"). */
  resolved?: string;
  /**
   * Present when the token has different declarations per theme (light/dark/…),
   * keyed by theme id from `AnalysisResult.themes`.
   */
  themeValues?: Record<string, ThemeValue>;
  /** How many times the token appears in var() references across readable CSS. */
  references: number;
  /** Where we learned about it. */
  source: 'stylesheet' | 'computed' | 'inline';
}

export interface ThemeValue {
  /** As written in the stylesheet for this theme. */
  raw: string;
  /** var() references substituted with this theme's values. */
  value: string;
  previewColor?: string;
  /** Not declared in this theme; inherited from the default/:root declaration. */
  inherited?: boolean;
}

export interface ThemeInfo {
  id: string; // "light", "dark", "dark-dimmed", …
  label: string;
  /** The theme that applies when no theme selector matches (declared with :root). */
  isDefault: boolean;
  /** Currently applied on the inspected page. */
  active: boolean;
  /** Selectors / media queries that define it, for tooltips. */
  sources: string[];
  /** Number of tokens with a value for this theme. */
  tokenCount: number;
}

export interface FontFamilyEntry {
  family: string;
  count: number;
}

export interface AnalysisResult {
  url: string;
  title: string;
  analyzedAt: number;
  durationMs: number;
  elementsScanned: number;
  elementsTotal: number;
  truncated: boolean;
  stylesheets: { total: number; readable: number; blocked: number };
  colors: ColorEntry[];
  typography: TypographyEntry[];
  fonts: FontFamilyEntry[];
  tokens: CssToken[];
  /** Color themes detected from token declarations (empty when the site has a single theme). */
  themes: ThemeInfo[];
  shadows: ShadowEntry[];
}

// ---- Messaging -------------------------------------------------------------

/** Registry keys: "color:#HEX", "type:<style>", "shadow:<value>", "ff:<family>", "fs:<size>", "fw:<weight>". */
export type InspectorRequest =
  | { type: 'dsi:ping' }
  | { type: 'dsi:analyze' }
  | { type: 'dsi:highlight'; keys: string[]; label: string; color?: string }
  | { type: 'dsi:clear' }
  | { type: 'dsi:panel-toggle'; tabId: number }
  | { type: 'dsi:panel-open'; tabId: number };

export interface HighlightResponse {
  count: number;
}

export interface InspectorApi {
  analyze(): Promise<AnalysisResult>;
  highlight(keys: string[], label: string, color?: string): Promise<HighlightResponse>;
  clear(): Promise<void>;
}
