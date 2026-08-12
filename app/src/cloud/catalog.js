// Pure catalog logic for the Drive sync channel. Two files, ONE writer each — so there is never a
// merge conflict to resolve:
//   catalog  — the desktop master publishes what the library holds + what's currently on the device
//   requests — the phone publishes the full set of album ids it WANTS on the device
// The desktop applies a request set by publishing/removing in its local publish folder; the phone
// sees the result on the next catalog it downloads.
import { albumFolderPath } from '../album/skeleton.js';

export const CATALOG_VERSION = 1;

// Trim a project to what a phone needs to browse it: description, metadata, and the tracklist with
// prompts. Audio never travels this channel — only text.
function albumEntry(p, groups, syncMap) {
  const tracks = p.tracks || [];
  const ready = tracks.filter((t) => t.clipId);
  return {
    id: p.id,
    title: p.title || 'Untitled',
    path: albumFolderPath(p, groups),
    artist: p.artist || '',
    description: p.description || '',
    meta: p.meta || {},
    updatedAt: p.updatedAt || 0,
    trackCount: tracks.length,
    readyCount: ready.length,
    ms: ready.reduce((s, t) => s + (t.durationMs || 0), 0),
    onDevice: !!syncMap?.[p.id]?.on,
    syncedAt: syncMap?.[p.id]?.at || 0,
    tracks: tracks.map((t) => ({
      title: t.title || '', type: t.type || 'music', ready: !!t.clipId,
      ms: t.durationMs || 0, prompt: t.prompt || t.text || '', fav: !!t.fav,
    })),
  };
}

export function buildCatalog(projects, groups, syncMap, { device = '', appliedAt = 0, publishName = '' } = {}, now = Date.now()) {
  return {
    v: CATALOG_VERSION, updatedAt: now, device, publishName, appliedAt,
    groups: (groups || []).map((g) => ({ id: g.id, name: g.name, parentId: g.parentId || null })),
    albums: (projects || []).map((p) => albumEntry(p, groups || [], syncMap)).sort((a, b) => a.path.localeCompare(b.path)),
  };
}

// Phone → desktop payload. `want` is the FULL desired set, so a lost message never half-applies.
export function buildRequests(wantIds, { from = '' } = {}, now = Date.now()) {
  return { v: CATALOG_VERSION, updatedAt: now, from, want: [...wantIds] };
}

// Desktop: is there a request set we haven't applied yet? (undefined/absent file → nothing to do.)
export function requestsPending(requests, appliedAt = 0) {
  return !!requests && Array.isArray(requests.want) && (requests.updatedAt || 0) > (appliedAt || 0);
}

// Phone: what the desktop still has to do — drives the ⏳ badges. Albums with no audio can't be
// published, so wanting one is not "pending", it's just impossible until the desktop generates it.
export function pendingChanges(catalog, wantIds) {
  const want = new Set(wantIds || []);
  const out = [];
  for (const a of catalog?.albums || []) {
    if (want.has(a.id) && !a.onDevice) out.push({ id: a.id, title: a.title, action: a.readyCount ? 'add' : 'blocked' });
    else if (!want.has(a.id) && a.onDevice) out.push({ id: a.id, title: a.title, action: 'remove' });
  }
  return out;
}

// Phone: the checkbox state to start from — the last request set if it's newer than the catalog the
// desktop published, otherwise what's actually on the device.
export function initialWant(catalog, requests) {
  if (requests && Array.isArray(requests.want) && (requests.updatedAt || 0) > (catalog?.appliedAt || 0)) return new Set(requests.want);
  return new Set((catalog?.albums || []).filter((a) => a.onDevice).map((a) => a.id));
}
