import { t } from '../i18n.js';
// Playlist resolution — pure. A STATIC playlist is a curated ordered list of (projectId, trackId)
// references; a DYNAMIC playlist is a rule evaluated over all albums at play time. Both resolve to
// ordered, playable track objects. See ../audio/wav.test.mjs.

export const DYNAMIC_FIELDS = [
  { field: 'all', label: t('All songs') },
  { field: 'favorites', label: t('Favorites (★)') },
  { field: 'group', label: t('In group') },                 // value = groupId
  { field: 'type', label: t('Track type') },                // value = 'music' | 'dialog' | 'upload'
  { field: 'genre', label: t('Album genre contains') },     // value = text
  { field: 'search', label: t('Title / prompt contains') }, // value = text
  { field: 'rating', label: t('Rated at least') },          // value = 1..5 stars
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
  const decorate = (tk, p) => ({ ...tk, _album: p.title || '', _projectId: p.id });
  if (pl.kind === 'static') {
    const byId = new Map(projects.map((p) => [p.id, p]));
    const out = [];
    for (const it of pl.items || []) {
      const p = byId.get(it.projectId); if (!p) continue;
      const tk = (p.tracks || []).find((x) => x.id === it.trackId);
      if (tk && tk.clipId) out.push(decorate(tk, p));
    }
    return out;
  }
  const rule = pl.rule || { field: 'all' };
  const v = rule.value ?? '';
  const lc = String(v).toLowerCase();
  const flat = [];
  for (const p of projects) for (const tk of p.tracks || []) if (tk.clipId) flat.push([tk, p]);
  let items = flat;
  if (rule.field === 'favorites') items = flat.filter(([tk]) => tk.fav);
  else if (rule.field === 'group') { const ids = descendantGroupIds(v, groups); items = flat.filter(([, p]) => ids.has(p.parentId)); }
  else if (rule.field === 'type') items = flat.filter(([tk]) => tk.type === v);
  else if (rule.field === 'genre') items = flat.filter(([, p]) => (p.meta?.genre || '').toLowerCase().includes(lc));
  else if (rule.field === 'rating') items = flat.filter(([tk]) => (tk.rating || 0) >= (+v || 4)).sort(([a], [b]) => (b.rating || 0) - (a.rating || 0));
  else if (rule.field === 'search') items = flat.filter(([tk]) => `${tk.title || ''} ${tk.prompt || ''} ${tk.text || ''}`.toLowerCase().includes(lc));
  return items.map(([tk, p]) => decorate(tk, p));
}

export function ruleLabel(pl, groups = []) {
  if (!pl || pl.kind === 'static') return 'static';
  const r = pl.rule || {};
  const f = DYNAMIC_FIELDS.find((d) => d.field === r.field);
  let val = r.value;
  if (r.field === 'group') val = groups.find((g) => g.id === r.value)?.name || r.value;
  return `${f?.label || r.field}${val ? `: ${val}` : ''}`;
}
