// Playlist resolution — pure. A STATIC playlist is a curated ordered list of (projectId, trackId)
// references; a DYNAMIC playlist is a rule evaluated over all albums at play time. Both resolve to
// ordered, playable track objects. See ../audio/wav.test.mjs.

export const DYNAMIC_FIELDS = [
  { field: 'all', label: 'All songs' },
  { field: 'favorites', label: 'Favorites (★)' },
  { field: 'group', label: 'In group' },                 // value = groupId
  { field: 'type', label: 'Track type' },                // value = 'music' | 'dialog' | 'upload'
  { field: 'genre', label: "Album genre contains" },     // value = text
  { field: 'search', label: 'Title / prompt contains' }, // value = text
];

function descendantGroupIds(gid, groups) {
  const ids = new Set([gid]); let added = true;
  while (added) { added = false; for (const g of groups || []) if (g.parentId && ids.has(g.parentId) && !ids.has(g.id)) { ids.add(g.id); added = true; } }
  return ids;
}

// → ordered array of track objects, each augmented with _album (title) and _projectId. Only tracks
// that have audio (clipId) are playable, so those are what we return.
export function resolvePlaylist(pl, projects = [], groups = []) {
  if (!pl) return [];
  const decorate = (t, p) => ({ ...t, _album: p.title || '', _projectId: p.id });
  if (pl.kind === 'static') {
    const byId = new Map(projects.map((p) => [p.id, p]));
    const out = [];
    for (const it of pl.items || []) {
      const p = byId.get(it.projectId); if (!p) continue;
      const t = (p.tracks || []).find((x) => x.id === it.trackId);
      if (t && t.clipId) out.push(decorate(t, p));
    }
    return out;
  }
  const rule = pl.rule || { field: 'all' };
  const v = rule.value ?? '';
  const lc = String(v).toLowerCase();
  const flat = [];
  for (const p of projects) for (const t of p.tracks || []) if (t.clipId) flat.push([t, p]);
  let items = flat;
  if (rule.field === 'favorites') items = flat.filter(([t]) => t.fav);
  else if (rule.field === 'group') { const ids = descendantGroupIds(v, groups); items = flat.filter(([, p]) => ids.has(p.parentId)); }
  else if (rule.field === 'type') items = flat.filter(([t]) => t.type === v);
  else if (rule.field === 'genre') items = flat.filter(([, p]) => (p.meta?.genre || '').toLowerCase().includes(lc));
  else if (rule.field === 'search') items = flat.filter(([t]) => `${t.title || ''} ${t.prompt || ''} ${t.text || ''}`.toLowerCase().includes(lc));
  return items.map(([t, p]) => decorate(t, p));
}

export function ruleLabel(pl, groups = []) {
  if (!pl || pl.kind === 'static') return 'static';
  const r = pl.rule || {};
  const f = DYNAMIC_FIELDS.find((d) => d.field === r.field);
  let val = r.value;
  if (r.field === 'group') val = groups.find((g) => g.id === r.value)?.name || r.value;
  return `${f?.label || r.field}${val ? `: ${val}` : ''}`;
}
