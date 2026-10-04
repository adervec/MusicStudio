// The agent hand-off: turn a project into the files that live in the backup folder (album.json +
// AGENT.md) and merge an agent-edited album.json back into a project. album.json is the single source
// of truth a *separate* Claude Code session reads/writes to author the album skeleton. Pure — no db,
// no browser; see ../audio/wav.test.mjs.
import { sanitizeFilename } from '../audio/wav.js';

const rid = () => 't_' + Math.random().toString(36).slice(2, 9);

// A group's folder path = its group ancestry + its own name (all sanitized). Cycle-guarded. Pure.
export function groupFolderPath(group, groups = []) {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const parts = []; const seen = new Set();
  let cur = group;
  while (cur && !seen.has(cur.id)) { seen.add(cur.id); parts.unshift(sanitizeFilename(cur.name || 'Group')); cur = cur.parentId ? byId.get(cur.parentId) : null; }
  return parts.join('/');
}

// An album's folder path = its group ancestry + its title, so the on-disk structure mirrors the
// app's group tree. `groups` is the flat [{id,name,parentId}] list. Pure.
export function albumFolderPath(project, groups = []) {
  const parent = project?.parentId ? groups.find((g) => g.id === project.parentId) : null;
  const prefix = parent ? groupFolderPath(parent, groups) + '/' : '';
  return prefix + sanitizeFilename(project?.title || 'Album');
}

// Every album-level metadata field the UI offers and album.json carries. One source of truth.
export const ALBUM_META_FIELDS = [
  { key: 'albumArtist', label: 'Album artist' },
  { key: 'genre', label: 'Genre' },
  { key: 'year', label: 'Year', type: 'number' },
  { key: 'date', label: 'Release date (YYYY-MM-DD)' },
  { key: 'composer', label: 'Composer' },
  { key: 'producer', label: 'Producer' },
  { key: 'publisher', label: 'Publisher / label' },
  { key: 'copyright', label: 'Copyright' },
  { key: 'language', label: 'Language' },
  { key: 'mood', label: 'Mood' },
  { key: 'bpm', label: 'BPM', type: 'number' },
  { key: 'grouping', label: 'Grouping / content group' },
  { key: 'discNumber', label: 'Disc number', type: 'number' },
  { key: 'discTotal', label: 'Total discs', type: 'number' },
  { key: 'catalogNumber', label: 'Catalog number' },
  { key: 'upc', label: 'UPC / barcode' },
  { key: 'isrc', label: 'ISRC' },
  { key: 'website', label: 'Website / URL' },
  { key: 'comment', label: 'Comment', type: 'textarea' },
  { key: 'compilation', label: 'Compilation', type: 'checkbox' },
];

export function defaultMeta() {
  const m = {};
  for (const f of ALBUM_META_FIELDS) m[f.key] = f.type === 'checkbox' ? false : '';
  return m;
}

// Metadata → export tag object (ID3 / WAV INFO). Merges album meta with per-track title/number.
export function trackTags(project, trackTitle, index, total) {
  const m = project.meta || {};
  return {
    title: trackTitle, artist: project.artist || '', album: project.title || '',
    track: index + 1, trackTotal: total,
    albumArtist: m.albumArtist, genre: m.genre, year: m.year, composer: m.composer,
    publisher: m.publisher, copyright: m.copyright, bpm: m.bpm, language: m.language,
    grouping: m.grouping, discNumber: m.discNumber, discTotal: m.discTotal, comment: m.comment,
  };
}

// project → album.json object. `tracks[]` order IS album order.
export function buildAlbumJson(project) {
  return {
    app: 'musicstudio', schemaVersion: 1, id: project.id,
    title: project.title || '', artist: project.artist || '', description: project.description || '',
    cover: project.cover?.file || null, // relative path of the album cover image, if any
    meta: { ...defaultMeta(), ...(project.meta || {}) },
    tracks: (project.tracks || []).map((t) => ({
      id: t.id, type: t.type, title: t.title || '',
      prompt: t.prompt || '', lengthSec: Math.round((t.lengthMs || 60000) / 1000),
      model: t.model || 'music_v2', instrumental: !!t.instrumental,
      text: t.text || '', voiceId: t.voiceId || '', voiceName: t.voiceName || '',
      gain: t.gain ?? 1, sourceUrl: t.sourceUrl || '',
      generated: !!t.clipId, file: t.backupFile || null, // written by the app; agents leave these alone
    })),
    // Reference material for the agent — style guides, inspirations, notes. Files live in attachments/.
    attachments: (project.attachments || []).map((a) => ({ name: a.name, kind: a.kind, source: a.source || 'hand', file: a.file })),
  };
}

// Merge an agent-edited album.json back into a project, preserving already-generated audio by track id.
export function mergeSkeleton(project, json) {
  if (!json || !Array.isArray(json.tracks)) throw new Error('album.json has no tracks[] array');
  const prevById = new Map((project.tracks || []).map((t) => [t.id, t]));
  const tracks = json.tracks.map((j) => {
    const prev = prevById.get(j.id) || {};
    return {
      ...prev,
      id: j.id || rid(),
      type: j.type || prev.type || 'music',
      title: j.title ?? prev.title ?? '',
      prompt: j.prompt ?? prev.prompt ?? '',
      lengthMs: j.lengthSec != null ? Math.max(3000, Math.min(600000, j.lengthSec * 1000)) : (prev.lengthMs || 60000),
      model: j.model || prev.model || 'music_v2',
      instrumental: j.instrumental ?? prev.instrumental ?? false,
      text: j.text ?? prev.text ?? '',
      voiceId: j.voiceId ?? prev.voiceId ?? '',
      voiceName: j.voiceName ?? prev.voiceName ?? '',
      gain: j.gain ?? prev.gain ?? 1,
      sourceUrl: j.sourceUrl ?? prev.sourceUrl ?? '',
      importFile: j.importFile || undefined, // pre-existing audio to attach (backfill); app-consumed
      clipId: prev.clipId || null,          // never invent audio from a skeleton
      durationMs: prev.durationMs || 0,
      backupFile: j.file || prev.backupFile || null, // app-written file — lets audio recover from the folder
      status: prev.clipId ? 'ready' : 'idle',
    };
  });
  return {
    ...project,
    title: json.title ?? project.title,
    artist: json.artist ?? project.artist,
    description: json.description ?? project.description,
    meta: { ...defaultMeta(), ...(project.meta || {}), ...(json.meta || {}) },
    attachments: project.attachments || [], // app-managed; a skeleton edit never drops the real files
    tracks,
  };
}

// A track is a "generation gap" if it's a song/dialog with the input it needs but no audio yet.
export function isGap(t) {
  return (t.type === 'music' || t.type === 'dialog') && !t.clipId
    && (t.type === 'music' ? !!(t.prompt && t.prompt.trim()) : !!(t.text && t.text.trim() && t.voiceId));
}
export function countGaps(project) { return (project?.tracks || []).filter(isGap).length; }

// Content key for dedup: songs by prompt, dialog by voice+text (normalized). null when empty/upload.
export function trackKey(t) {
  const norm = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (t.type === 'music') { const p = norm(t.prompt); return p ? 'm:' + p : null; }
  if (t.type === 'dialog') { const x = norm(t.text); return x ? `d:${t.voiceId || ''}:${x}` : null; }
  return null;
}
// Ids of tracks that duplicate an earlier track's content (the 2nd+ occurrence of a key).
export function duplicateIds(tracks) {
  const seen = new Set(), dups = new Set();
  for (const t of tracks || []) { const k = trackKey(t); if (!k) continue; if (seen.has(k)) dups.add(t.id); else seen.add(k); }
  return dups;
}

// Parse a pasted blob of song prompts (e.g. written in a chat) into [{ title, prompt }].
// Understands: numbered/bulleted lines ("1. Title — prompt"), "Title: prompt" lines, markdown
// headings followed by body text, and blank-line-separated blocks. ponytail: heuristic by design —
// odd formats still land as prompt-only tracks the user can retitle.
export function parsePromptBlob(text) {
  const blocks = [];
  let cur = null;
  const isHead = (l) => /^#{1,6}\s+/.test(l) || /^\s*(?:[-*•]|\d{1,3}[.)])\s+/.test(l);
  const strip = (l) => l.replace(/^#{1,6}\s+/, '').replace(/^\s*(?:[-*•]|\d{1,3}[.)])\s+/, '').trim();
  for (const raw of String(text || '').replace(/\r/g, '').split('\n')) {
    const l = raw.trim();
    if (!l) { if (cur) { blocks.push(cur); cur = null; } continue; }
    if (isHead(raw)) { if (cur) blocks.push(cur); cur = { head: strip(raw), body: [] }; }
    else if (cur) cur.body.push(l);
    else cur = { head: l, body: [] };
  }
  if (cur) blocks.push(cur);
  const items = [];
  for (const b of blocks) {
    let title = b.head, prompt = b.body.join(' ').trim();
    if (!prompt) {
      const m = title.match(/^["“]?(.{1,80}?)["”]?(?:\s+[—–-]\s+|\s*:\s+)(.+)$/);
      if (m) { title = m[1]; prompt = m[2].trim(); } else { prompt = title; title = ''; }
    } else if (title.length > 80) { prompt = (title + ' ' + prompt).trim(); title = ''; }
    title = title.replace(/^["“]+|["”]+$/g, '').trim();
    if (prompt) items.push({ title, prompt });
  }
  return items;
}

// Plan a folder→app import: given albums discovered on disk (see scanAlbums) and the app's current
// groups/projects, compute which groups/projects to CREATE. Groups match/create by folder name +
// parent (deduped within one plan); albums match by album.json `id`, or failing that by group +
// sanitized title, so re-scans never duplicate. Pure (ids come from the injected generators).
export function planImport(scanned, groups = [], projects = [], mkGroupId, mkProjectId) {
  const newGroups = [], newProjects = [];
  const ensureChain = (names) => {
    let parentId = null;
    for (const folderName of names) {
      let g = [...groups, ...newGroups].find((x) => (x.parentId || null) === parentId && sanitizeFilename(x.name) === folderName);
      if (!g) { g = { id: mkGroupId(), name: folderName, parentId }; newGroups.push(g); }
      parentId = g.id;
    }
    return parentId;
  };
  const known = [...projects];
  for (const a of scanned) {
    const leafGroupId = ensureChain(a.groupPath);
    const fileId = (typeof a.json.id === 'string' && a.json.id) ? a.json.id : null;
    const exists = known.find((p) => (fileId && p.id === fileId) || ((p.parentId || null) === (leafGroupId || null) && sanitizeFilename(p.title || '') === a.folderName));
    if (exists) continue;
    const base = { id: fileId || mkProjectId(), title: a.json.title || a.folderName, artist: '', description: '', meta: {}, attachments: [], parentId: leafGroupId || null, tracks: [], createdAt: 0 };
    const proj = mergeSkeleton(base, a.json);
    known.push(proj);
    newProjects.push({ proj, writeBack: !fileId, path: [...a.groupPath, a.folderName].join('/') });
  }
  return { newGroups, newProjects };
}

// AGENT.md — ONE general instruction file at the ROOT of the backup folder (not per album). It
// explains the whole layout and points the agent at each album's own album.json for the brief.
export function rootAgentMarkdown() {
  return `# Music Studio — how to build album skeletons

This is a **Music Studio backup folder**. It holds one or more **albums**, organized into **group
subfolders that mirror the app's group tree**. Each album is a folder containing an \`album.json\`
(plus an \`attachments/\` folder and the generated audio files).

## Finding the albums
Every \`album.json\` anywhere in this tree is one album. Its folder path reflects its groups, e.g.
\`Soundtracks/Chapter 1/Night City/album.json\`. Albums with no group sit at the root.

## Your job
For whichever album the human points you at, **edit that album's \`album.json\`** to author the album
skeleton. Edit only \`album.json\` files.

**You design; you do not generate.** Never call ElevenLabs, never invent API keys, and never create,
edit, or delete audio files, \`attachments/\` files, or this \`AGENT.md\`. The human generates the real
audio in the app (paid ElevenLabs calls).

## Read before designing (inside the album's album.json)
- \`description\` — the creative brief. Read it first.
- \`attachments[]\` — each entry's \`file\` points to a style guide / inspiration / note in that album's
  \`attachments/\` folder. Read them and let them steer the prompts.
- **Group folders can have an \`attachments/\` folder too** (e.g. liner notes for a whole set of albums).
  They apply to every album beneath that group — read the ones on the album's path, top-down.

## Author the tracks
Rewrite \`tracks[]\` into a complete skeleton that delivers the brief:
- **Order = album order** (array order is listening order).
- For each **song** (\`"type":"music"\`): a vivid \`prompt\` — genre, instrumentation, mood, tempo/BPM,
  era, vocals or not — and a sensible \`lengthSec\` (3–600).
- Add **dialog** tracks (\`"type":"dialog"\`) for narration / intros / skits; put the words in \`text\`.
  Leave \`voiceId\` empty and describe the voice in \`voiceName\` (e.g. "warm female narrator").
- Leave any \`"type":"upload"\` track as-is (the human's own file).
- Fill in album \`meta\` fields you can infer (genre, year, mood, composer, …).
- Keep existing track \`id\`s; new tracks get a new unique string \`id\` (e.g. "t_intro").
- Never edit the app-managed \`generated\` / \`file\` fields.

## album.json schema
\`\`\`
{
  "title": string, "artist": string, "description": string,
  "meta": { ${ALBUM_META_FIELDS.map((f) => f.key).join(', ')} },
  "attachments": [{ "name": string, "kind": "note"|"file", "source": string, "file": string }],
  "tracks": [{
    "id": string,                 // stable; keep existing, invent for new
    "type": "music"|"dialog"|"upload",
    "title": string,
    "prompt": string,             // music only — the generation prompt
    "lengthSec": number,          // music only — 3..600
    "model": "music_v2"|"music_v1",
    "instrumental": boolean,      // music only
    "text": string,               // dialog only — the spoken words
    "voiceId": string,            // dialog only — leave "" unless told a voice
    "voiceName": string,          // dialog only — describe the voice you want
    "gain": number,               // 0..1.5 (1 = unchanged)
    "sourceUrl": string,          // OPTIONAL: web page the song was made on (e.g. its ElevenLabs song page)
    "importFile": string,         // OPTIONAL: filename of an EXISTING audio file in THIS album folder to
                                  //   attach as this track's audio (backfill; see below). e.g. "01 intro.mp3"
    "generated": boolean,         // app-managed — DO NOT edit
    "file": string|null           // app-managed — DO NOT edit
  }]
}
\`\`\`

## Creating a NEW album or group
You may scaffold new albums and groups directly on disk:
- **New group** = create a folder. Nest it inside other group folders for sub-groups.
- **New album** = create a folder (inside the desired group folders) containing an \`album.json\`
  that follows the schema above. You can **omit \`id\`** — the app assigns one and stamps it back.
- Use **filesystem-safe folder names** (letters, numbers, spaces, dashes — no slashes or colons) and
  make each album folder's name match its \`title\`.
- The app discovers new folders automatically within a few seconds (or the human clicks **⟳ Import**).
  Non-album folders at the root can be marked "ignored" by the human, so don't rely on placing loose
  files at the root.

## Backfilling audio made BEFORE this app
Bring in songs/audio the human already made (mp3, wav, m4a, ogg, flac — anything) instead of
regenerating them:
1. Put (copy or move) the existing audio file **inside the album's folder** (next to \`album.json\`).
2. Add a track for it with **\`importFile\`** set to that file's name, e.g.
   \`{ "id": "t_old1", "type": "upload", "title": "Old Song", "importFile": "old song.mp3" }\`.
   Use \`"type": "upload"\` for pre-existing audio (no prompt needed).
3. The app reads the file in and attaches it as that track's audio, so it shows **ready, not a gap**.
Ideal for organizing a pile of existing tracks: sort the files into album folders, then write one
\`album.json\` per album listing them with \`importFile\`. Loose files not referenced by any track are ignored.

## Handoff documents (specs written elsewhere, e.g. in a Claude chat)
The human may drop **handoff docs** — album specs, track lists, prompt drafts, worldbuilding notes
(\`.md\`, \`.txt\`, \`.zip\`) — into an \`Inputs/\` folder at the root (often \`Inputs/Handoffs/\`). Inputs is
not an album; treat it as read-only source material. Your job: turn each handoff into a real album —
create the album folder in the right group, write its \`album.json\` (tracks, prompts, metadata from
the doc), and leave the handoff file where it is.

## Reverse-engineering an album from an existing song
Sometimes the human analyzes a finished song in a chat (agents there can *listen* to audio; you
cannot) and produces a written breakdown — genre, instrumentation, tempo, structure, mood. That
breakdown arrives as a handoff doc, usually next to the source audio file. To build the album:
1. Read the breakdown and write \`album.json\` with prompts **modeled on it** — same sonic palette,
   varied per track so the album has an arc, not twelve clones.
2. If the source song itself belongs on the album, copy it into the album folder and reference it
   with \`importFile\` (see backfilling above) — never regenerate what already exists.
3. Note the source in the album \`description\` (e.g. "reverse-engineered from <file>").

## When done
Save valid JSON. The app auto-reloads \`album.json\` within a few seconds (or the human clicks
**⤒ Load skeleton**), and picks up new folders on its next scan.
`;
}
