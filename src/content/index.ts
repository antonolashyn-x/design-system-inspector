import type { InspectorApi, InspectorRequest } from '../shared/types';
import { analyzePage, registry } from './analyzer';
import { clearHighlight, highlight } from './highlight';
import { listenToPanel, openPanel, togglePanel } from './panel';

declare global {
  interface Window {
    __DSI__?: InspectorApi;
    __dsiListener__?: (msg: InspectorRequest, sender: unknown, respond: (r: unknown) => void) => boolean | void;
  }
}

/** Elements for one or more registry keys, deduplicated and in document order. */
function collect(keys: string[]): Element[] {
  if (keys.length === 1) return registry.get(keys[0]) ?? [];
  const set = new Set(keys.flatMap((k) => registry.get(k) ?? []));
  return [...set].sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
}

const api: InspectorApi = {
  async analyze() {
    clearHighlight();
    return analyzePage();
  },
  async highlight(keys, label, color) {
    return { count: highlight(collect(keys), label, color) };
  },
  async clear() {
    clearHighlight();
  },
};

window.__DSI__ = api;

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  // The script may be injected again (e.g. after the extension reloads); drop the stale listener.
  if (window.__dsiListener__) {
    try {
      chrome.runtime.onMessage.removeListener(window.__dsiListener__);
    } catch {
      /* listener belonged to an invalidated context */
    }
  }
  const listener = (msg: InspectorRequest, _sender: unknown, respond: (r: unknown) => void) => {
    const run = async () => {
      switch (msg?.type) {
        case 'dsi:ping':
          return { ok: true };
        case 'dsi:analyze':
          return { ok: true, data: await api.analyze() };
        case 'dsi:highlight':
          return { ok: true, data: await api.highlight(msg.keys, msg.label, msg.color) };
        case 'dsi:clear':
          await api.clear();
          return { ok: true };
        case 'dsi:panel-toggle':
          return { ok: true, data: { open: togglePanel(msg.tabId) } };
        case 'dsi:panel-open':
          openPanel(msg.tabId);
          return { ok: true, data: { open: true } };
        default:
          return undefined;
      }
    };
    if (!msg?.type?.startsWith('dsi:')) return;
    run()
      .then(respond)
      .catch((err) => respond({ ok: false, error: String(err?.message ?? err) }));
    return true; // async response
  };
  window.__dsiListener__ = listener;
  chrome.runtime.onMessage.addListener(listener);

  // Closing the docked panel from its × button: drop highlights and tell the background
  // so it stops reopening the panel on navigation.
  listenToPanel(() => {
    clearHighlight();
    chrome.runtime.sendMessage({ type: 'dsi:panel-closed' }).catch(() => undefined);
  });
}
