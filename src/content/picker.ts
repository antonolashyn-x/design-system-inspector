// Inspect mode: pick an element on the page with the cursor, then keep it as the
// "focus" so the analysis only covers that element and its descendants.
//
// While picking, pointer events are swallowed in the capture phase so links and
// buttons don't fire. ↑ / ↓ walk to the parent / back to the child, Enter picks,
// Esc cancels. The focused element keeps a dashed outline and the rest of the
// page is dimmed until focus is cleared.

import type { FocusInfo } from '../shared/types';
import { HANDLE_HOST_ID, PANEL_HOST_ID } from './panel';

export const PICKER_HOST_ID = '__dsi-picker-host__';
export const FOCUS_HOST_ID = '__dsi-focus-host__';

const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

const PICKER_STYLES = `
:host { all: initial; }
.box {
  position: fixed; left: 0; top: 0; box-sizing: border-box; pointer-events: none; z-index: 2147483646;
  outline: 2px solid #7c5cff; outline-offset: -1px; background: rgba(124, 92, 255, 0.14); display: none;
}
.tag {
  position: fixed; left: 0; top: 0; pointer-events: none; z-index: 2147483646; display: none;
  padding: 3px 7px; border-radius: 5px; background: #7c5cff; color: #fff; white-space: nowrap;
  font: 600 11px/1.3 ${FONT}; box-shadow: 0 2px 8px rgba(0,0,0,.2);
}
.tag .dim { font-weight: 500; opacity: .75; margin-left: 6px; }
.hint {
  position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); pointer-events: none; z-index: 2147483647;
  padding: 8px 14px; border-radius: 999px; background: rgba(17, 17, 24, 0.92); color: #fff; white-space: nowrap;
  font: 500 12px/1.2 ${FONT}; box-shadow: 0 10px 30px rgba(0,0,0,.25), 0 0 0 1px rgba(255,255,255,.08) inset;
}
.hint b { font-weight: 600; }
.hint .dim { color: rgba(255,255,255,.6); }
`;

const FOCUS_STYLES = `
:host { all: initial; }
.box {
  position: fixed; left: 0; top: 0; box-sizing: border-box; pointer-events: none; z-index: 2147483645;
  outline: 2px dashed #7c5cff; outline-offset: 2px; border-radius: 2px;
  box-shadow: 0 0 0 100vmax rgba(10, 10, 20, 0.28);
}
.tag {
  position: absolute; left: -2px; bottom: calc(100% + 6px); padding: 2px 7px; border-radius: 5px;
  background: #7c5cff; color: #fff; white-space: nowrap; font: 600 11px/1.3 ${FONT};
}
.box.flip .tag { bottom: auto; top: calc(100% + 6px); }
`;

// ---- Describing elements ----------------------------------------------------

function label(el: Element): string {
  let s = el.tagName.toLowerCase();
  if (el.id && el.id.length <= 32) s += `#${el.id}`;
  const classes = Array.from(el.classList).filter((c) => c.length <= 28 && !/^(css|sc|jsx|svelte)-/.test(c));
  if (classes.length) s += classes.slice(0, 2).map((c) => `.${c}`).join('');
  return s;
}

function size(el: Element) {
  const r = el.getBoundingClientRect();
  return { width: Math.round(r.width), height: Math.round(r.height) };
}

const isTop = (el: Element) => el === document.documentElement || el === document.body;

export function describe(el: Element): FocusInfo {
  const path: string[] = [];
  for (let p: Element | null = el; p && p !== document.documentElement; p = p.parentElement) path.unshift(label(p));
  return { label: label(el), path: path.join(' › '), ...size(el), hasParent: !isTop(el) };
}

const isOurs = (el: Element) => !!el.closest(`#${PANEL_HOST_ID}, #${HANDLE_HOST_ID}, #${PICKER_HOST_ID}, #${FOCUS_HOST_ID}`);

// ---- Focus ------------------------------------------------------------------

let focused: Element | null = null;
let focusUi: { host: HTMLElement; box: HTMLElement; tag: HTMLElement; raf: number } | null = null;

/** The focused element, if it is still in the document. */
export function focusedElement(): Element | null {
  if (focused && !focused.isConnected) clearFocus();
  return focused;
}

function tickFocus() {
  if (!focusUi || !focused) return;
  const r = focused.getBoundingClientRect();
  const { box } = focusUi;
  box.style.transform = `translate(${r.left}px, ${r.top}px)`;
  box.style.width = `${r.width}px`;
  box.style.height = `${r.height}px`;
  box.classList.toggle('flip', r.top < 28);
  focusUi.raf = requestAnimationFrame(tickFocus);
}

export function setFocus(el: Element) {
  focused = el;
  if (!focusUi) {
    const host = document.createElement('div');
    host.id = FOCUS_HOST_ID;
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = FOCUS_STYLES;
    const box = document.createElement('div');
    box.className = 'box';
    const tag = document.createElement('div');
    tag.className = 'tag';
    box.appendChild(tag);
    root.append(style, box);
    document.documentElement.appendChild(host);
    focusUi = { host, box, tag, raf: 0 };
    tickFocus();
  }
  focusUi.tag.textContent = `Focus · ${label(el)}`;
}

export function clearFocus() {
  focused = null;
  if (!focusUi) return;
  cancelAnimationFrame(focusUi.raf);
  focusUi.host.remove();
  focusUi = null;
}

/** Widens the focus to the parent element. Returns the new focus, or null when nothing is focused. */
export function focusParent(): FocusInfo | null {
  const el = focusedElement();
  if (!el) return null;
  if (!isTop(el) && el.parentElement) setFocus(el.parentElement);
  return describe(focused!);
}

// ---- Picking ----------------------------------------------------------------

interface Picker {
  host: HTMLElement;
  cursor: HTMLStyleElement;
  box: HTMLElement;
  tag: HTMLElement;
  hovered: Element | null;
  /** Children walked up from with ↑, so ↓ can go back down. */
  trail: Element[];
  raf: number;
  resolve: (info: FocusInfo | null) => void;
}

let picker: Picker | null = null;

function tickPicker() {
  if (!picker) return;
  const { box, tag, hovered } = picker;
  if (!hovered || !hovered.isConnected) {
    box.style.display = tag.style.display = 'none';
  } else {
    const r = hovered.getBoundingClientRect();
    box.style.display = tag.style.display = 'block';
    box.style.transform = `translate(${r.left}px, ${r.top}px)`;
    box.style.width = `${r.width}px`;
    box.style.height = `${r.height}px`;
    const th = tag.offsetHeight || 20;
    const tw = tag.offsetWidth || 120;
    const x = Math.max(4, Math.min(r.left, window.innerWidth - tw - 4));
    const y = r.top - th - 4 >= 4 ? r.top - th - 4 : Math.min(r.bottom + 4, window.innerHeight - th - 4);
    tag.style.transform = `translate(${x}px, ${y}px)`;
  }
  picker.raf = requestAnimationFrame(tickPicker);
}

function hover(el: Element | null) {
  if (!picker || el === picker.hovered) return;
  picker.hovered = el;
  if (!el) return;
  const { width, height } = size(el);
  picker.tag.textContent = label(el);
  const dim = document.createElement('span');
  dim.className = 'dim';
  dim.textContent = `${width} × ${height}`;
  picker.tag.appendChild(dim);
}

function targetOf(e: Event): Element | null {
  const t = e.target;
  return t instanceof Element && !isOurs(t) ? t : null;
}

function onMove(e: PointerEvent) {
  const el = targetOf(e);
  if (!el || !picker) return;
  if (el !== picker.hovered) picker.trail = [];
  hover(el);
}

/** Swallows presses so the page doesn't react (navigate, open menus) while picking. */
function onPress(e: Event) {
  if (!targetOf(e)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
}

function onClick(e: MouseEvent) {
  const el = targetOf(e);
  if (!el) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  // Keep the element chosen with ↑ if the click lands inside it.
  pick(picker?.hovered?.contains(el) ? picker.hovered : el);
}

/**
 * Keyboard control while picking: ↑ parent, ↓ back to the child, Enter picks, Esc cancels.
 * Also called with keys pressed in the inspector UI, which usually has keyboard focus.
 * Returns whether the key was handled.
 */
export function pickKey(key: string): boolean {
  if (!picker) return false;
  const { hovered } = picker;
  if (key === 'Escape') cancelPick();
  else if (key === 'Enter' && hovered) pick(hovered);
  else if (key === 'ArrowUp' && hovered && !isTop(hovered) && hovered.parentElement) {
    picker.trail.push(hovered);
    hover(hovered.parentElement);
  } else if (key === 'ArrowDown' && picker.trail.length) hover(picker.trail.pop()!);
  else return key === 'ArrowUp' || key === 'ArrowDown' || key === 'Enter';
  return true;
}

function onKey(e: KeyboardEvent) {
  if (!pickKey(e.key)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
}

const PRESS_EVENTS = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick', 'contextmenu', 'auxclick'] as const;

function stop(result: Element | null) {
  if (!picker) return;
  const { host, cursor, raf, resolve } = picker;
  picker = null;
  cancelAnimationFrame(raf);
  host.remove();
  cursor.remove();
  window.removeEventListener('pointermove', onMove, true);
  window.removeEventListener('click', onClick, true);
  window.removeEventListener('keydown', onKey, true);
  for (const t of PRESS_EVENTS) window.removeEventListener(t, onPress, true);
  if (result) setFocus(result);
  resolve(result ? describe(result) : null);
}

function pick(el: Element) {
  stop(el);
}

export function cancelPick() {
  stop(null);
}

export const isPicking = () => !!picker;

/** Starts inspect mode. Resolves with the picked element, or null if cancelled. */
export function startPick(): Promise<FocusInfo | null> {
  cancelPick();
  return new Promise((resolve) => {
    const host = document.createElement('div');
    host.id = PICKER_HOST_ID;
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = PICKER_STYLES;
    const box = document.createElement('div');
    box.className = 'box';
    const tag = document.createElement('div');
    tag.className = 'tag';
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.innerHTML = '<b>Click an element to focus on it</b> <span class="dim">· ↑ ↓ parent / child · Esc cancel</span>';
    root.append(style, box, tag, hint);
    document.documentElement.appendChild(host);

    const cursor = document.createElement('style');
    cursor.textContent = '*, *::before, *::after { cursor: crosshair !important; }';
    document.documentElement.appendChild(cursor);

    picker = { host, cursor, box, tag, hovered: null, trail: [], raf: 0, resolve };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKey, true);
    for (const t of PRESS_EVENTS) window.addEventListener(t, onPress, true);
    tickPicker();
  });
}
