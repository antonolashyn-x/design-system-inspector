import type { InspectorApi, InspectorRequest } from '../shared/types';
import { analyzePage, registry } from './analyzer';
import { clearHighlight, highlight } from './highlight';
import { listenToPanel, openPanel, togglePanel } from './panel';
import { cancelPick, clearFocus, describe, focusedElement, focusParent, pickKey, startPick } from './picker';

declare global {
  interface Window {
    __DSI__?: InspectorApi;
    __dsiListener__?: (msg: InspectorRequest, sender: unknown, respond: (r: unknown) => void) => boolean | void;
    __dsiConnect__?: (port: chrome.runtime.Port) => void;
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
    cancelPick();
    const focus = focusedElement();
    const result = analyzePage(focus ?? undefined);
    if (focus) result.focus = describe(focus);
    return result;
  },
  async highlight(keys, label, color) {
    return { count: highlight(collect(keys), label, color) };
  },
  async clear() {
    clearHighlight();
  },
  pick() {
    clearHighlight();
    return startPick();
  },
  async cancelPick() {
    cancelPick();
  },
  async pickKey(key) {
    pickKey(key);
  },
  async focusParent() {
    return focusParent();
  },
  async unfocus() {
    clearFocus();
  },
};

/** Leaves inspect mode entirely: no picker, no focus, no highlight. */
function reset() {
  cancelPick();
  clearFocus();
  clearHighlight();
}

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
        case 'dsi:pick':
          return { ok: true, data: await api.pick() };
        case 'dsi:pick-cancel':
          await api.cancelPick();
          return { ok: true };
        case 'dsi:pick-key':
          await api.pickKey(msg.key);
          return { ok: true };
        case 'dsi:focus-parent':
          return { ok: true, data: await api.focusParent() };
        case 'dsi:unfocus':
          await api.unfocus();
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

  // The inspector UI holds a port to this page while it is open; when the side panel closes
  // (or the extension reloads) drop the picker and the focus so the page isn't left dimmed.
  if (window.__dsiConnect__) {
    try {
      chrome.runtime.onConnect.removeListener(window.__dsiConnect__);
    } catch {
      /* listener belonged to an invalidated context */
    }
  }
  const onConnect = (port: chrome.runtime.Port) => {
    if (port.name === 'dsi-session') port.onDisconnect.addListener(reset);
  };
  window.__dsiConnect__ = onConnect;
  chrome.runtime.onConnect.addListener(onConnect);

  // Closing the docked panel from its × button: drop highlights and tell the background
  // so it stops reopening the panel on navigation.
  listenToPanel(() => {
    reset();
    chrome.runtime.sendMessage({ type: 'dsi:panel-closed' }).catch(() => undefined);
  });
}
