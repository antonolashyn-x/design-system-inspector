import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createChromeBridge } from './bridge';
import { applyStoredTheme } from './theme';
import './styles.css';

// `?tabId=` is set when the UI is docked inside a page (toolbar icon in Opera);
// without it the UI runs in the browser's own sidebar and follows the active tab.
const tabParam = new URLSearchParams(location.search).get('tabId');
const tabId = tabParam ? Number(tabParam) : undefined;

applyStoredTheme();
createRoot(document.getElementById('root')!).render(<App bridge={createChromeBridge(tabId)} />);
