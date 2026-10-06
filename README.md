<p align="center">
  <img src="assets/logo.png" alt="" width="96" height="96" />
</p>

<h1 align="center">Design System Inspector</h1>

<p align="center">
  Reverse-engineer the design system of any website: colors, typography, CSS tokens and shadows.<br />
  A browser extension for Chrome, Opera, Edge and Brave. Runs 100% locally.
</p>

<p align="center">
  <a href="https://github.com/antonolashyn-x/design-system-inspector/releases/latest"><b>Download</b></a> ·
  <a href="#install-in-chrome">Install in Chrome</a> ·
  <a href="#install-in-opera">Install in Opera</a> ·
  <a href="#features">Features</a> ·
  <a href="#feedback">Feedback</a>
</p>

---

## Features

| | |
| --- | --- |
| **Overview** | A one-screen summary: palette, font families, token groups and counts. |
| **Colors** | Every color used on the page, merged by HEX and sorted by usage. Shows where each one is used (text, background, border, SVG) and the tokens that hold it. |
| **Typography** | A type scale of every text style, with family, size, line height, weight and letter spacing, and the tokens behind each one. |
| **Tokens** | All CSS custom properties, grouped into color, typography, spacing, radius, shadow, size, motion, z-index and breakpoint. Shows aliases, light/dark values and usage counts. |
| **Shadows** | Live previews of every `box-shadow`, split into layers. |
| **Find** | Outlines every element that uses a color, text style or shadow. Step through them with ‹ ›. |
| **Export** | Downloads JSON in the W3C Design Tokens format, ready for Figma token plugins. Light and dark values are included as modes. |

---

## Install in Chrome

Works the same way in **Edge** and **Brave**.

1. **Download** `design-system-inspector-v<version>.zip` from the [latest release](https://github.com/antonolashyn-x/design-system-inspector/releases/latest) and **unzip** it.
2. Open **`chrome://extensions`**.
3. Turn on **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the unzipped folder (the one that contains `manifest.json`).
5. **Pin it:** click the puzzle icon 🧩 in the toolbar, then the pin next to *Design System Inspector*.
6. Open any website and click the extension icon. The inspector opens in Chrome's **side panel**.

> [!TIP]
> **Updating:** unzip the new version over the same folder, then click **↻ Reload** on the extension's card in `chrome://extensions`.

## Install in Opera

1. **Download** and **unzip** the [latest release](https://github.com/antonolashyn-x/design-system-inspector/releases/latest).
2. Open **`opera://extensions`** and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the unzipped folder.
4. Click the extension icon. The inspector opens as a panel docked on the right side of the page.

| Panel control | What it does |
| --- | --- |
| **Collapse** (panel icon in the header) | Hides the panel behind a small **‹ DS Inspector** tab on the right edge. Highlights stay on the page. |
| **×** | Closes the panel. |
| **Left edge** | Drag it to resize the panel. |

The panel stays open while you browse in that tab and re-scans the page after each load.

> [!NOTE]
> Browser pages (`chrome://`, `opera://`) and the extension stores can't be inspected. The icon flashes a red **!** there.

---

## Privacy

Everything happens in your browser. There is no server, no account and no tracking.

| Permission | Why it's needed |
| --- | --- |
| Access to all sites | To read the styles of the page you choose to inspect. |
| `scripting` | To run the analyzer in that page. |
| `sidePanel` | To open the inspector in Chrome's side panel. |
| `storage` | To remember which tabs have the docked panel open (Opera). |

---

<details>
<summary><b>How it works</b></summary>

<br />

**Tokens that are really applied.** For typography, the analyzer finds the CSS rule that sets each property on an element, or on the ancestor it inherits from. It records the `var()` that rule uses, after checking that it produces the value you see. These tokens show as **solid chips**. When no such token is found, tokens that only share the value are shown as dashed **≈ chips**. A 14px font size may match several tokens, and the page doesn't use all of them.

**Style names.** Text styles are named from their token or CSS classes, using obvious role words only:

| Found in a token or class | Name |
| --- | --- |
| `btn`, `button` | Button |
| `display` | Display |
| `link` | Link |
| `heading`, `h1`–`h6` | Heading |
| `title` | Title |
| `body` | Body |
| `text` | Text |

A size that follows the role word is added, e.g. `btn-lg` → *Button LG*, `display-4` → *Display 4*, `hds-text--xl` → *Text XL*. Anything else shows **Lorem Ipsum**, rendered in that style.

**Themes.** Light and dark (and other) themes are detected from the common patterns: `[data-theme=dark]`, `[data-bs-theme]`, `.dark`, `[data-dark-theme]` and `@media (prefers-color-scheme: dark)`. Each token shows its value in every theme.

</details>

<details>
<summary><b>Known limits</b></summary>

<br />

- Stylesheets from other domains that block reading can't be inspected. Tokens on `:root` are still found, but tokens scoped elsewhere in those files are missed. The Overview shows how many stylesheets were blocked.
- Only the main page is scanned: no iframes or closed shadow roots, and at most 20,000 elements.
- Gradients, `text-shadow` and `filter: drop-shadow` aren't analysed yet.
- Font previews use the fonts installed on your computer.

</details>

<details>
<summary><b>Development</b></summary>

<br />

```bash
npm install
npm run build        # builds the extension into dist/
npm run package      # builds and zips it into release/design-system-inspector-v<version>.zip
npm run dev:harness  # live UI next to a test page, no extension reload needed
npm run icons        # regenerates the icons from assets/logo.png (macOS)
```

With the harness running, open http://localhost:5199/dev/harness.html (add `?w=360` to try other panel widths). For the docked Opera-style panel, open http://localhost:5199/dev/fixture.html?docked.

```
src/content/   analyzer that runs in the page
src/sidebar/   React UI
src/shared/    shared types
```

</details>

---

## Feedback

**Found a bug or have an idea?** I'd love to hear from you.

- 🐞 [Open an issue](https://github.com/antonolashyn-x/design-system-inspector/issues/new) on GitHub, or
- ✉️ Email me at **[antonolashyn@gmail.com](mailto:antonolashyn@gmail.com?subject=Design%20System%20Inspector%20feedback)**

For bugs, it helps to include the website URL, your browser and a screenshot.

---

<p align="center">
  Made by <b>Anton Olashyn</b> · <a href="LICENSE">MIT License</a>
</p>
