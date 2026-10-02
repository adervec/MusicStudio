// IndexedDB persistence (via idb) for the whole studio: projects (albums + their track list),
// audio clip blobs, the API-spend log, the local backup-folder handle, and settings (API key + prefs).
// Everything lives on-device. Pattern mirrors Tachyread's storage layer.
import { openDB } from 'idb';

const DB_NAME = 'MusicStudio';
const DB_VERSION = 4;

let _db = null;
function getDB() {
  if (_db) return _db;
  _db = openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // create-if-missing so the same handler works for a fresh DB and a v1→v2 upgrade
      const ensure = (name, opts) => { if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, opts); };
      ensure('projects', { keyPath: 'id' }); // album (parentId, description, meta) + inline tracks[]
      ensure('clips');   // clipId → Blob (generated/uploaded audio)
      ensure('usage', { keyPath: 'id', autoIncrement: true }); // spend log
      ensure('handles'); // 'backupDir' → FileSystemDirectoryHandle
      ensure('settings'); // 'apiKey' | 'prefs' → value
      ensure('groups', { keyPath: 'id' }); // { id, name, parentId, createdAt } — nested album groups
      ensure('attachments'); // attId → { kind:'note'|'file', text? , blob? } (style guides, refs, notes)
      ensure('playlists', { keyPath: 'id' }); // { id, name, kind:'static'|'dynamic', items[], rule{} }
    },
  });
  return _db;
}

export const uid = (p = '') => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

// ── Projects (albums) ──────────────────────────────────────────────────────────────────────────
export async function listProjects() {
  const db = await getDB();
  const all = await db.getAll('projects');
  return all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}
export async function getProject(id) {
  const db = await getDB();
  return (await db.get('projects', id)) || null;
}
// `keepTime` for moves: a new folder isn't new content, so device sync shouldn't republish it.
export async function saveProject(project, { keepTime = false } = {}) {
  const db = await getDB();
  const rec = { ...project, updatedAt: keepTime && project.updatedAt ? project.updatedAt : Date.now() };
  await db.put('projects', rec);
  return rec;
}
export async function deleteProject(id) {
  const db = await getDB();
  const p = await db.get('projects', id);
  for (const t of p?.tracks || []) if (t.clipId) await db.delete('clips', t.clipId);
  for (const a of p?.attachments || []) await db.delete('attachments', a.id);
  if (p?.cover?.id) await db.delete('clips', p.cover.id);
  await db.delete('projects', id);
}

// ── Attachments (style guides, inspirations, notes — hand- or AI-written) ──────────────────────
export async function putAttachment(id, payload) { const db = await getDB(); await db.put('attachments', payload, id); }
export async function getAttachment(id) { const db = await getDB(); return id ? await db.get('attachments', id) : null; }
export async function deleteAttachment(id) { const db = await getDB(); if (id) await db.delete('attachments', id); }

// ── Groups (nested album organization) ────────────────────────────────────────────────────────
export async function listGroups() { const db = await getDB(); return await db.getAll('groups'); }
export async function saveGroup(group) {
  const db = await getDB();
  const rec = { createdAt: Date.now(), ...group };
  await db.put('groups', rec);
  return rec;
}
export async function deleteGroup(id) { const db = await getDB(); await db.delete('groups', id); }

// ── Playlists (static curated lists + dynamic rule-based lists) ─────────────────────────────────
export async function listPlaylists() { const db = await getDB(); return (await db.getAll('playlists')).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)); }
export async function savePlaylist(pl) { const db = await getDB(); const rec = { ...pl, updatedAt: Date.now() }; await db.put('playlists', rec); return rec; }
export async function deletePlaylist(id) { const db = await getDB(); await db.delete('playlists', id); }

// ── Clip blobs ───────────────────────────────────────────────────────────────────────────────
export async function putClip(id, blob) { const db = await getDB(); await db.put('clips', blob, id); }
export async function getClip(id) { const db = await getDB(); return id ? await db.get('clips', id) : null; }
export async function deleteClip(id) { const db = await getDB(); if (id) await db.delete('clips', id); }

// ── API spend log (dashboard) ─────────────────────────────────────────────────────────────────
const USAGE_CAP = 5000;
export async function recordUsage(entry) {
  try {
    const db = await getDB();
    await db.add('usage', { ts: Date.now(), ...entry });
    const keys = await db.getAllKeys('usage');
    if (keys.length > USAGE_CAP) {
      const tx = db.transaction('usage', 'readwrite');
      for (const k of keys.slice(0, keys.length - USAGE_CAP)) await tx.store.delete(k);
      await tx.done;
    }
  } catch { /* logging is best-effort — must never break a generation */ }
}
export async function getUsage() {
  const db = await getDB();
  return (await db.getAll('usage')).sort((a, b) => (a.ts || 0) - (b.ts || 0));
}
export async function clearUsage() { const db = await getDB(); await db.clear('usage'); }

// ── Settings + the backup-folder handle ───────────────────────────────────────────────────────
export async function getSetting(key, fallback = null) {
  const db = await getDB();
  const v = await db.get('settings', key);
  return v === undefined ? fallback : v;
}
export async function setSetting(key, value) { const db = await getDB(); await db.put('settings', value, key); }

// ── Full app backup / restore (everything except the audio clips, which live in the backup folder and
// recover via a folder scan, and the folder handle, which isn't serializable). Binary values are
// base64-tagged so the whole thing is plain JSON. ──────────────────────────────────────────────────
const BACKUP_STORES = [['projects', true], ['groups', true], ['playlists', true], ['attachments', false], ['settings', false], ['usage', true]];
export function bufToB64(buf) {
  const bytes = new Uint8Array(buf); let bin = '';
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  return btoa(bin);
}
export function b64ToBuf(b64) {
  const bin = atob(b64 || ''); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
async function packVal(v) {
  if (v == null) return v;
  if (v instanceof Blob) return { __blob: 1, mime: v.type, b64: bufToB64(await v.arrayBuffer()) };
  if (Array.isArray(v)) { const o = []; for (const x of v) o.push(await packVal(x)); return o; }
  if (typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = await packVal(v[k]); return o; }
  return v;
}
function unpackVal(v) {
  if (v == null || typeof v !== 'object') return v;
  if (v.__blob) return new Blob([b64ToBuf(v.b64)], { type: v.mime || '' });
  if (Array.isArray(v)) return v.map(unpackVal);
  const o = {}; for (const k of Object.keys(v)) o[k] = unpackVal(v[k]); return o;
}
export async function exportAllData() {
  const db = await getDB();
  const out = { app: 'musicstudio', version: 1, exportedAt: Date.now(), stores: {} };
  for (const [name, inline] of BACKUP_STORES) {
    if (!db.objectStoreNames.contains(name)) continue;
    if (inline) { const rows = []; for (const r of await db.getAll(name)) rows.push(await packVal(r)); out.stores[name] = { inline: true, rows }; }
    else { const keys = await db.getAllKeys(name), vals = await db.getAll(name), entries = []; for (let i = 0; i < keys.length; i++) entries.push({ key: keys[i], value: await packVal(vals[i]) }); out.stores[name] = { inline: false, entries }; }
  }
  return out;
}
export async function importAllData(bundle, { replace = true } = {}) {
  if (!bundle || bundle.app !== 'musicstudio' || !bundle.stores) throw new Error('Not a Music Studio backup file.');
  const db = await getDB();
  for (const [name, inline] of BACKUP_STORES) {
    const s = bundle.stores[name]; if (!s || !db.objectStoreNames.contains(name)) continue;
    const tx = db.transaction(name, 'readwrite');
    if (replace) await tx.store.clear();
    if (inline) { for (const r of s.rows || []) await tx.store.put(unpackVal(r)); }
    else { for (const e of s.entries || []) await tx.store.put(unpackVal(e.value), e.key); }
    await tx.done;
  }
}

export async function getBackupDir() { const db = await getDB(); return (await db.get('handles', 'backupDir')) || null; }
export async function setBackupDir(handle) { const db = await getDB(); await db.put('handles', handle, 'backupDir'); }
export async function clearBackupDir() { const db = await getDB(); await db.delete('handles', 'backupDir'); }

// Publish folder — a second handle for the device-sync destination (e.g. a Google Drive folder a phone watches).
export async function getPublishDir() { const db = await getDB(); return (await db.get('handles', 'publishDir')) || null; }
export async function setPublishDir(handle) { const db = await getDB(); await db.put('handles', handle, 'publishDir'); }
export async function clearPublishDir() { const db = await getDB(); await db.delete('handles', 'publishDir'); }
