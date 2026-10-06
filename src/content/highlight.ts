// On-page highlight overlay. Rendered in a closed-over shadow root so the
// page's CSS can't leak in, and positioned with fixed viewport coordinates
// that are refreshed every animation frame (handles scroll, sticky, resize).

export const OVERLAY_HOST_ID = '__dsi-overlay-host__';
const MAX_BOXES = 400;

const STYLES = `
:host { all: initial; }
.layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483646; }
.box {
  position: fixed; left: 0; top: 0; box-sizing: border-box; border-radius: 3px;
  outline: 2px solid #7c5cff; outline-offset: 1px;
  background: rgba(124, 92, 255, 0.12);
  transition: outline-color .15s, background .15s;
}
.box.current { outline: 3px solid #ff3d7f; background: rgba(255, 61, 127, 0.16); animation: pulse 1s ease-out 1; }
@keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(255,61,127,.55); } 100% { box-shadow: 0 0 0 14px rgba(255,61,127,0); } }
.pill {
  position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%);
  display: flex; align-items: center; gap: 10px; pointer-events: auto;
  padding: 8px 8px 8px 14px; border-radius: 999px;
  background: rgba(17, 17, 24, 0.92); color: #fff; backdrop-filter: blur(8px);
  font: 500 12px/1.2 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  box-shadow: 0 10px 30px rgba(0,0,0,.25), 0 0 0 1px rgba(255,255,255,.08) inset;
  z-index: 2147483647; white-space: nowrap; max-width: calc(100vw - 32px);
}
.swatch { width: 14px; height: 14px; border-radius: 4px; box-shadow: 0 0 0 1px rgba(255,255,255,.35) inset; flex: none; }
.label { overflow: hidden; text-overflow: ellipsis; max-width: 340px; }
.muted { color: rgba(255,255,255,.6); }
button {
  all: unset; cursor: pointer; display: grid; place-items: center;
  width: 26px; height: 26px; border-radius: 999px; color: #fff; font-size: 14px;
}
button:hover { background: rgba(255,255,255,.14); }
.nav { display: flex; align-items: center; gap: 2px; padding-left: 6px; border-left: 1px solid rgba(255,255,255,.15); }
`;

interface State {
  host: HTMLElement;
  layer: HTMLElement;
  boxes: HTMLElement[];
  elements: Element[];
  counter: HTMLElement;
  index: number;
  raf: number;
}

let state: State | null = null;

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') clearHighlight();
}

function tick() {
  if (!state) return;
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  state.boxes.forEach((box, i) => {
    const el = state!.elements[i];
    if (!el.isConnected) {
      box.style.display = 'none';
      return;
    }
    const r = el.getBoundingClientRect();
    const off = r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw || (r.width === 0 && r.height === 0);
    box.style.display = off ? 'none' : 'block';
    if (!off) {
      box.style.transform = `translate(${r.left}px, ${r.top}px)`;
      box.style.width = `${r.width}px`;
      box.style.height = `${r.height}px`;
    }
  });
  state.raf = requestAnimationFrame(tick);
}

function focus(index: number) {
  if (!state || !state.elements.length) return;
  const n = state.elements.length;
  state.index = ((index % n) + n) % n;
  state.boxes.forEach((b, i) => b.classList.toggle('current', i === state!.index));
  state.counter.textContent = `${state.index + 1} / ${n}`;
  state.elements[state.index].scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
}

export function clearHighlight() {
  if (!state) return;
  cancelAnimationFrame(state.raf);
  state.host.remove();
  state = null;
  window.removeEventListener('keydown', onKey, true);
}

export function highlight(elements: Element[], label: string, color?: string): number {
  clearHighlight();
  const targets = elements.filter((el) => el.isConnected).slice(0, MAX_BOXES);
  if (!targets.length) return 0;

  const host = document.createElement('div');
  host.id = OVERLAY_HOST_ID;
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = STYLES;
  const layer = document.createElement('div');
  layer.className = 'layer';

  const boxes = targets.map(() => {
    const b = document.createElement('div');
    b.className = 'box';
    layer.appendChild(b);
    return b;
  });

  const pill = document.createElement('div');
  pill.className = 'pill';
  if (color) {
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = color;
    pill.appendChild(sw);
  }
  const text = document.createElement('span');
  text.className = 'label';
  text.textContent = label;
  const count = document.createElement('span');
  count.className = 'muted';
  count.textContent = `${elements.length} element${elements.length === 1 ? '' : 's'}${elements.length > MAX_BOXES ? ` (showing ${MAX_BOXES})` : ''}`;

  const nav = document.createElement('div');
  nav.className = 'nav';
  const prev = document.createElement('button');
  prev.textContent = '‹';
  prev.title = 'Previous element';
  const counter = document.createElement('span');
  counter.className = 'muted';
  const next = document.createElement('button');
  next.textContent = '›';
  next.title = 'Next element';
  const close = document.createElement('button');
  close.textContent = '✕';
  close.title = 'Clear highlight (Esc)';
  prev.onclick = () => focus((state?.index ?? 0) - 1);
  next.onclick = () => focus((state?.index ?? 0) + 1);
  close.onclick = () => clearHighlight();
  nav.append(prev, counter, next, close);
  pill.append(text, count, nav);

  root.append(style, layer, pill);
  document.documentElement.appendChild(host);

  state = { host, layer, boxes, elements: targets, counter, index: 0, raf: 0 };
  window.addEventListener('keydown', onKey, true);
  tick();
  focus(0);
  return elements.length;
}
