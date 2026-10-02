// Library-wide logic: every track as one flat table row (search/filter/sort/stats/CSV), plus the
// planners behind the Reorganize and Build-album wizards. Pure — no db, no browser; see
// ../audio/wav.test.mjs.
import { albumFolderPath, groupFolderPath, isGap } from './skeleton.js';
import { sanitizeFilename } from '../audio/wav.js';
import { musicCost, ttsCost } from '../state/pricing.js';

// ── Table rows ────────────────────────────────────────────────────────────────────────────────
export function libraryRows(projects, groups = []) {
  const rows = [];
  for (const p of projects || []) {
    const path = albumFolderPath(p, groups);
    const group = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const genre = p.meta?.genre || '', year = p.meta?.year || '', artist = p.artist || p.meta?.albumArtist || '';
    (p.tracks || []).forEach((t, i) => {
      const prompt = t.type === 'dialog' ? (t.text || '') : (t.prompt || '');
      const r = {
        id: t.id, albumId: p.id, album: p.title || 'Untitled', group, n: i + 1, title: t.title || '', type: t.type || 'music',
        status: t.clipId ? 'ready' : isGap(t) ? 'gap' : 'empty', ms: t.clipId ? (t.durationMs || 0) : 0,
        planMs: t.lengthMs || 0, fav: !!t.fav, prompt, genre, year, artist, track: t,
      };
      r.hay = [r.title, r.album, group, prompt, genre, year, artist].join(' ').toLowerCase();
      rows.push(r);
    });
  }
  return rows;
}

// All words must match somewhere (title/album/group/prompt/genre/year/artist). Group matches its subtree.
export function filterRows(rows, { q = '', group = '', type = '', status = '', fav = false } = {}) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((r) => (!group || r.group === group || r.group.startsWith(group + '/'))
    && (!type || r.type === type) && (!status || r.status === status) && (!fav || r.fav)
    && words.every((w) => r.hay.includes(w)));
}

export function sortRows(rows, key, dir = 1) {
  return [...rows].sort((a, b) => {
    const x = a[key], y = b[key];
    return dir * (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true }));
  });
}

export function libraryStats(rows) {
  const s = { albums: new Set(rows.map((r) => r.albumId)).size, tracks: rows.length, ready: 0, gaps: 0, empty: 0, favs: 0, ms: 0, gapCost: 0 };
  for (const r of rows) {
    if (r.status === 'ready') { s.ready++; s.ms += r.ms; } else if (r.status === 'gap') s.gaps++; else s.empty++;
    if (r.status === 'gap') s.gapCost += r.type === 'music' ? musicCost(r.planMs || 60000) : ttsCost(r.prompt.trim().length);
    if (r.fav) s.favs++;
  }
  return s;
}

// Rows bucketed by keyFn → [{ k, n, ready, ms }], biggest (by listening time, then count) first.
export function breakdown(rows, keyFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r) || '—'; const b = m.get(k) || { k, n: 0, ready: 0, ms: 0 };
    b.n++; if (r.status === 'ready') { b.ready++; b.ms += r.ms; }
    m.set(k, b);
  }
  return [...m.values()].sort((a, b) => b.ms - a.ms || b.n - a.n);
}

export function toCsv(rows, cols) {
  const q = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [cols.join(','), ...rows.map((r) => cols.map((c) => q(r[c] ?? '')).join(','))].join('\n');
}

// ── Reorganize wizard ────────────────────────────────────────────────────────────────────────
// A group and everything nested under it.
export function descendantIds(groupId, groups = []) {
  const out = new Set([groupId]); let added = true;
  while (added) { added = false; for (const g of groups) if (g.parentId && out.has(g.parentId) && !out.has(g.id)) { out.add(g.id); added = true; } }
  return out;
}

// "A/B/C" → the leaf group id, creating whatever's missing (returned in `created`). '' → top level.
export function ensureGroupPath(path, groups, mkId) {
  const created = []; let parentId = null;
  for (const name of String(path || '').split('/').map((s) => s.trim()).filter(Boolean)) {
    let g = [...groups, ...created].find((x) => (x.parentId || null) === parentId && sanitizeFilename(x.name || '') === sanitizeFilename(name));
    if (!g) { g = { id: mkId(), name, parentId }; created.push(g); }
    parentId = g.id;
  }
  return { parentId, created };
}

export const ALBUM_FIELDS = [
  { key: 'genre', label: 'Genre', get: (p) => p.meta?.genre },
  { key: 'year', label: 'Year', get: (p) => p.meta?.year },
  { key: 'artist', label: 'Artist', get: (p) => p.artist || p.meta?.albumArtist },
  { key: 'letter', label: 'First letter', get: (p) => (p.title || '').trim().charAt(0).toUpperCase() },
];
export function albumField(p, key) { return String(ALBUM_FIELDS.find((f) => f.key === key)?.get(p) ?? '').trim(); }

// items: [{ kind: 'album'|'group', id, dest: 'A/B' }] → { created, moves: [{kind,id,parentId,from,to}], blocked: [{id,why}] }.
// Planned sequentially against the evolving tree, so a batch can't form a cycle or land two
// folders on the same path. Moves that change nothing are dropped.
export function planRearrange(items, groups = [], projects = [], mkId) {
  let gs = [...groups], ps = [...projects];
  const created = [], moves = [], blocked = [];
  const nameOf = (kind, x) => sanitizeFilename(kind === 'group' ? (x.name || 'Group') : (x.title || 'Album'));
  for (const it of items) {
    const cur = (it.kind === 'group' ? gs : ps).find((x) => x.id === it.id); if (!cur) continue;
    const r = ensureGroupPath(it.dest, gs, mkId);
    if ((cur.parentId || null) === r.parentId) continue;
    if (it.kind === 'group' && r.parentId && descendantIds(it.id, gs).has(r.parentId)) { blocked.push({ id: it.id, why: 'into itself' }); continue; }
    const name = nameOf(it.kind, cur);
    const clash = gs.some((g) => g.id !== it.id && (g.parentId || null) === r.parentId && nameOf('group', g) === name)
      || ps.some((p) => p.id !== it.id && (p.parentId || null) === r.parentId && nameOf('album', p) === name);
    if (clash) { blocked.push({ id: it.id, why: 'name taken there' }); continue; }
    gs.push(...r.created); created.push(...r.created);
    const from = it.kind === 'group' ? groupFolderPath(cur, gs) : albumFolderPath(cur, gs);
    const next = { ...cur, parentId: r.parentId };
    if (it.kind === 'group') gs = gs.map((x) => (x.id === it.id ? next : x)); else ps = ps.map((x) => (x.id === it.id ? next : x));
    moves.push({ kind: it.kind, id: it.id, parentId: r.parentId, from, to: it.kind === 'group' ? groupFolderPath(next, gs) : albumFolderPath(next, gs) });
  }
  return { created, moves, blocked };
}

// ── Build-album wizard ───────────────────────────────────────────────────────────────────────
// Strip a filename/title to its words: no extension, leading track number, or app clip suffix
// ("_k3x9a" — always holds a digit, so a real "_intro" survives).
const CLIP_SUFFIX = /_(?=[a-z]*\d)[a-z0-9]{5}$/i, TRACK_NO = /^\d{1,3}(?:\s*[-._)]\s*|\s+)/;
const EXT = /\.(mp3|wav|m4a|aac|ogg|oga|opus|flac|webm|txt|md)$/i;
export const fileTitle = (name) => String(name || '').replace(EXT, '').replace(CLIP_SUFFIX, '').replace(TRACK_NO, '').trim();
export const normTitle = (s) => fileTitle(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// A .txt/.md holding ONE prompt is that song's prompt (titled by the filename, so it pairs with
// the same-named audio file); a file holding several is a prompt list. `parse` = parsePromptBlob.
export function promptsFromText(name, text, parse) {
  const items = parse(text);
  return items.length === 1 ? [{ title: items[0].title || fileTitle(name), prompt: items[0].prompt }] : items;
}

// Pair prompts with audio files → rows { title, prompt, file }, either side possibly missing.
// Exact normalized title first, then one title containing the other; leftover audio is appended in
// filename order. ponytail: title matching only, no fuzzy distance — the wizard lets you re-pair.
export function pairItems(prompts = [], files = []) {
  const rows = prompts.map((p) => ({ title: p.title || '', prompt: p.prompt || '', file: null }));
  const left = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const take = (match) => {
    for (const r of rows) {
      const a = normTitle(r.title); if (r.file || !a) continue;
      const i = left.findIndex((f) => match(a, normTitle(f.name)));
      if (i >= 0) r.file = left.splice(i, 1)[0];
    }
  };
  take((a, b) => a === b);
  take((a, b) => Math.min(a.length, b.length) >= 3 && (a.includes(b) || b.includes(a)));
  for (const f of left) rows.push({ title: fileTitle(f.name), prompt: '', file: f });
  return rows;
}
