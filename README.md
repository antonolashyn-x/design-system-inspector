# Design System Inspector

An Opera (and any Chromium) extension that reverse-engineers the visual design system of the page you're viewing: colors, typography, CSS tokens and shadows. Everything runs locally in your browser. There's no backend.

## Install in Opera

Download the zip from the latest [release](../../releases) and unzip it, or build it yourself:

```bash
npm install
npm run build
```

`npm run package` builds and writes `release/design-system-inspector-v<version>.zip`.

1. Open `opera://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and select the `dist/` folder (or the unzipped release folder).
3. Click the extension's toolbar icon. The inspector opens as a panel docked on the right of the page, like Grid Inspector.
   - **Collapse** (the panel icon in the header) hides it behind a small **‹ DS Inspector** handle on the right edge. Highlights stay on the page. Click the handle, or the toolbar icon, to expand it again.
   - **×** closes it. Drag the panel's left edge to resize it.
   - The panel stays open while you navigate within the tab, and re-scans after each page load.

In Chrome, Edge and Brave the toolbar icon opens the browser's native side panel instead.

## What it extracts

| Tab | Source | Notes |
| --- | --- | --- |
| Overview | all of the below | Counts, palette, font families, token groups |
| Colors | `getComputedStyle()` on every visible element (text, background, borders, SVG fill/stroke) | Deduplicated by HEX, sorted by usage, with the roles each color plays |
| Typography | computed family / size / weight / line-height / letter-spacing / transform of elements that render their own text | Sub-tabs: **Styles**, a type-scale table (Type · Token · Font family · Font size · Line height · Font weight · Letter spacing), stacked into cards in a narrow panel; and **Font family / Font size / Font weight**, which list the site's tokens for that property with resolved values and usage, then the values that have no token |
| CSS Tokens | readable stylesheets (incl. `@media`, `@layer`, `@import`, nesting) **plus** computed custom properties on `:root`/`body` | Grouped as color / typography / spacing / radius / shadow / size / motion / z-index / breakpoint. Typography splits further into text style / font family / font size / font weight / line height / letter spacing, each sorted by value; radii are sorted smallest to largest. Shows aliases (`--color-primary → --blue-500`), the selectors that declare each token, and how often it is referenced |
| Shadows | computed `box-shadow` | Live preview, parsed layers, usage |

**Themes.** When a site defines light/dark (or more) themes, the Tokens tab detects them from the usual patterns: `[data-theme=dark]`, `[data-bs-theme=…]`, `.dark`, GitHub's `[data-dark-theme=…]`, and `@media (prefers-color-scheme: dark)`. Every token that changes per theme lists its value for each theme. `var()` references are resolved inside that theme. Switch between *All themes*, *Light* and *Dark*, or turn on *Theme-specific only* to hide tokens that are the same in every theme. The JSON export adds per-theme values as `$extensions.modes`, for Figma variable modes.

**Style names.** The Type column is named only from what the Token column shows: an applied `font` shorthand token, or the CSS classes on the elements. Obvious role words give the name: `btn`/`button` → Button, `display` → Display, `link` → Link, `heading`/`h1`–`h6` → Heading, `title` → Title, `body` → Body, `text` → Text, plus a size that follows (`btn-lg` → Button LG, `display-4` → Display 4, `hds-text--xl` → Text XL). The role word must end the name, so `text-center` or `footer-cta-section__description` don't count. Everything else shows **Lorem Ipsum** in that style.

**Applied tokens vs. same value.** For typography, the analyzer reads the CSS rules (and inline styles) that set each property on an element, or on the ancestor it inherits from, and records the `var()` that is actually applied, after checking that it produces the computed value. Those tokens show as solid chips. When none is found, tokens that merely share the value are listed as dashed **≈** chips: 14px may equal several tokens, and the page doesn't use all of them. Colors and shadows are still matched by resolved value. A dashed **Raw value** badge means the value was only found in computed styles.

**Find.** Outlines every element that uses the selected color, text style or shadow. A pill on the page lets you step through matches with ‹ ›. Press Esc to clear it.

**Theme.** The switch in the footer picks System, Light or Dark. Your choice is remembered.

**Export.** Downloads JSON that includes the tokens in W3C Design Tokens shape (`$value`/`$type`), for Figma token plugins.

## Limits (MVP)

- Cross-origin stylesheets served without CORS headers can't be read. Tokens declared on `:root` are still found through computed styles, but tokens scoped to other selectors in those files are missing. The Overview shows how many sheets were blocked.
- Only the top document is scanned. iframes and closed shadow roots are skipped. The scan stops after 20,000 elements.
- Gradients, `text-shadow` and `filter: drop-shadow` aren't analysed yet.
- Typography previews use fonts installed on your machine.

## Development

- `npm run dev:harness`, then open http://localhost:5199/dev/harness.html, or http://localhost:5199/dev/fixture.html?docked to try the docked panel with collapse and close. This shows the UI beside a fixture page and calls the analyzer directly, with no extension reload. The panel defaults to sidebar width (420 px). Add `?w=360` to try other widths.
- `npm run icons` regenerates the extension icons (16–128 px) from the master logo `assets/logo.png` (512 px, macOS `sips`).

```
src/content/   analyzer (runs in the page): analyzer.ts, tokens.ts, color.ts, highlight.ts, index.ts
src/sidebar/   React UI (browser sidebar)
src/shared/    message and data types
```
