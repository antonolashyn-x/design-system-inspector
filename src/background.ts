// Toolbar icon behaviour.
//
// - Chrome / Edge / Brave: opens the browser's native side panel (Side Panel API).
// - Opera (no Side Panel API, and no way to open its sidebar from an extension):
//   toggles the inspector docked inside the current page. The panel reopens after
//   navigations in that tab until it is closed.

const hasSidePanel = typeof chrome.sidePanel?.setPanelBehavior === 'function';
if (hasSidePanel) chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);

const OPEN_KEY = 'dsi-open-panels';

async function openTabs(): Promise<number[]> {
  const stored = await chrome.storage.session.get(OPEN_KEY);
  return (stored[OPEN_KEY] as number[] | undefined) ?? [];
}

async function setOpen(tabId: number, open: boolean) {
  const tabs = (await openTabs()).filter((id) => id !== tabId);
  if (open) tabs.push(tabId);
  await chrome.storage.session.set({ [OPEN_KEY]: tabs });
}

async function ensureInjected(tabId: number) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'dsi:ping' });
    if (res?.ok) return;
  } catch {
    /* not injected yet */
  }
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
}

function flashError(tabId: number) {
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#ff3d7f' });
  chrome.action.setBadgeText({ tabId, text: '!' });
  chrome.action.setTitle({ tabId, title: 'This page can’t be inspected (browser pages and extension stores are protected)' });
  setTimeout(() => {
    chrome.action.setBadgeText({ tabId, text: '' });
    chrome.action.setTitle({ tabId, title: 'Open Design System Inspector' });
  }, 3000);
}

chrome.action.onClicked.addListener(async (tab) => {
  // Only fires when the native side panel didn't handle the click.
  if (tab.id === undefined) return;
  try {
    await ensureInjected(tab.id);
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'dsi:panel-toggle', tabId: tab.id });
    await setOpen(tab.id, !!res?.data?.open);
  } catch {
    flashError(tab.id);
  }
});

// Keep the docked panel open across page loads in the same tab.
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status !== 'complete' || !(await openTabs()).includes(tabId)) return;
  try {
    await ensureInjected(tabId);
    await chrome.tabs.sendMessage(tabId, { type: 'dsi:panel-open', tabId });
  } catch {
    /* navigated to a protected page; reopen when back on a normal one */
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  setOpen(tabId, false);
});

// The close (×) button inside the docked panel (reported by the content script).
chrome.runtime.onMessage.addListener((msg: { type?: string }, sender) => {
  if (msg?.type === 'dsi:panel-closed' && sender.tab?.id !== undefined) setOpen(sender.tab.id, false);
});
