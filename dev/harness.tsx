import { createRoot } from 'react-dom/client';
import { App } from '../src/sidebar/App';
import type { Bridge } from '../src/sidebar/bridge';
import type { InspectorApi } from '../src/shared/types';
import { applyStoredTheme } from '../src/sidebar/theme';
import '../src/sidebar/styles.css';

applyStoredTheme();

const frame = document.getElementById('page') as HTMLIFrameElement;

async function api(): Promise<InspectorApi> {
  for (let i = 0; i < 100; i++) {
    const w = frame.contentWindow as (Window & { __DSI__?: InspectorApi }) | null;
    if (w?.__DSI__ && w.document.readyState === 'complete') return w.__DSI__;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('Fixture page did not load the analyzer');
}

const devBridge: Bridge = {
  analyze: async () => (await api()).analyze(),
  highlight: async (keys, label, color) => (await api()).highlight(keys, label, color),
  clear: async () => (await api()).clear(),
  pick: async () => (await api()).pick(),
  cancelPick: async () => (await api()).cancelPick(),
  pickKey: async (key) => (await api()).pickKey(key),
  focusParent: async () => (await api()).focusParent(),
  unfocus: async () => (await api()).unfocus(),
};

createRoot(document.getElementById('root')!).render(<App bridge={devBridge} />);
