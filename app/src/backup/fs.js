// Local backup folder via the File System Access API (Chrome/Edge, secure context). The user picks a
// real folder once; the handle is persisted in IndexedDB and reused to auto-write every clip the
// studio creates, plus the album export. No data leaves the device. Graceful download fallback.

export function dirPickerSupported() { return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'; }

export async function pickBackupDir() {
  if (!dirPickerSupported()) throw new Error('This browser has no folder access — use Chrome or Edge.');
  return await window.showDirectoryPicker({ mode: 'readwrite', id: 'musicstudio-backup' });
}

// Ensure we still have write permission on a persisted handle (re-prompts if the grant lapsed).
// Background writers use this: never prompts (a prompt needs a click), just reports.
export async function canWriteQuietly(handle) { try { return (await handle?.queryPermission?.({ mode: 'readwrite' })) === 'granted'; } catch { return false; } }

export async function ensureWritable(handle) {
  if (!handle) return false;
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission?.(opts)) === 'granted') return true;
  return (await handle.requestPermission?.(opts)) === 'granted';
}

// Write a blob to `path` (may contain "/" to nest folders) under dirHandle. Creates folders as needed.
export async function writeToDir(dirHandle, path, blob) {
  const parts = path.split('/').filter(Boolean);
  const name = parts.pop();
  let dir = dirHandle;
  for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: true });
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(blob);
  await w.close();
}

// Read a text file (e.g. an agent-edited album.json) back from the folder. Throws if absent.
export async function readTextFrom(dirHandle, path) {
  const parts = path.split('/').filter(Boolean);
  const name = parts.pop();
  let dir = dirHandle;
  for (const p of parts) dir = await dir.getDirectoryHandle(p);
  const fh = await dir.getFileHandle(name);
  return await (await fh.getFile()).text();
}

// List file names directly inside `path` (not recursive). Empty array if the folder doesn't exist.
export async function listFiles(dirHandle, path) {
  let dir = dirHandle;
  try { for (const p of path.split('/').filter(Boolean)) dir = await dir.getDirectoryHandle(p); } catch { return []; }
  const names = [];
  for await (const [name, h] of dir.entries()) if (h.kind === 'file') names.push(name);
  return names;
}

// Read a file as a Blob (for backfilling pre-existing audio referenced by album.json). Throws if absent.
export async function readBlobFrom(dirHandle, path) {
  const parts = path.split('/').filter(Boolean);
  const name = parts.pop();
  let dir = dirHandle;
  for (const p of parts) dir = await dir.getDirectoryHandle(p);
  return await (await dir.getFileHandle(name)).getFile();
}

// Delete a file (or empty dir) under dirHandle (best-effort; caller catches).
export async function removeFromDir(dirHandle, path) {
  const parts = path.split('/').filter(Boolean);
  const name = parts.pop();
  let dir = dirHandle;
  for (const p of parts) dir = await dir.getDirectoryHandle(p);
  await dir.removeEntry(name);
}

// ── Directory ops so the on-disk tree can mirror the app's group tree in real time ──────────────
async function dirByPath(root, path) { let d = root; for (const p of path.split('/').filter(Boolean)) d = await d.getDirectoryHandle(p); return d; }

// Create a (possibly nested) folder, no-op if it exists.
export async function ensureDir(root, path) { let d = root; for (const p of path.split('/').filter(Boolean)) d = await d.getDirectoryHandle(p, { create: true }); return d; }

// List top-level folders of a directory, noting which contain an .m3u (the app-published marker).
export async function listAlbumDirs(dirHandle) {
  const out = [];
  for await (const [name, h] of dirHandle.entries()) {
    if (h.kind !== 'directory') continue;
    let hasM3u = false;
    for await (const [n2, h2] of h.entries()) if (h2.kind === 'file' && /\.m3u$/i.test(n2)) { hasM3u = true; break; }
    out.push({ name, hasM3u });
  }
  return out;
}

// Recursively delete a folder and everything in it (used when an album is deleted).
export async function removeDir(root, path) {
  const parts = path.split('/').filter(Boolean);
  const name = parts.pop();
  let dir = root; for (const p of parts) dir = await dir.getDirectoryHandle(p);
  await dir.removeEntry(name, { recursive: true });
}

async function copyDir(src, dest) {
  for await (const [name, h] of src.entries()) {
    if (h.kind === 'file') { const f = await h.getFile(); const fh = await dest.getFileHandle(name, { create: true }); const w = await fh.createWritable(); await w.write(f); await w.close(); }
    else { await copyDir(h, await dest.getDirectoryHandle(name, { create: true })); }
  }
}

// Move/rename a folder from one path to another. Uses the native move() when available, else copies
// recursively and removes the source. No-op if the source doesn't exist yet (nothing written there).
export async function moveDir(root, fromPath, toPath) {
  if (fromPath === toPath) return;
  let src; try { src = await dirByPath(root, fromPath); } catch { return; }
  const toParts = toPath.split('/').filter(Boolean);
  const newName = toParts.pop();
  let destParent = root; for (const p of toParts) destParent = await destParent.getDirectoryHandle(p, { create: true });
  if (typeof src.move === 'function') { try { await src.move(destParent, newName); return; } catch { /* fall back to copy */ } }
  const dest = await destParent.getDirectoryHandle(newName, { create: true });
  await copyDir(src, dest);
  const fromParts = fromPath.split('/').filter(Boolean); const srcName = fromParts.pop();
  let srcParent = root; for (const p of fromParts) srcParent = await srcParent.getDirectoryHandle(p);
  await srcParent.removeEntry(srcName, { recursive: true });
}

// Refuse to back up INTO the running app. The File System Access API deliberately hides absolute
// paths, so detect the app by its fingerprint files rather than by path. ponytail: heuristic, not a
// path check — tightens if the app layout changes.
export async function looksLikeAppFolder(dirHandle) {
  const names = new Set();
  try { for await (const [n] of dirHandle.entries()) names.add(n); } catch { return false; }
  if (names.has('vite.config.js') || names.has('node_modules') || (names.has('package.json') && names.has('index.html'))) return true;
  if (names.has('app')) { // repo root holding the app/ folder
    try {
      const app = await dirHandle.getDirectoryHandle('app');
      const kids = new Set(); for await (const [n] of app.entries()) kids.add(n);
      if (kids.has('vite.config.js') || kids.has('package.json')) return true;
    } catch { /* not readable — treat as safe */ }
  }
  return false;
}

// Discover the album structure ON DISK (e.g. groups/albums a separate Claude Code session created):
// walk the tree, treat any folder containing an `album.json` as an album (its ancestry = its groups),
// and every other folder as a group. `ignored` = root-level folder names to skip entirely. Returns
// { albums:[{ groupPath:[names], folderName, json }], rootFolders:[names] }.
export async function scanAlbums(root, ignored = []) {
  const ignoreSet = new Set(ignored);
  const albums = []; const rootFolders = [];
  async function walk(dir, parts) {
    let albumFile = null; const subdirs = [];
    for await (const [name, h] of dir.entries()) {
      if (h.kind === 'file') { if (name === 'album.json') albumFile = h; }
      else subdirs.push([name, h]);
    }
    if (albumFile) { // this folder is an album — don't descend into its internals (attachments/)
      try { const json = JSON.parse(await (await albumFile.getFile()).text()); albums.push({ groupPath: parts.slice(0, -1), folderName: parts[parts.length - 1] || '', json }); }
      catch { /* skip unparseable album.json */ }
      return;
    }
    for (const [name, h] of subdirs) {
      if (parts.length === 0) { rootFolders.push(name); if (ignoreSet.has(name)) continue; }
      if (name === 'attachments') continue;
      await walk(h, [...parts, name]);
    }
  }
  await walk(root, []);
  return { albums, rootFolders };
}

// Fallback: a plain browser download (used when no folder is set / unsupported).
export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function pickFile(accept = 'audio/*') {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept; input.multiple = true;
    input.onchange = () => resolve([...(input.files || [])]);
    input.oncancel = () => resolve([]);
    input.click();
  });
}
