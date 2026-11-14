import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

// Translations load first (font.js fetches locales/<lang>.json), then the app is imported, so even
// module-level labels come out in the reader's language. A slow or missing dictionary never blocks
// the app for long: it falls back to English after 3 s.
const translationsReady = Promise.race([window.appFont?.ready || Promise.resolve(), new Promise((r) => setTimeout(r, 3000))]).catch(() => {});
translationsReady.then(async () => {
  const [{ default: App }, { PlayerProvider }] = await Promise.all([import('./App.jsx'), import('./components/usePlayer.js')]);
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <PlayerProvider>
        <App />
      </PlayerProvider>
    </StrictMode>,
  );
});

// Let the maker's app portal know (same-origin localStorage) that this app is installed.
try {
  const dm = ['standalone', 'minimal-ui', 'fullscreen', 'window-controls-overlay'];
  if (navigator.standalone || dm.some((m) => matchMedia(`(display-mode: ${m})`).matches)) {
    const k = 'portal-installed', reg = JSON.parse(localStorage.getItem(k) || '{}');
    reg.MusicStudio = Date.now();
    localStorage.setItem(k, JSON.stringify(reg));
  }
} catch { /* private mode — ignore */ }

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
