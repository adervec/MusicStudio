// Self-check for the pure byte/planning logic (no browser). Run: node src/audio/wav.test.mjs
import assert from 'node:assert';
import { encodeWav, buildId3v2, trackFileName, sanitizeFilename, buildM3u, applyEdits, assembleAlbum } from './wav.js';
import { musicCost, ttsCost, summarizeUsage } from '../state/pricing.js';
import { buildAlbumJson, mergeSkeleton, trackTags, albumFolderPath, groupFolderPath, planImport, isGap, trackKey, duplicateIds, parsePromptBlob } from '../album/skeleton.js';
import { resolvePlaylist } from '../album/playlists.js';
import { bufToB64, b64ToBuf } from '../state/db.js';

// WAV header: stereo, 44 bytes + data, correct RIFF/WAVE/fmt/data + channel count.
{
  const L = new Float32Array([0, 0.5, -0.5]), R = new Float32Array([0, -0.5, 0.5]);
  const w = encodeWav([L, R], 44100);
  const str = (o, n) => String.fromCharCode(...w.slice(o, o + n));
  assert.equal(str(0, 4), 'RIFF'); assert.equal(str(8, 4), 'WAVE'); assert.equal(str(36, 4), 'data');
  const dv = new DataView(w.buffer);
  assert.equal(dv.getUint16(22, true), 2, 'channel count = 2');
  assert.equal(w.length, 44 + 3 * 2 * 2, 'stereo 16-bit: 4 bytes/frame');
  // mono path still works
  assert.equal(new DataView(encodeWav([L], 44100).buffer).getUint16(22, true), 1);
}

// ID3v2.3 magic + tag names, and filenames sort in order / are sanitized.
{
  const tag = buildId3v2({ title: 'Intro', artist: 'Me', album: 'X', track: 1, trackTotal: 3 });
  assert.equal(String.fromCharCode(...tag.slice(0, 3)), 'ID3');
  assert.equal(trackFileName(0, 12, 'Hello: World?', 'mp3'), '01 Hello World.mp3');
  assert.equal(sanitizeFilename('a/b\\c'), 'a b c');
  const m3u = buildM3u(['01 a.mp3', '02 b.mp3'], ['a', 'b'], [10, 20], 'Album');
  assert.ok(m3u.startsWith('#EXTM3U') && m3u.includes('02 b.mp3'));
}

// Pricing: $0.15/min music, per-char tts, and dashboard aggregation.
{
  assert.ok(Math.abs(musicCost(60000) - 0.15) < 1e-9, '1 min = $0.15');
  assert.ok(Math.abs(musicCost(30000) - 0.075) < 1e-9);
  assert.ok(ttsCost(1000) > 0);
  const s = summarizeUsage([
    { ts: Date.now(), kind: 'music', model: 'music_v2', ms: 60000, costUsd: 0.15 },
    { ts: Date.now(), kind: 'tts', model: 'eleven_multilingual_v2', chars: 500, costUsd: 0.09 },
  ]);
  assert.equal(s.calls, 2);
  assert.ok(Math.abs(s.total - 0.24) < 1e-9);
  assert.equal(s.music.calls, 1); assert.equal(s.tts.chars, 500);
}

// ID3 carries extended metadata (genre frame TCON present when set).
{
  const tags = trackTags({ title: 'A', artist: 'B', meta: { genre: 'Lo-fi', year: 2026 } }, 'Song', 0, 3);
  assert.equal(tags.genre, 'Lo-fi'); assert.equal(tags.track, 1); assert.equal(tags.trackTotal, 3);
  const t = buildId3v2(tags);
  const ascii = String.fromCharCode(...t);
  assert.ok(ascii.includes('TCON') && ascii.includes('Lo-fi'), 'genre frame present');
  assert.ok(ascii.includes('TRCK'), 'track frame present');
}

// Skeleton round-trip: build album.json, an "agent" edits it, merge back — generated audio survives,
// prompts/metadata update, new tracks get ids.
{
  const project = {
    id: 'p1', title: 'Night City', artist: 'VA', description: 'rainy jazz',
    meta: { genre: 'jazz' },
    attachments: [{ id: 'a1', name: 'Style guide', kind: 'note', source: 'ai', file: 'attachments/style_a1.md' }],
    tracks: [
      { id: 't1', type: 'music', title: 'Intro', prompt: 'old', lengthMs: 30000, gain: 1, clipId: 'clip_abc', durationMs: 12345, backupFile: 'Intro_abc.mp3' },
    ],
  };
  const json = buildAlbumJson(project);
  assert.equal(json.attachments[0].file, 'attachments/style_a1.md', 'attachments exposed in album.json');
  assert.equal(json.tracks[0].lengthSec, 30);
  assert.equal(json.tracks[0].generated, true);
  assert.equal(json.tracks[0].file, 'Intro_abc.mp3');
  // agent edits: rewrite prompt, bump length, add a dialog track with no id
  json.tracks[0].prompt = 'warm rhodes, 72 BPM';
  json.tracks[0].lengthSec = 45;
  json.tracks.push({ type: 'upload', title: 'Skit', importFile: 'skit.mp3' });
  json.description = 'rainy jazz, expanded';
  const merged = mergeSkeleton(project, json);
  assert.equal(merged.tracks.length, 2);
  assert.equal(merged.tracks[0].clipId, 'clip_abc', 'existing audio preserved');
  assert.equal(merged.tracks[0].backupFile, 'Intro_abc.mp3', 'album.json file → backupFile (folder recovery)');
  assert.equal(merged.tracks[0].durationMs, 12345);
  assert.equal(merged.tracks[0].prompt, 'warm rhodes, 72 BPM');
  assert.equal(merged.tracks[0].lengthMs, 45000);
  assert.ok(merged.tracks[1].id && merged.tracks[1].id !== 't1', 'new track got an id');
  assert.equal(merged.tracks[1].clipId, null, 'new track is not generated');
  assert.equal(merged.tracks[1].importFile, 'skit.mp3', 'importFile carried through for backfill');
  assert.equal(merged.description, 'rainy jazz, expanded');
  assert.equal(merged.attachments.length, 1, 'attachments survive a skeleton merge');
}

// Album folder path mirrors the group ancestry (sanitized), and is cycle-safe.
{
  const groups = [
    { id: 'g1', name: 'Soundtracks', parentId: null },
    { id: 'g2', name: 'Chapter: 1', parentId: 'g1' },
  ];
  assert.equal(groupFolderPath(groups[1], groups), 'Soundtracks/Chapter 1'); // group path = ancestry + own name
  assert.equal(albumFolderPath({ title: 'Night City', parentId: 'g2' }, groups), 'Soundtracks/Chapter 1/Night City');
  assert.equal(albumFolderPath({ title: 'Loose', parentId: null }, groups), 'Loose'); // ungrouped → root
  // a self-referential group must not loop forever
  const cyc = [{ id: 'c', name: 'C', parentId: 'c' }];
  assert.equal(albumFolderPath({ title: 'X', parentId: 'c' }, cyc), 'C/X');
}

// Import planner: dedup existing (by id), create nested groups once, and be idempotent on re-scan.
{
  const groups = [{ id: 'g1', name: 'A', parentId: null }];
  const projects = [{ id: 'p1', title: 'Alpha', parentId: 'g1', tracks: [] }];
  let gc = 0, pc = 0;
  const scanned = [
    { groupPath: ['A'], folderName: 'Alpha', json: { id: 'p1', title: 'Alpha', tracks: [] } },        // exists (by id) → skip
    { groupPath: ['A', 'B'], folderName: 'Beta', json: { title: 'Beta', tracks: [{ type: 'music', title: 'x', lengthSec: 30 }] } }, // new group B + album
    { groupPath: ['A', 'B'], folderName: 'Gamma', json: { title: 'Gamma', tracks: [] } },              // reuse B, new album
  ];
  const plan = planImport(scanned, groups, projects, () => 'ng' + gc++, () => 'np' + pc++);
  assert.equal(plan.newGroups.length, 1, 'group B created once (A reused)');
  assert.equal(plan.newGroups[0].name, 'B');
  assert.equal(plan.newProjects.length, 2, 'Beta + Gamma imported');
  assert.equal(plan.newProjects[0].proj.parentId, plan.newGroups[0].id, 'Beta placed under B');
  assert.equal(plan.newProjects[0].writeBack, true, 'no id in file → id written back');
  assert.equal(plan.newProjects[0].proj.tracks.length, 1, 'agent tracks carried in');
  // apply and re-scan → nothing new
  const g2 = [...groups, ...plan.newGroups];
  const p2 = [...projects, ...plan.newProjects.map((x) => x.proj)];
  const plan2 = planImport(scanned, g2, p2, () => 'x', () => 'y');
  assert.equal(plan2.newGroups.length + plan2.newProjects.length, 0, 're-scan is idempotent');
}

// Track edits: trim both ends, gain, and linear fades.
{
  const L = new Float32Array(100).fill(1);
  const out = applyEdits([L], 100, { trimStartMs: 100, trimEndMs: 100, gain: 0.5, fadeInMs: 100, fadeOutMs: 100 })[0];
  assert.equal(out.length, 80, 'trimmed 10 samples each end (sr=100)');
  assert.equal(out[0], 0, 'fade-in starts at 0');
  assert.ok(Math.abs(out[40] - 0.5) < 1e-6, 'mid = gain');
  assert.ok(out[79] > 0 && out[79] < 0.5, 'fade-out tail below gain');
}

// Album assembly: gap vs crossfade lengths.
{
  const mk = () => ({ channels: [new Float32Array(100).fill(1), new Float32Array(100).fill(1)] });
  const gapped = assembleAlbum([mk(), mk()], { gapMs: 100, sampleRate: 100 }); // gap=10
  assert.equal(gapped.channels[0].length, 210, '100 + gap10 + 100');
  assert.equal(gapped.channels[0][105], 0, 'gap region is silent');
  const xf = assembleAlbum([mk(), mk()], { crossfadeMs: 100, sampleRate: 100 }); // overlap=10
  assert.equal(xf.channels[0].length, 190, 'overlap shortens by 10');
}

// ID3 embeds cover art (APIC + mime present).
{
  const t = buildId3v2({ title: 'a', picture: { mime: 'image/png', bytes: new Uint8Array([1, 2, 3, 4]) } });
  const ascii = String.fromCharCode(...t);
  assert.ok(ascii.includes('APIC') && ascii.includes('image/png'), 'cover frame present');
}

// Gaps + duplicate detection.
{
  assert.equal(isGap({ type: 'music', prompt: 'x' }), true, 'song with prompt, no clip = gap');
  assert.equal(isGap({ type: 'music', prompt: '' }), false, 'no prompt = not a gap');
  assert.equal(isGap({ type: 'music', prompt: 'x', clipId: 'c' }), false, 'has clip = not a gap');
  assert.equal(isGap({ type: 'dialog', text: 'hi', voiceId: 'v' }), true);
  assert.equal(isGap({ type: 'dialog', text: 'hi' }), false, 'dialog needs a voice');
  assert.equal(isGap({ type: 'upload', clipId: 'c' }), false);
  // trackKey normalizes case/whitespace; dialog key includes voice
  assert.equal(trackKey({ type: 'music', prompt: 'Lo-Fi  Beat' }), trackKey({ type: 'music', prompt: 'lo-fi beat' }));
  assert.notEqual(trackKey({ type: 'dialog', text: 'hi', voiceId: 'a' }), trackKey({ type: 'dialog', text: 'hi', voiceId: 'b' }));
  const dups = duplicateIds([
    { id: 'a', type: 'music', prompt: 'x' },
    { id: 'b', type: 'music', prompt: 'X ' },   // dup of a
    { id: 'c', type: 'music', prompt: 'y' },
    { id: 'd', type: 'music', prompt: '' },      // empty → never a dup
    { id: 'e', type: 'music', prompt: '' },
  ]);
  assert.deepEqual([...dups], ['b'], 'only the 2nd occurrence is flagged; empties ignored');
}

// Playlists: static references resolve in order (skipping missing/no-audio); dynamic rules filter.
{
  const groups = [{ id: 'g1', name: 'A', parentId: null }, { id: 'g2', name: 'B', parentId: 'g1' }];
  const projects = [
    { id: 'p1', title: 'Alpha', parentId: 'g1', meta: { genre: 'Jazz' }, tracks: [
      { id: 't1', type: 'music', title: 'One', clipId: 'c1', fav: true }, { id: 't2', type: 'dialog', title: 'Skit', clipId: 'c2' }, { id: 't3', type: 'music', title: 'NoAudio' } ] },
    { id: 'p2', title: 'Beta', parentId: 'g2', meta: { genre: 'Rock' }, tracks: [{ id: 't4', type: 'music', title: 'Two', clipId: 'c4' }] },
  ];
  const stat = resolvePlaylist({ kind: 'static', items: [{ projectId: 'p2', trackId: 't4' }, { projectId: 'p1', trackId: 't1' }, { projectId: 'p1', trackId: 't3' }, { projectId: 'x', trackId: 'y' }] }, projects, groups);
  assert.deepEqual(stat.map((t) => t.id), ['t4', 't1'], 'static keeps order, drops no-audio (t3) and missing');
  assert.equal(stat[0]._album, 'Beta');
  assert.equal(resolvePlaylist({ kind: 'dynamic', rule: { field: 'all' } }, projects, groups).length, 3, 'all playable');
  assert.deepEqual(resolvePlaylist({ kind: 'dynamic', rule: { field: 'group', value: 'g1' } }, projects, groups).map((t) => t.id), ['t1', 't2', 't4'], 'group is recursive');
  assert.deepEqual(resolvePlaylist({ kind: 'dynamic', rule: { field: 'type', value: 'dialog' } }, projects, groups).map((t) => t.id), ['t2']);
  assert.deepEqual(resolvePlaylist({ kind: 'dynamic', rule: { field: 'genre', value: 'jazz' } }, projects, groups).map((t) => t.id), ['t1', 't2']);
  assert.deepEqual(resolvePlaylist({ kind: 'dynamic', rule: { field: 'search', value: 'two' } }, projects, groups).map((t) => t.id), ['t4']);
  assert.deepEqual(resolvePlaylist({ kind: 'dynamic', rule: { field: 'favorites' } }, projects, groups).map((t) => t.id), ['t1'], 'favorites filter');
}

// Backup base64 round-trips arbitrary bytes (including high/edge values).
{
  const bytes = new Uint8Array([0, 1, 2, 63, 64, 127, 128, 200, 254, 255]);
  assert.deepEqual([...new Uint8Array(b64ToBuf(bufToB64(bytes.buffer)))], [...bytes], 'base64 round-trip');
}

// Device-sync planner: publish selected albums that are missing or stale; remove deselected
// app-published folders (m3u marker); never touch foreign folders.
{
  const { planSync } = await import('../backup/sync.js');
  const projects = [
    { id: 'a', title: 'Alpha', updatedAt: 100, tracks: [{ clipId: 'c1' }] },
    { id: 'b', title: 'Beta', updatedAt: 100, tracks: [{ clipId: 'c2' }] },
    { id: 'c', title: 'Gamma', updatedAt: 100, tracks: [{}] },              // no audio → never published
    { id: 'd', title: 'Delta', updatedAt: 50, tracks: [{ clipId: 'c3' }] }, // synced + fresh → skip
  ];
  const syncMap = { a: { on: true, at: 0 }, c: { on: true, at: 0 }, d: { on: true, at: 60 } };
  const dirs = [
    { name: 'Delta', hasM3u: true },   // synced, up to date
    { name: 'Beta', hasM3u: true },    // NOT selected → remove
    { name: 'Photos', hasM3u: false }, // foreign folder → untouched
  ];
  const plan = planSync(projects, syncMap, dirs);
  assert.deepEqual(plan.toWrite.map((p) => p.id), ['a'], 'Alpha missing on device → publish; Gamma no audio; Delta fresh');
  assert.deepEqual(plan.toRemove, ['Beta'], 'deselected app folder removed, foreign folder kept');
  const stale = planSync(projects, { d: { on: true, at: 40 } }, dirs); // Delta updated after last sync
  assert.ok(stale.toWrite.some((p) => p.id === 'd'), 'stale album republished');
}

// Drive catalog channel: desktop publishes the library; phone publishes a full desired set.
{
  const { buildCatalog, buildRequests, requestsPending, pendingChanges, initialWant } = await import('../cloud/catalog.js');
  const groups = [{ id: 'g1', name: 'Cycle 1', parentId: null }];
  const projects = [
    { id: 'a', title: 'Alpha', parentId: 'g1', description: 'brief A', updatedAt: 5, tracks: [{ title: 'One', clipId: 'c', durationMs: 1000, prompt: 'p1' }] },
    { id: 'b', title: 'Beta', parentId: null, tracks: [{ title: 'Two', prompt: 'p2' }] }, // no audio
  ];
  const cat = buildCatalog(projects, groups, { a: { on: true, at: 7 } }, { device: 'PC', appliedAt: 3 }, 42);
  const byId = (id) => cat.albums.find((x) => x.id === id);
  assert.equal(cat.updatedAt, 42);
  assert.deepEqual(cat.albums.map((x) => x.path), ['Beta', 'Cycle 1/Alpha'], 'sorted by folder path');
  assert.equal(byId('a').path, 'Cycle 1/Alpha', 'group tree travels as a path');
  assert.equal(byId('a').onDevice, true);
  assert.equal(byId('a').tracks[0].prompt, 'p1', 'prompts travel so the phone can read them');
  assert.equal(byId('b').readyCount, 0);

  assert.equal(requestsPending(buildRequests(['a'], {}, 10), 3), true, 'newer request applies');
  assert.equal(requestsPending(buildRequests(['a'], {}, 2), 3), false, 'already-applied request is ignored');
  assert.equal(requestsPending(null, 0), false, 'no request file → nothing to do');

  // Phone badges: wanting an audio-less album is "blocked", not "add".
  const chg = pendingChanges(cat, ['b']);
  assert.deepEqual(chg.find((c) => c.id === 'b'), { id: 'b', title: 'Beta', action: 'blocked' });
  assert.deepEqual(chg.find((c) => c.id === 'a'), { id: 'a', title: 'Alpha', action: 'remove' });
  assert.equal(chg.length, 2);
  assert.deepEqual(pendingChanges(cat, ['a']), [], 'already on device → nothing pending');

  // Checkbox seed: a request newer than the last applied wins; otherwise real device state.
  assert.deepEqual([...initialWant(cat, buildRequests(['b'], {}, 9))], ['b'], 'unapplied request wins');
  assert.deepEqual([...initialWant(cat, buildRequests(['b'], {}, 1))], ['a'], 'stale request → device state');
  assert.deepEqual([...initialWant(cat, null)], ['a']);
}

// Paste-prompts parser: numbered "Title — prompt" lines, headings + body, and plain blocks.
{
  const a = parsePromptBlob('1. "Neon Rain" — darksynth, heavy arps\n2) Steel Sky: ambient drone');
  assert.deepEqual(a, [{ title: 'Neon Rain', prompt: 'darksynth, heavy arps' }, { title: 'Steel Sky', prompt: 'ambient drone' }]);
  const b = parsePromptBlob('## Opening\nslow build, strings\nlong pads\n\n## Finale\nhuge drums');
  assert.equal(b.length, 2);
  assert.equal(b[0].title, 'Opening');
  assert.ok(b[0].prompt.includes('strings') && b[0].prompt.includes('long pads'), 'body lines joined');
  const c = parsePromptBlob('lo-fi hip-hop, mellow piano, vinyl crackle at 80 BPM');
  assert.deepEqual(c, [{ title: '', prompt: 'lo-fi hip-hop, mellow piano, vinyl crackle at 80 BPM' }], 'hyphens inside words never split a title');
  assert.deepEqual(parsePromptBlob('  \n\n'), [], 'blank input → no tracks');
}

// Library table + wizards: rows/filter/stats, rearrange planning (cycles, clashes, new groups), pairing.
{
  const L = await import('../album/library.js');
  let n = 0; const mk = () => `g${++n}`;
  const groups = [{ id: 'a', name: 'Synth', parentId: null }, { id: 'b', name: 'Cycle 1', parentId: 'a' }, { id: 'c', name: 'Orchestral', parentId: null }];
  const projects = [
    { id: 'p1', title: 'Neon', parentId: 'b', meta: { genre: 'Darksynth', year: 2026 }, tracks: [
      { id: 't1', type: 'music', title: 'Rain', prompt: 'heavy arps', clipId: 'c1', durationMs: 60000, fav: true },
      { id: 't2', type: 'music', title: 'Steel', prompt: 'drone', lengthMs: 120000 }] },
    { id: 'p2', title: 'Hymns', parentId: 'c', meta: {}, tracks: [{ id: 't3', type: 'upload', title: 'Bells', clipId: 'c3', durationMs: 30000 }] },
  ];
  const rows = L.libraryRows(projects, groups);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].group, 'Synth/Cycle 1');
  assert.deepEqual(L.filterRows(rows, { group: 'Synth' }).map((r) => r.id), ['t1', 't2'], 'group filter covers its subtree');
  assert.deepEqual(L.filterRows(rows, { q: 'darksynth arps' }).map((r) => r.id), ['t1'], 'every word must match');
  assert.deepEqual(L.filterRows(rows, { status: 'gap' }).map((r) => r.id), ['t2']);
  assert.deepEqual(L.filterRows(rows, { fav: true }).map((r) => r.id), ['t1']);
  assert.deepEqual(L.sortRows(rows, 'ms', -1).map((r) => r.id), ['t1', 't3', 't2']);
  const s = L.libraryStats(rows);
  assert.deepEqual([s.albums, s.tracks, s.ready, s.gaps, s.ms, s.favs], [2, 3, 2, 1, 90000, 1]);
  assert.ok(Math.abs(s.gapCost - musicCost(120000)) < 1e-9, 'gap cost uses the planned length');
  assert.equal(L.breakdown(rows, (r) => r.group.split('/')[0])[0].k, 'Synth');
  assert.equal(L.toCsv([{ a: 'x,"y"', b: 1 }], ['a', 'b']), 'a,b\n"x,""y""",1');

  // Rearrange: new nested path is created once; a group can't go inside itself; same-name lands are blocked; no-ops drop.
  const plan = L.planRearrange([
    { kind: 'album', id: 'p1', dest: 'Archive/2026' },
    { kind: 'album', id: 'p2', dest: 'Archive/2026' },
    { kind: 'group', id: 'a', dest: 'Synth/Cycle 1' },
  ], groups, projects, mk);
  assert.deepEqual(plan.created.map((g) => g.name), ['Archive', '2026']);
  assert.deepEqual(plan.moves.map((m) => [m.id, m.from, m.to]), [['p1', 'Synth/Cycle 1/Neon', 'Archive/2026/Neon'], ['p2', 'Orchestral/Hymns', 'Archive/2026/Hymns']]);
  assert.deepEqual(plan.blocked, [{ id: 'a', why: 'into itself' }]);
  const clash = L.planRearrange([{ kind: 'album', id: 'p2', dest: 'Synth/Cycle 1' }], groups, [...projects, { id: 'p3', title: 'Hymns', parentId: 'b' }], mk);
  assert.deepEqual(clash.blocked, [{ id: 'p2', why: 'name taken there' }]);
  assert.equal(clash.created.length, 0);
  assert.equal(L.planRearrange([{ kind: 'album', id: 'p1', dest: 'Synth/Cycle 1' }], groups, projects, mk).moves.length, 0, 'already there → no-op');
  assert.equal(L.albumField(projects[0], 'genre'), 'Darksynth');

  // Pairing: track numbers / app suffix / punctuation ignored; containment as fallback; leftovers both ways.
  assert.equal(L.normTitle('03 - Neon Rain_k3x9a.wav'), 'neon rain');
  assert.equal(L.normTitle('Mr.Big'), 'mr big', 'a dotted title is not an extension');
  assert.equal(L.fileTitle('song_intro.mp3'), 'song_intro', 'a real suffix survives');
  const files = [{ name: '02 Steel Sky.wav' }, { name: '01 Neon Rain_k3x9a.mp3' }, { name: 'Outro.flac' }];
  const pairs = L.pairItems([{ title: 'Neon Rain!', prompt: 'p1' }, { title: 'Steel', prompt: 'p2' }, { title: 'Ghost', prompt: 'p3' }], files);
  assert.deepEqual(pairs.map((r) => [r.title, r.prompt, r.file?.name || null]), [
    ['Neon Rain!', 'p1', '01 Neon Rain_k3x9a.mp3'], ['Steel', 'p2', '02 Steel Sky.wav'], ['Ghost', 'p3', null], ['Outro', '', 'Outro.flac']]);
  assert.deepEqual(L.promptsFromText('Neon Rain.txt', 'darksynth, 120 BPM', parsePromptBlob), [{ title: 'Neon Rain', prompt: 'darksynth, 120 BPM' }], 'one-prompt file is titled by its name');
  assert.equal(L.promptsFromText('list.md', '1. A — x\n2. B — y', parsePromptBlob).length, 2);

  // Source links: a pasted song-page URL is lifted off the prompt; only http(s) is ever rendered; album.json round-trips it.
  const [u] = L.pairItems(parsePromptBlob('1. Glass — ambient synth https://elevenlabs.io/music/songs/abc123'), []);
  assert.deepEqual([u.prompt, u.url], ['ambient synth', 'https://elevenlabs.io/music/songs/abc123']);
  assert.equal(L.safeUrl('javascript:alert(1)'), '');
  assert.equal(L.safeUrl(' https://elevenlabs.io/x '), 'https://elevenlabs.io/x');
  const sk = { id: 'p', title: 'A', tracks: [{ id: 't', type: 'music', title: 'x', prompt: 'p', sourceUrl: 'https://elevenlabs.io/s/1' }] };
  assert.equal(mergeSkeleton(sk, buildAlbumJson(sk)).tracks[0].sourceUrl, 'https://elevenlabs.io/s/1');
  assert.equal(L.libraryRows([{ ...sk, tracks: [{ ...sk.tracks[0], sourceUrl: 'javascript:x' }] }])[0].url, '', 'unsafe links never reach the table');
}

// Model choice: unpinned tracks (incl. every legacy track storing music_v1/v2) generate on the newest
// model; only an in-app pin holds an older one; album.json can't pin or downgrade.
{
  const { MUSIC_MODELS, LATEST_MUSIC_MODEL, musicModelFor, newTrackModel } = await import('../api/elevenlabs.js');
  assert.equal(LATEST_MUSIC_MODEL, MUSIC_MODELS[0].id);
  assert.equal(LATEST_MUSIC_MODEL, 'music_v2_5');
  assert.equal(musicModelFor({ model: 'music_v2' }), 'music_v2_5', 'legacy stored model is history, not a choice');
  assert.equal(musicModelFor({ model: 'music_v2', modelPinned: true }), 'music_v2');
  assert.equal(musicModelFor({ model: 'bogus', modelPinned: true }), 'music_v2_5', 'unknown pins fall back to latest');
  assert.deepEqual(newTrackModel({ musicModel: 'latest' }), { model: 'music_v2_5', modelPinned: false });
  assert.deepEqual(newTrackModel({ musicModel: 'music_v1' }), { model: 'music_v1', modelPinned: true });
  const proj = { id: 'p', title: 'A', tracks: [{ id: 'u', type: 'music', prompt: 'x', model: 'music_v2' }, { id: 'k', type: 'music', prompt: 'y', model: 'music_v1', modelPinned: true }] };
  const json = buildAlbumJson(proj);
  assert.deepEqual(json.tracks.map((t) => t.model), ['latest', 'music_v1']);
  json.tracks[0].model = 'music_v1'; json.tracks.push({ id: 'n', type: 'music', prompt: 'z', model: 'music_v2' });
  const merged = mergeSkeleton(proj, json).tracks;
  assert.deepEqual(merged.map(musicModelFor), ['music_v2_5', 'music_v1', 'music_v2_5'], 'album.json edits never pin/downgrade; the app pin survives');
}

// Markdown preview: escapes HTML first (no injection), renders the safe subset, refuses non-http links.
{
  const { renderMarkdown } = await import('../album/markdown.js');
  const html = renderMarkdown('# Notes\n\nSome **bold** and *it* `x<y`\n\n- one\n- two\n\n1. a\n\n> quote\n\n[ok](https://e.io) [bad](javascript:alert(1))\n\n```\n<b>raw</b>\n```\n<script>alert(1)</script>');
  for (const frag of ['<h1>Notes</h1>', '<strong>bold</strong>', '<em>it</em>', '<code>x&lt;y</code>', '<ul><li>one</li><li>two</li></ul>', '<ol><li>a</li></ol>', '<blockquote>quote</blockquote>', '<a href="https://e.io"', '<pre><code>&lt;b&gt;raw&lt;/b&gt;</code></pre>', '&lt;script&gt;'])
    assert.ok(html.includes(frag), 'markdown: ' + frag);
  assert.ok(!html.includes('<script') && !html.includes('href="javascript'), 'markdown never emits live script or js: links');
  assert.ok(renderMarkdown('snake_case_name').includes('snake_case_name'), 'underscores inside words stay literal');
  const { parseCsv } = await import('../album/markdown.js');
  assert.deepEqual(parseCsv('a,b\n"x, y","say ""hi"""\r\n"multi\nline",2\n'), [['a', 'b'], ['x, y', 'say "hi"'], ['multi\nline', '2']]);
  assert.deepEqual(parseCsv('a\tb\n1\t2', '\t'), [['a', 'b'], ['1', '2']]);
}

console.log('ok — wav/pricing/skeleton/path/import/edits/gaps/playlists/backup/paste/sync/catalog/library/markdown self-check passed');
