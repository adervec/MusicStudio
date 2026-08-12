// Google Drive sync channel — the SMALL JSON side of the pipeline (catalog + requests), stored in
// Drive's private appDataFolder. The actual audio never goes through here: it reaches the phone via
// the local publish folder + your desktop Drive/AutoSync client. This channel only carries
// "here's the library" (desktop → phone) and "please sync these" (phone → desktop).
//
// Adapted from Tachyread's syncProviders.js — same Google Identity Services token flow.

// Public OAuth client id (an identifier, not a secret). Registered for the https://adervec.github.io
// JavaScript origin, which every project site on that user's Pages shares — so Music Studio works
// there with zero setup. A fork on another origin must supply its own id in Settings.
// ponytail: shared with the other apps on that origin, so they share one appDataFolder — file names
// below are app-prefixed to keep them apart. Own client id if that ever matters.
export const BUILTIN_DRIVE_CLIENT_ID = '547617739897-br6dj2facmsc34qnkjb5u4dbfhju39pu.apps.googleusercontent.com';
const OAUTH_ORIGINS = ['https://adervec.github.io'];

export const CATALOG_FILE = 'musicstudio-catalog.json';   // desktop writes, phone reads
export const REQUEST_FILE = 'musicstudio-requests.json';  // phone writes, desktop reads

export function driveOriginAllowed() {
  try {
    const h = location.hostname;
    if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]') return true; // local dev, any port
    return OAUTH_ORIGINS.indexOf(location.origin) !== -1;
  } catch { return false; }
}
export function driveClientId(cfg) {
  return (cfg?.driveClientId || '').trim() || (driveOriginAllowed() ? BUILTIN_DRIVE_CLIENT_ID : '');
}

let gisLoaded = null;
function loadGis() {
  if (gisLoaded) return gisLoaded;
  gisLoaded = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load Google sign-in.'));
    document.head.appendChild(s);
  });
  return gisLoaded;
}

const SCOPE = 'openid email profile https://www.googleapis.com/auth/drive.appdata';
let _token = null;   // { value, exp } — memory only, never persisted
let _profile = null; // { name, email, picture } — cosmetic
const tokenValid = () => !!_token && _token.exp > Date.now() + 60000;
export function driveProfile() { return _profile; }
export function driveConnected() { return tokenValid(); }

async function fetchProfile(token) {
  try {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) { const j = await r.json(); _profile = { name: j.name || j.email || 'Google account', email: j.email || '', picture: j.picture || '' }; }
  } catch { /* cosmetic only */ }
  return _profile;
}

function requestToken(clientId, prompt = '') {
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId, scope: SCOPE,
      callback: (resp) => {
        if (resp?.access_token) { _token = { value: resp.access_token, exp: Date.now() + ((resp.expires_in || 3600) * 1000) }; resolve(resp.access_token); }
        else reject(new Error(resp?.error || 'Sign-in failed.'));
      },
      // Without this a dismissed/blocked popup would hang the promise forever.
      error_callback: (err) => reject(new Error(err?.message || err?.type || 'Sign-in was dismissed.')),
    });
    client.requestAccessToken({ prompt });
  });
}

// `silent` (boot / background poll) only reuses an existing grant — it never opens a popup.
export async function driveConnect(cfg, { silent = false } = {}) {
  const clientId = driveClientId(cfg);
  if (!clientId) throw new Error('Google Drive sync isn’t enabled on this deployment — add your own OAuth client ID in Settings.');
  if (tokenValid()) { if (!_profile) await fetchProfile(_token.value); return _token.value; }
  await loadGis();
  let token;
  try { token = await requestToken(clientId, ''); }          // silent: existing grant
  catch (e) { if (silent) throw e; token = await requestToken(clientId, 'consent'); }
  await fetchProfile(token);
  return token;
}
export function driveDisconnect() { _token = null; _profile = null; }

async function findFile(name) {
  const q = encodeURIComponent(`name='${name}' and trashed=false`);
  const r = await fetch(`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,name,modifiedTime)`, { headers: { Authorization: `Bearer ${_token.value}` } });
  if (!r.ok) throw new Error(`Drive list failed (${r.status}).`);
  return (await r.json()).files?.[0] || null;
}

export async function driveUploadJson(name, obj) {
  const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
  const existing = (await findFile(name))?.id;
  const meta = existing ? {} : { name, parents: ['appDataFolder'] };
  // Drive caps multipart at 5 MB; a big catalog goes resumable (init → one PUT).
  if (blob.size > 4 * 1024 * 1024) {
    const initUrl = existing
      ? `https://www.googleapis.com/upload/drive/v3/files/${existing}?uploadType=resumable`
      : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable';
    const init = await fetch(initUrl, {
      method: existing ? 'PATCH' : 'POST',
      headers: { Authorization: `Bearer ${_token.value}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/json' },
      body: JSON.stringify(meta),
    });
    if (!init.ok) throw new Error(`Drive upload init failed (${init.status}).`);
    const session = init.headers.get('Location');
    if (!session) throw new Error('Drive upload init returned no session URL.');
    const put = await fetch(session, { method: 'PUT', body: blob });
    if (!put.ok) throw new Error(`Drive upload failed (${put.status}).`);
    return blob.size;
  }
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
  form.append('file', blob);
  const url = existing
    ? `https://www.googleapis.com/upload/drive/v3/files/${existing}?uploadType=multipart`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
  const r = await fetch(url, { method: existing ? 'PATCH' : 'POST', headers: { Authorization: `Bearer ${_token.value}` }, body: form });
  if (!r.ok) throw new Error(`Drive upload failed (${r.status}).`);
  return blob.size;
}

export async function driveDownloadJson(name) {
  const f = await findFile(name);
  if (!f) return null;
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`, { headers: { Authorization: `Bearer ${_token.value}` } });
  if (!r.ok) return null;
  try { return JSON.parse(await r.text()); }
  catch { throw new Error(`The ${name} sync file is corrupt — re-push it from the desktop.`); }
}

// Cheap change probe: one metadata query, no body. null = file doesn't exist yet.
export async function driveStat(name) {
  const f = await findFile(name);
  return f?.modifiedTime ? Date.parse(f.modifiedTime) : null;
}
