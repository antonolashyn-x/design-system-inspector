// Docked inspector panel: the sidebar UI (sidebar.html) in an iframe fixed to
// the right edge of the page. Used where the browser can't open its own
// sidebar from the toolbar icon (Opera). The iframe is an extension page, so
// the page's scripts can't read it.
//
// States: closed (nothing in the page) -> open -> collapsed (iframe hidden,
// a small handle on the right edge expands it again). Collapsing keeps the
// on-page highlight; closing removes everything.

export const PANEL_HOST_ID = '__dsi-panel-host__';
export const HANDLE_HOST_ID = '__dsi-panel-handle__';

const MIN_W = 320;
const MAX_W = 1100; // wide enough for the full typography table
let width = 380;
let collapsed = false;
let frame: HTMLIFrameElement | null = null;

const PANEL_STYLES = `
:host { all: initial; }
.panel {
  position: fixed; top: 0; right: 0; height: 100vh; z-index: 2147483647;
  display: flex; background: #fff; border-left: 1px solid #444;
  box-shadow: -4px 0 16px rgba(0,0,0,.35);
}
iframe { flex: 1; width: 100%; height: 100%; border: 0; display: block; color-scheme: normal; }
.grip { position: absolute; left: -4px; top: 0; bottom: 0; width: 8px; cursor: ew-resize; z-index: 1; }
/* Keeps pointer events away from the iframe while resizing. */
.shield { display: none; position: fixed; inset: 0; cursor: ew-resize; }
.dragging .shield { display: block; }
`;

const HANDLE_STYLES = `
button {
  all: unset; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 6px;
  background: #111827; color: #fff; padding: 10px 6px; border-radius: 8px 0 0 8px;
  font: 600 11px ui-sans-serif, system-ui, sans-serif; box-shadow: -2px 2px 10px rgba(0,0,0,.35);
}
button:hover { background: #1f2937; }
span { writing-mode: vertical-rl; }
`;

const panelHost = () => document.getElementById(PANEL_HOST_ID);
export const isPanelOpen = () => !!panelHost();

function handleHost(): HTMLElement {
  let host = document.getElementById(HANDLE_HOST_ID);
  if (host) return host;
  host = document.createElement('div');
  host.id = HANDLE_HOST_ID;
  host.style.cssText = 'position:fixed;right:0;top:50%;transform:translateY(-50%);z-index:2147483647;display:none';
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = HANDLE_STYLES;
  const button = document.createElement('button');
  button.title = 'Expand Design System Inspector';
  button.append('‹');
  const label = document.createElement('span');
  label.textContent = 'DS Inspector';
  button.append(label);
  button.addEventListener('click', () => setCollapsed(false));
  root.append(style, button);
  document.documentElement.appendChild(host);
  return host;
}

export function setCollapsed(v: boolean) {
  collapsed = v;
  const host = panelHost();
  if (host) host.style.display = v ? 'none' : '';
  handleHost().style.display = v && host ? 'block' : 'none';
}

export function closePanel() {
  panelHost()?.remove();
  frame = null;
  setCollapsed(false);
}

export function openPanel(tabId: number) {
  if (isPanelOpen()) return setCollapsed(false);

  const host = document.createElement('div');
  host.id = PANEL_HOST_ID;
  const root = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = PANEL_STYLES;

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.style.width = `${width}px`;

  frame = document.createElement('iframe');
  frame.src = chrome.runtime.getURL(`sidebar.html?tabId=${tabId}`);
  frame.title = 'Design System Inspector';
  frame.allow = 'clipboard-write';

  const grip = document.createElement('div');
  grip.className = 'grip';
  grip.title = 'Drag to resize';
  const shield = document.createElement('div');
  shield.className = 'shield';

  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    panel.classList.add('dragging');
    const move = (ev: PointerEvent) => {
      width = Math.round(Math.min(MAX_W, Math.max(MIN_W, window.innerWidth - ev.clientX)));
      panel.style.width = `${width}px`;
    };
    const up = () => {
      panel.classList.remove('dragging');
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  });

  panel.append(grip, frame, shield);
  root.append(style, panel);
  document.documentElement.appendChild(host);
  setCollapsed(false);
}

/** Toolbar click: open, expand if collapsed, or close. Returns whether the panel is open afterwards. */
export function togglePanel(tabId: number): boolean {
  if (isPanelOpen() && collapsed) {
    setCollapsed(false);
    return true;
  }
  if (isPanelOpen()) {
    closePanel();
    return false;
  }
  openPanel(tabId);
  return true;
}

/**
 * Collapse/close requests from the panel's own header buttons. Only messages
 * coming from our iframe are honoured. `onClose` lets the caller clean up.
 */
export function listenToPanel(onClose: () => void) {
  window.addEventListener('message', (e) => {
    if (!frame || e.source !== frame.contentWindow) return;
    const action = (e.data as { dsi?: string } | null)?.dsi;
    if (action === 'collapse') setCollapsed(true);
    if (action === 'close') {
      closePanel();
      onClose();
    }
  });
}
