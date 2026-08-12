import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// PWA: register the offline service worker in production only. In dev, unregister any stale worker
// and drop its caches so it can never serve outdated modules.
if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    // BASE_URL keeps this correct under a GitHub Pages project path (/MusicStudio/) as well as at root.
    window.addEventListener('load', () => { navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {}); });
  } else {
    navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
    if (window.caches) caches.keys().then((ks) => ks.forEach((k) => caches.delete(k))).catch(() => {});
  }
}
