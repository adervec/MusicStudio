// Ratings, notes, likes/dislikes — and the taste profile agents read (TASTE.md + taste.json at the
// backup-folder root) so "make more like what I liked" has something to go on. Every level (song,
// album, group) carries the human's own rating plus a rating calculated from what's under it.
// Pure — see ../audio/wav.test.mjs.
import { albumFolderPath, groupFolderPath } from './skeleton.js';

const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

// Album: mine = p.rating; calc = mean of its rated songs. Effective = mine ?? calc.
export function albumRating(p) {
  const rs = (p.tracks || []).map((tk) => tk.rating).filter((x) => x > 0);
  const calc = mean(rs);
  return { mine: p.rating || null, calc: r1(calc), n: rs.length, eff: p.rating || calc };
}
// Group: calc = mean of the effective ratings of its albums and sub-groups (recursively).
export function groupRatings(groups = [], projects = []) {
  const out = new Map();
  const visit = (g, seen = new Set()) => {
    if (out.has(g.id)) return out.get(g.id);
    if (seen.has(g.id)) return { mine: g.rating || null, calc: null, n: 0, eff: g.rating || null };
    seen.add(g.id);
    const parts = [
      ...projects.filter((p) => p.parentId === g.id).map((p) => albumRating(p).eff),
      ...groups.filter((c) => c.parentId === g.id).map((c) => visit(c, seen).eff),
    ].filter((x) => x > 0);
    const calc = mean(parts);
    const r = { mine: g.rating || null, calc: r1(calc), n: parts.length, eff: g.rating || calc };
    out.set(g.id, r); return r;
  };
  for (const g of groups) visit(g);
  return out;
}

// Style tags of a track: its prompt's comma parts, its plan's styles, ElevenLabs' genres for it.
export function styleTags(tk, p = {}) {
  const tags = [
    ...String(tk.usePlan ? '' : tk.prompt || '').split(/[,;\n]/),
    ...(tk.usePlan ? (tk.plan?.chunks || []).flatMap((c) => c.positive_styles || []) : []),
    ...(tk.genMeta?.genres || []), p.meta?.genre || '',
  ].map((s) => s.trim().toLowerCase()).filter((s) => s && s.length <= 40);
  return [...new Set(tags)];
}
const countTags = (lists) => { const m = new Map(); for (const l of lists) for (const x of l || []) { const k = String(x).trim().toLowerCase(); if (k) m.set(k, (m.get(k) || 0) + 1); } return [...m].sort((a, b) => b[1] - a[1]); };

// The taste profile → { json, markdown }. Deterministic (no timestamps inside) so unchanged ratings
// don't rewrite the files.
export function buildTaste(projects = [], groups = []) {
  const songs = [];
  for (const p of projects) for (const tk of p.tracks || []) {
    songs.push({ album: p.title || 'Album', path: albumFolderPath(p, groups), title: tk.title || '', type: tk.type, rating: tk.rating || 0, fav: !!tk.fav,
      prompt: tk.usePlan ? '' : (tk.prompt || ''), plan: tk.usePlan ? (tk.plan?.chunks || []).map((c) => (c.song_id ? '[kept audio]' : `${(c.text || '').split('\n')[0]} — ${(c.positive_styles || []).join(', ')}`)) : null,
      lyrics: tk.lyrics ? tk.lyrics.slice(0, 400) : '', genres: tk.genMeta?.genres || [], styles: styleTags(tk, p),
      notes: tk.notes || '', likes: tk.likes || [], dislikes: tk.dislikes || [], takeNote: tk.takeNote || '', model: tk.genModel || tk.model || '', seed: Number.isInteger(tk.seed) ? tk.seed : null });
  }
  const rated = songs.filter((s) => s.rating > 0);
  const top = songs.filter((s) => s.rating >= 4 || (s.fav && !s.rating)).sort((a, b) => b.rating - a.rating || a.title.localeCompare(b.title)).slice(0, 30);
  const low = songs.filter((s) => s.rating > 0 && s.rating <= 2).sort((a, b) => a.rating - b.rating).slice(0, 20);
  const gr = groupRatings(groups, projects);
  const albums = projects.map((p) => ({ album: p.title || 'Album', path: albumFolderPath(p, groups), ...albumRating(p), notes: p.notes || '', likes: p.likes || [], dislikes: p.dislikes || [], genre: p.meta?.genre || '' }))
    .filter((a) => a.eff || a.notes || a.likes.length || a.dislikes.length).sort((a, b) => (b.eff || 0) - (a.eff || 0));
  const grps = groups.map((g) => ({ group: groupFolderPath(g, groups), ...gr.get(g.id), notes: g.notes || '', likes: g.likes || [], dislikes: g.dislikes || [] }))
    .filter((g) => g.eff || g.notes || g.likes.length || g.dislikes.length).sort((a, b) => (b.eff || 0) - (a.eff || 0));
  const all = [...songs, ...albums, ...grps];
  const likes = countTags(all.map((x) => x.likes)), dislikes = countTags(all.map((x) => x.dislikes));
  // Which styles go with high vs low ratings (needs ≥2 rated songs carrying the tag).
  const byTag = new Map();
  for (const s of rated) for (const tg of s.styles) { const a = byTag.get(tg) || []; a.push(s.rating); byTag.set(tg, a); }
  const tagStats = [...byTag].filter(([, rs]) => rs.length >= 2).map(([tag, rs]) => ({ tag, avg: r1(mean(rs)), n: rs.length })).sort((a, b) => b.avg - a.avg || b.n - a.n);
  const json = {
    about: 'Music Studio taste profile — the human\'s own ratings (1–5), notes, likes and dislikes. Read-only for agents.',
    summary: { songs: songs.length, rated: rated.length, average: r1(mean(rated.map((s) => s.rating))), favourites: songs.filter((s) => s.fav).length },
    topSongs: top, lowSongs: low, albums, groups: grps,
    recurringLikes: likes.slice(0, 25).map(([k, n]) => ({ like: k, n })), recurringDislikes: dislikes.slice(0, 25).map(([k, n]) => ({ dislike: k, n })),
    stylesLiked: tagStats.filter((x) => x.avg >= 3.5).slice(0, 15), stylesDisliked: tagStats.filter((x) => x.avg <= 2.5).reverse().slice(0, 15),
  };
  const L = [];
  L.push('# Taste profile', '', '_Generated by Music Studio from the human\'s own ratings and notes. Agents: read this first when asked for "more like what I liked", and never edit it — change ratings in the app._', '');
  L.push(`${json.summary.rated} of ${json.summary.songs} songs rated · average ${json.summary.average ?? '—'}★ · ${json.summary.favourites} favourites`, '');
  const songLine = (s) => `- **${s.title || 'Untitled'}** (${s.album}) ${s.rating ? '★'.repeat(s.rating) : '♥'}${s.styles.length ? ` — ${s.styles.slice(0, 8).join(', ')}` : ''}${s.likes.length ? ` · likes: ${s.likes.join(', ')}` : ''}${s.dislikes.length ? ` · dislikes: ${s.dislikes.join(', ')}` : ''}${s.notes ? ` · “${s.notes.replace(/\s+/g, ' ').slice(0, 160)}”` : ''}${s.takeNote ? ` · take: “${s.takeNote}”` : ''}`;
  if (top.length) { L.push('## Loved — make more like these', ''); top.forEach((s) => { L.push(songLine(s)); if (s.prompt) L.push(`  - prompt: ${s.prompt.replace(/\s+/g, ' ').slice(0, 300)}`); if (s.plan) L.push(`  - plan: ${s.plan.slice(0, 6).join(' | ')}`); }); L.push(''); }
  if (json.stylesLiked.length) L.push('## Styles that rate well', '', ...json.stylesLiked.map((x) => `- ${x.tag} — avg ${x.avg}★ over ${x.n} songs`), '');
  if (likes.length) L.push('## Recurring likes', '', ...json.recurringLikes.map((x) => `- ${x.like}${x.n > 1 ? ` (×${x.n})` : ''}`), '');
  if (dislikes.length) L.push('## Recurring dislikes — avoid', '', ...json.recurringDislikes.map((x) => `- ${x.dislike}${x.n > 1 ? ` (×${x.n})` : ''}`), '');
  if (json.stylesDisliked.length) L.push('## Styles that rate poorly — avoid', '', ...json.stylesDisliked.map((x) => `- ${x.tag} — avg ${x.avg}★ over ${x.n} songs`), '');
  if (low.length) { L.push('## Disliked songs — what not to repeat', ''); low.forEach((s) => L.push(songLine(s))); L.push(''); }
  const lvl = (x, name) => `- **${name}** — ${x.mine ? `mine ${x.mine}★` : 'not rated'}${x.calc ? ` · from parts ${x.calc}★ (${x.n})` : ''}${x.likes.length ? ` · likes: ${x.likes.join(', ')}` : ''}${x.dislikes.length ? ` · dislikes: ${x.dislikes.join(', ')}` : ''}${x.notes ? ` · “${x.notes.replace(/\s+/g, ' ').slice(0, 200)}”` : ''}`;
  if (albums.length) L.push('## Albums', '', ...albums.map((a) => lvl(a, a.path)), '');
  if (grps.length) L.push('## Groups', '', ...grps.map((g) => lvl(g, g.group)), '');
  return { json, markdown: L.join('\n') + '\n' };
}
