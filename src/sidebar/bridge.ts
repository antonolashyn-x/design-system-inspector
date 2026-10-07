import type { AnalysisResult, FocusInfo, HighlightResponse, InspectorRequest } from '../shared/types';

/** Abstracts how the UI reaches the page, so the same UI runs in the extension and the dev harness. */
export interface Bridge {
  analyze(): Promise<AnalysisResult>;
  highlight(keys: string[], label: string, color?: string): Promise<HighlightResponse>;
  clear(): Promise<void>;
  /** Inspect mode: let the user pick an element on the page; resolves with it, or null when cancelled. */
  pick(): Promise<FocusInfo | null>;
  cancelPick(): Promise<void>;
  /** Forwards ↑ / ↓ / Enter / Esc pressed in the panel to the picker on the page. */
  pickKey(key: string): Promise<void>;
  /** Widen the focus to the parent of the focused element. */
  focusParent(): Promise<FocusInfo | null>;
  /** Back to analysing the whole page. */
  unfocus(): Promise<void>;
  /** Subscribe to "the inspected page changed" (tab switch / navigation). */
  onPageChange?(cb: () => void): () => void;
  /** Present when the UI is docked inside the page: collapse to an edge handle, or close. */
  collapse?(): void;
  close?(): void;
}

const RESTRICTED = [
  /^(chrome|opera|edge|brave|vivaldi|about|chrome-extension|moz-extension|view-source|devtools|file):/i,
  /^https:\/\/(addons\.opera\.com|chromewebstore\.google\.com|chrome\.google\.com\/webstore)/i,
];

export class InspectError extends Error {}

async function activeTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new InspectError('No active tab found.');
  if (tab.url && RESTRICTED.some((re) => re.test(tab.url!)))
    throw new InspectError('Browser pages, extension stores and local files can’t be inspected. Open a regular website and try again.');
  return tab;
}

async function send<T>(tabId: number, msg: InspectorRequest): Promise<T> {
  const res = await chrome.tabs.sendMessage(tabId, msg);
  if (!res?.ok) throw new InspectError(res?.error ?? 'The page did not respond.');
  return res.data as T;
}

async function ensureInjected(tabId: number) {
  try {
    await send(tabId, { type: 'dsi:ping' });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  }
}

/**
 * Bridge for the sidebar UI.
 * - With `tabId` (panel docked inside a page): always inspects that tab.
 * - Without (native browser sidebar / side panel): follows the active tab of this window.
 */
export function createChromeBridge(tabId?: number): Bridge {
  let lastTabId: number | undefined;
  // One port per inspected tab; the page drops its picker and focus when it disconnects (UI closed).
  const sessions = new Map<number, chrome.runtime.Port>();
  const connect = (id: number) => {
    if (sessions.has(id)) return;
    const port = chrome.tabs.connect(id, { name: 'dsi-session' });
    port.onDisconnect.addListener(() => sessions.delete(id));
    sessions.set(id, port);
  };

  const target = async (): Promise<chrome.tabs.Tab> => (tabId !== undefined ? chrome.tabs.get(tabId) : activeTab());

  return {
    async analyze() {
      const tab = await target().catch((e) => {
        if (lastTabId !== undefined) send(lastTabId, { type: 'dsi:clear' }).catch(() => undefined);
        lastTabId = undefined;
        throw e;
      });
      // When following the active tab, drop any highlight or picker left on the tab we were inspecting.
      if (lastTabId !== undefined && lastTabId !== tab.id) {
        send(lastTabId, { type: 'dsi:clear' }).catch(() => undefined);
        send(lastTabId, { type: 'dsi:pick-cancel' }).catch(() => undefined);
      }
      lastTabId = tab.id;
      try {
        await ensureInjected(tab.id!);
      } catch (e) {
        throw new InspectError(`Couldn’t access this page. ${(e as Error).message ?? ''}`.trim());
      }
      return send<AnalysisResult>(tab.id!, { type: 'dsi:analyze' });
    },
    async highlight(keys, label, color) {
      const tab = await target();
      return send<HighlightResponse>(tab.id!, { type: 'dsi:highlight', keys, label, color });
    },
    async clear() {
      const tab = await target().catch(() => null);
      if (tab?.id) await send(tab.id, { type: 'dsi:clear' }).catch(() => undefined);
    },
    async pick() {
      const tab = await target();
      connect(tab.id!);
      try {
        return await send<FocusInfo | null>(tab.id!, { type: 'dsi:pick' });
      } catch {
        return null; // the page navigated away while picking
      }
    },
    async cancelPick() {
      const id = lastTabId ?? (await target().catch(() => null))?.id;
      if (id !== undefined) await send(id, { type: 'dsi:pick-cancel' }).catch(() => undefined);
    },
    async pickKey(key) {
      const id = lastTabId ?? (await target().catch(() => null))?.id;
      if (id !== undefined) await send(id, { type: 'dsi:pick-key', key }).catch(() => undefined);
    },
    async focusParent() {
      const tab = await target();
      return send<FocusInfo | null>(tab.id!, { type: 'dsi:focus-parent' });
    },
    async unfocus() {
      const tab = await target().catch(() => null);
      if (tab?.id) await send(tab.id, { type: 'dsi:unfocus' }).catch(() => undefined);
    },
    onPageChange(cb) {
      if (tabId !== undefined) {
        // Docked panel: full reloads recreate the panel; this catches in-page (SPA) navigations.
        const onUpdated = (id: number, info: { status?: string }) => {
          if (id === tabId && info.status === 'complete') cb();
        };
        chrome.tabs.onUpdated.addListener(onUpdated);
        return () => chrome.tabs.onUpdated.removeListener(onUpdated);
      }
      // A browser sidebar belongs to one window; ignore tab events from other windows.
      let windowId: number | undefined;
      chrome.windows.getCurrent().then((w) => (windowId = w.id), () => undefined);
      const mine = (id: number) => windowId === undefined || id === windowId;
      const onActivated = (info: { windowId: number }) => {
        if (mine(info.windowId)) cb();
      };
      const onUpdated = (_id: number, info: { status?: string }, tab: chrome.tabs.Tab) => {
        if (info.status === 'complete' && tab.active && mine(tab.windowId)) cb();
      };
      chrome.tabs.onActivated.addListener(onActivated);
      chrome.tabs.onUpdated.addListener(onUpdated);
      return () => {
        chrome.tabs.onActivated.removeListener(onActivated);
        chrome.tabs.onUpdated.removeListener(onUpdated);
      };
    },
    // The docked panel's host page listens for these (it checks the message comes from this iframe).
    collapse: tabId !== undefined ? () => window.parent.postMessage({ dsi: 'collapse' }, '*') : undefined,
    close: tabId !== undefined ? () => window.parent.postMessage({ dsi: 'close' }, '*') : undefined,
  };
}
