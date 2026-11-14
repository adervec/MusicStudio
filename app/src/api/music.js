// ElevenLabs music endpoints beyond plain compose: detailed generation (song id, ElevenLabs' own
// title/genres, word timestamps, the plan it used), composition plans, upload + plan extraction
// (reverse-engineering), stem separation, sound effects, video → music, finetunes.
// Browser-direct with the user's key, like ./elevenlabs.js. Shapes per the OpenAPI spec (2026-11-07).
import { recordUsage } from '../state/db.js';
import { musicCost } from '../state/pricing.js';

const BASE = 'https://api.elevenlabs.io/v1';
const spent = () => globalThis.dispatchEvent?.(new Event('musicstudio:spent'));
const hdr = (apiKey, json = true) => ({ 'xi-api-key': (apiKey || '').trim(), ...(json ? { 'Content-Type': 'application/json' } : {}) });
async function fail(r) {
  if (r.status === 401) return new Error('Invalid ElevenLabs API key (or it lacks access to this feature).');
  if (r.status === 429) return new Error('ElevenLabs rate limit / quota reached.');
  try { const e = await r.json(); const d = e?.detail; return new Error(d?.message || (typeof d === 'string' ? d : Array.isArray(d) ? d.map((x) => x.msg).join('; ') : `ElevenLabs error ${r.status}`)); }
  catch { return new Error(`ElevenLabs error ${r.status}`); }
}

// ── Pure helpers (tested in ../audio/wav.test.mjs) ────────────────────────────────────────────

// multipart/mixed body → [{ headers: {lowercased}, body: Uint8Array }].
export function parseMultipart(bytes, boundary) {
  const enc = new TextEncoder(), dec = new TextDecoder();
  const delim = enc.encode('--' + boundary);
  const find = (from, pat) => { outer: for (let i = from; i <= bytes.length - pat.length; i++) { for (let j = 0; j < pat.length; j++) if (bytes[i + j] !== pat[j]) continue outer; return i; } return -1; };
  const parts = []; let at = find(0, delim);
  while (at >= 0) {
    let start = at + delim.length;
    if (bytes[start] === 0x2d && bytes[start + 1] === 0x2d) break; // closing "--boundary--"
    if (bytes[start] === 0x0d) start += 2; else if (bytes[start] === 0x0a) start += 1;
    const next = find(start, delim); if (next < 0) break;
    let end = next; if (bytes[end - 1] === 0x0a) end--; if (bytes[end - 1] === 0x0d) end--;
    const crlf = find(start, enc.encode('\r\n\r\n')), lf = find(start, enc.encode('\n\n'));
    const sep = crlf >= 0 && crlf < end ? [crlf, 4] : lf >= 0 && lf < end ? [lf, 2] : null;
    if (sep) {
      const headers = {};
      for (const line of dec.decode(bytes.subarray(start, sep[0])).split(/\r?\n/)) { const k = line.indexOf(':'); if (k > 0) headers[line.slice(0, k).trim().toLowerCase()] = line.slice(k + 1).trim(); }
      parts.push({ headers, body: bytes.subarray(sep[0] + sep[1], end) });
    }
    at = next;
  }
  return parts;
}

// ZIP → [{ name, bytes }] using the browser/Node native DecompressionStream (no dependency).
// ponytail: stored + deflate only, no zip64/encryption — what the stem endpoint returns.
export async function unzip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1; for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a zip file');
  const count = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  const out = [], dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Bad zip directory');
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    const dataAt = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const raw = bytes.subarray(dataAt, dataAt + csize);
    let data;
    if (method === 0) data = raw.slice();
    else if (method === 8) data = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    else throw new Error(`Unsupported zip compression (${method})`);
    out.push({ name, bytes: data });
  }
  return out;
}

// The JSON body for /v1/music(/detailed) from a track + options. A plan (v2/v2.5 `chunks`) replaces
// the prompt; music_v1 can't take a v2 plan.
export function composeBody(tk, { model, seed, phonetic = false, c2pa = false, finetuneId = '', finetuneStrength = 1, storeForInpainting = true, withTimestamps = true, plan = null } = {}) {
  const usePlan = plan || (tk.usePlan && tk.plan?.chunks?.length ? tk.plan : null);
  const body = { model_id: model, force_instrumental: !!tk.instrumental, use_phonetic_names: !!phonetic, sign_with_c2pa: !!c2pa, store_for_inpainting: !!storeForInpainting, with_timestamps: !!withTimestamps };
  if (usePlan) {
    if (model === 'music_v1') throw new Error('Composition plans need Music v2 or newer — unpin Music v1 for this track.');
    body.composition_plan = { chunks: usePlan.chunks.map(cleanChunk) };
    body.respect_sections_durations = tk.respectDurations !== false;
  } else {
    body.prompt = (tk.prompt || '').trim();
    body.music_length_ms = Math.max(3000, Math.min(600000, Math.round(tk.lengthMs || 60000)));
    if ((tk.lyrics || '').trim() && !tk.instrumental) body.lyrics_text = tk.lyrics.trim();
  }
  if (Number.isInteger(seed)) body.seed = seed;
  if (finetuneId) { body.finetune_id = finetuneId; body.finetune_strength = Math.max(0, Math.min(2, +finetuneStrength || 1)); }
  return body;
}
// A plan chunk exactly as the API wants it (drops UI-only fields, clamps durations).
export function cleanChunk(c) {
  if (c.song_id) return { song_id: c.song_id, range: { start_ms: Math.round(c.range.start_ms), end_ms: Math.round(c.range.end_ms) } };
  const out = {
    text: String(c.text || '').slice(0, 6132),
    duration_ms: Math.max(3000, Math.min(120000, Math.round(c.duration_ms || 10000))),
    positive_styles: (c.positive_styles || []).map(String).filter(Boolean).slice(0, 50),
    negative_styles: (c.negative_styles || []).map(String).filter(Boolean).slice(0, 50),
    context_adherence: ['low', 'medium', 'high'].includes(c.context_adherence) ? c.context_adherence : 'high',
  };
  if (c.conditioning_ref?.song_id) { out.conditioning_ref = { song_id: c.conditioning_ref.song_id, range: c.conditioning_ref.range }; if (c.condition_strength) out.condition_strength = c.condition_strength; }
  return out;
}
export const chunkMs = (c) => (c.song_id ? Math.max(0, (c.range?.end_ms || 0) - (c.range?.start_ms || 0)) : (c.duration_ms || 0));
export const planMs = (plan) => (plan?.chunks || []).reduce((s, c) => s + chunkMs(c), 0);

// Plans from music_v1 (sections) → v2 chunks, so every plan the app holds has one shape.
export function toChunks(plan) {
  if (!plan) return null;
  if (Array.isArray(plan.chunks)) return { chunks: plan.chunks.map((c) => ({ ...c })) };
  if (Array.isArray(plan.sections)) {
    const g = plan.positive_global_styles || [], ng = plan.negative_global_styles || [];
    return { chunks: plan.sections.map((s, i) => ({
      text: [`[${s.section_name || `Section ${i + 1}`}]`, ...(s.lines || [])].join('\n'),
      duration_ms: s.duration_ms, positive_styles: [...(i === 0 ? g : []), ...(s.positive_local_styles || [])],
      negative_styles: [...(i === 0 ? ng : []), ...(s.negative_local_styles || [])], context_adherence: 'high',
    })) };
  }
  return null;
}

// Inpainting: keep the song outside [fromMs, toMs] (audio reference chunks of the stored song) and
// regenerate only the middle from `chunk`. Ranges under 3 s at the edges are folded into the new part.
export function inpaintPlan(songId, durMs, fromMs, toMs, chunk) {
  let a = Math.max(0, Math.round(fromMs)), b = Math.min(Math.round(durMs), Math.round(toMs));
  if (a < 3000) a = 0; if (durMs - b < 3000) b = Math.round(durMs);
  if (b - a < 3000) throw new Error('The part to regenerate must be at least 3 seconds.');
  const chunks = [];
  if (a > 0) chunks.push({ song_id: songId, range: { start_ms: 0, end_ms: a } });
  chunks.push({ ...chunk, duration_ms: Math.min(120000, b - a) });
  if (b < durMs) chunks.push({ song_id: songId, range: { start_ms: b, end_ms: Math.round(durMs) } });
  return { chunks };
}

// Word timestamps → LRC (synced lyrics; foobar2000 and most players read <audio>.lrc). New line on a
// pause > 0.8 s, sentence end, or every 9 words.
export function lrcFromWords(words, { title = '', artist = '', album = '' } = {}) {
  const w = (words || []).filter((x) => String(x.word || '').trim());
  if (!w.length) return '';
  const stamp = (ms) => { const s = Math.max(0, ms) / 1000; return `[${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}]`; };
  const lines = []; let cur = [];
  w.forEach((x, i) => {
    cur.push(x);
    const nx = w[i + 1], word = String(x.word).trim();
    if (!nx || nx.start_ms - x.end_ms > 800 || /[.!?…]$/.test(word) || cur.length >= 9) { lines.push(cur); cur = []; }
  });
  const head = [title && `[ti:${title}]`, artist && `[ar:${artist}]`, album && `[al:${album}]`].filter(Boolean);
  return [...head, ...lines.map((l) => stamp(l[0].start_ms) + l.map((x) => String(x.word).trim()).join(' '))].join('\n') + '\n';
}
// Word timestamps → plain lyric text (for a lyrics field reverse-engineered from a song).
export const lyricsFromWords = (words) => lrcFromWords(words).split('\n').map((l) => l.replace(/^\[[^\]]*\]/, '')).filter(Boolean).join('\n');

// ── Endpoints ─────────────────────────────────────────────────────────────────────────────────

// Generate a song with the detailed response → { blob, songId, meta: { composition_plan, song_metadata, words_timestamps } }.
export async function composeDetailed(body, apiKey) {
  const r = await fetch(`${BASE}/music/detailed?output_format=mp3_44100_128`, { method: 'POST', headers: hdr(apiKey), body: JSON.stringify(body) });
  if (!r.ok) throw await fail(r);
  const ct = r.headers.get('content-type') || '';
  const bytes = new Uint8Array(await r.arrayBuffer());
  let meta = {}, audio = null, audioType = 'audio/mpeg';
  const boundary = ct.match(/boundary="?([^";]+)"?/i)?.[1];
  if (boundary) {
    for (const part of parseMultipart(bytes, boundary)) {
      const pct = part.headers['content-type'] || '';
      if (pct.includes('json')) { try { meta = JSON.parse(new TextDecoder().decode(part.body)); } catch { /* keep going */ } }
      else if (pct.startsWith('audio/') || part.headers['content-disposition']) { audio = part.body; audioType = pct.startsWith('audio/') ? pct : audioType; }
    }
  } else audio = bytes; // plain audio (older behaviour)
  if (!audio?.length) throw new Error('ElevenLabs returned no audio.');
  const ms = body.composition_plan ? body.composition_plan.chunks.reduce((s, c) => s + chunkMs(c), 0) : body.music_length_ms;
  await recordUsage({ kind: 'music', model: body.model_id, source: body.composition_plan ? 'plan' : 'compose', ms, costUsd: musicCost(ms) });
  spent();
  return { blob: new Blob([audio], { type: audioType.split(';')[0] }), songId: r.headers.get('song-id') || meta.song_id || null, meta };
}

// Draft a composition plan from a prompt (optionally reworking an existing plan).
export async function draftPlan({ prompt, lengthMs = null, model, source = null }, apiKey) {
  const body = { prompt: String(prompt || '').slice(0, 4100), model_id: model };
  if (lengthMs) body.music_length_ms = Math.max(3000, Math.min(600000, Math.round(lengthMs)));
  if (source?.chunks?.length) body.source_composition_plan = { chunks: source.chunks.map(cleanChunk) };
  const r = await fetch(`${BASE}/music/plan`, { method: 'POST', headers: hdr(apiKey), body: JSON.stringify(body) });
  if (!r.ok) throw await fail(r);
  return toChunks(await r.json());
}

// Upload an existing song → { songId, plan, words } (plan + lyrics reverse-engineered by ElevenLabs).
export async function uploadSong(blob, { extractPlanModel = null, withTimestamps = true, name = 'song.mp3' } = {}, apiKey) {
  const fd = new FormData();
  fd.append('file', blob, name);
  if (extractPlanModel) fd.append('extract_composition_plan', extractPlanModel);
  fd.append('with_timestamps', withTimestamps ? 'true' : 'false');
  const r = await fetch(`${BASE}/music/upload`, { method: 'POST', headers: hdr(apiKey, false), body: fd });
  if (!r.ok) throw await fail(r);
  const j = await r.json();
  return { songId: j.song_id, plan: toChunks(j.composition_plan), words: j.words_timestamps || [] };
}

// Split a song into stems → [{ name, blob }]. variation: 'six_stems_v1' | 'two_stems_v1'.
export async function separateStems(blob, variation = 'six_stems_v1', apiKey, name = 'song.mp3') {
  const fd = new FormData(); fd.append('file', blob, name); fd.append('stem_variation_id', variation);
  const r = await fetch(`${BASE}/music/stem-separation?output_format=mp3_44100_128`, { method: 'POST', headers: hdr(apiKey, false), body: fd });
  if (!r.ok) throw await fail(r);
  const files = await unzip(new Uint8Array(await r.arrayBuffer()));
  await recordUsage({ kind: 'music', model: variation, source: 'stems', ms: 0, costUsd: 0 }); // ponytail: price unpublished — logged at $0
  spent();
  return files.map((f) => ({ name: f.name.split('/').pop(), blob: new Blob([f.bytes], { type: /\.wav$/i.test(f.name) ? 'audio/wav' : 'audio/mpeg' }) }));
}

export const SFX_MODELS = [{ id: 'eleven_text_to_sound_v3', label: 'Sound Effects v3 — newest' }, { id: 'eleven_text_to_sound_v2', label: 'Sound Effects v2' }];
// Sound effect → mp3 Blob. durationSec null = let the model decide (0.5–30 s).
export async function soundEffect({ text, durationSec = null, loop = false, promptInfluence = 0.3, model = SFX_MODELS[0].id }, apiKey) {
  const body = { text: String(text || '').trim(), loop: !!loop, prompt_influence: Math.max(0, Math.min(1, +promptInfluence)), model_id: model };
  if (durationSec) body.duration_seconds = Math.max(0.5, Math.min(30, +durationSec));
  const r = await fetch(`${BASE}/sound-generation?output_format=mp3_44100_128`, { method: 'POST', headers: hdr(apiKey), body: JSON.stringify(body) });
  if (!r.ok) throw await fail(r);
  const chars = +(r.headers.get('character-cost') || 0);
  await recordUsage({ kind: 'sfx', model, source: 'sfx', chars, costUsd: 0 }); // billed in credits (character-cost); $ unknown
  spent();
  return new Blob([await r.arrayBuffer()], { type: 'audio/mpeg' });
}

// Score a video (or several, combined in order) → { blob, songId }.
export async function videoToMusic({ videos, description = '', tags = [], model, addSfx = false, useAudioRef = false }, apiKey) {
  const fd = new FormData();
  for (const v of videos) fd.append('videos', v, v.name || 'video.mp4');
  if (description.trim()) fd.append('description', description.trim().slice(0, 4100));
  for (const tk of tags.slice(0, 10)) fd.append('tags', tk);
  fd.append('model_id', model); fd.append('add_sfx', addSfx ? 'true' : 'false'); fd.append('use_audio_as_reference', useAudioRef ? 'true' : 'false');
  const r = await fetch(`${BASE}/music/video-to-music?output_format=mp3_44100_128`, { method: 'POST', headers: hdr(apiKey, false), body: fd });
  if (!r.ok) throw await fail(r);
  const blob = new Blob([await r.arrayBuffer()], { type: 'audio/mpeg' });
  await recordUsage({ kind: 'music', model, source: 'video', ms: 0, costUsd: 0 }); // length unknown until decoded
  spent();
  return { blob, songId: r.headers.get('song-id') || null };
}

// Finetunes: list mine, create from audio files, poll one.
export async function listFinetunes(apiKey) {
  const out = []; let cursor = null;
  for (let page = 0; page < 10; page++) {
    const r = await fetch(`${BASE}/music/finetunes?page_size=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { headers: hdr(apiKey, false) });
    if (!r.ok) throw await fail(r);
    const j = await r.json(); out.push(...(j.finetunes || []));
    if (!j.has_more || !j.next_cursor) break; cursor = j.next_cursor;
  }
  return out;
}
export async function createFinetune({ name, genre, files, tags = [], model }, apiKey) {
  const fd = new FormData();
  fd.append('name', name); fd.append('primary_genre', genre || 'other'); fd.append('model_id', model); fd.append('visibility', 'private');
  for (const tk of tags) fd.append('tags', tk);
  for (const f of files.slice(0, 50)) fd.append('files', f.blob, f.name);
  const r = await fetch(`${BASE}/music/finetunes`, { method: 'POST', headers: hdr(apiKey, false), body: fd });
  if (!r.ok) throw await fail(r);
  return r.json();
}
