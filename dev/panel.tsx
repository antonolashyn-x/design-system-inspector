// Dev stand-in for sidebar.html?tabId=… when docked inside the fixture page:
// talks to the analyzer in the parent window instead of through chrome.* APIs.
import { createRoot } from 'react-dom/client';
import { App } from '../src/sidebar/App';
import type { Bridge } from '../src/sidebar/bridge';
import type { InspectorApi } from '../src/shared/types';
import { applyStoredTheme } from '../src/sidebar/theme';
import '../src/sidebar/styles.css';

applyStoredTheme();

const parentApi = () => (window.parent as Window & { __DSI__: InspectorApi }).__DSI__;

const bridge: Bridge = {
  analyze: () => parentApi().analyze(),
  highlight: (keys, label, color) => parentApi().highlight(keys, label, color),
  clear: () => parentApi().clear(),
  collapse: () => window.parent.postMessage({ dsi: 'collapse' }, '*'),
  close: () => window.parent.postMessage({ dsi: 'close' }, '*'),
};

createRoot(document.getElementById('root')!).render(<App bridge={bridge} />);
