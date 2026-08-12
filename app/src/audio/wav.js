// Audio helpers: decode clips (Web Audio), assemble an album mixdown (per-track gain + gaps),
// encode WAV (mono or stereo), and tag/name tracks. encodeWav / ID3 / m3u / sanitize adapted from
// Tachyread's audiobookExport.js. The pure byte functions are node-testable — see wav.test.mjs.

export function sanitizeFilename(s) {
  return String(s || '').replace(/[\\/:*?"<>|\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70) || 'track';
}

// Zero-padded "NN Title.ext" so a file browser sorts tracks in album order.
export function trackFileName(index, total, title, ext) {
  const pad = String(Math.max(1, total)).length;
  return `${String(index + 1).padStart(pad, '0')} ${sanitizeFilename(title)}.${ext}`;
}

// ── Web Audio decode (browser only) ────────────────────────────────────────────────────────────
let _ctx = null;
export function audioCtx() {
  if (_ctx) return _ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  _ctx = new AC({ sampleRate: 44100 }); // decodeAudioData resamples every clip to this rate for free
  return _ctx;
}

export async function decodeBlob(blob) {
  const buf = await blob.arrayBuffer();
  return await audioCtx().decodeAudioData(buf);
}

export async function clipDurationMs(blob) {
  try { return Math.round((await decodeBlob(blob)).duration * 1000); } catch { return 0; }
}

// Normalize an AudioBuffer to exactly `channels` Float32Arrays (upmix mono→N, downmix by averaging).
function toChannels(ab, channels) {
  const out = [];
  for (let c = 0; c < channels; c++) {
    if (c < ab.numberOfChannels) out.push(ab.getChannelData(c));
    else if (ab.numberOfChannels === 1) out.push(ab.getChannelData(0)); // mono → duplicate
    else { // average all source channels into this extra one
      const m = new Float32Array(ab.length);
      for (let s = 0; s < ab.numberOfChannels; s++) { const d = ab.getChannelData(s); for (let i = 0; i < m.length; i++) m[i] += d[i] / ab.numberOfChannels; }
      out.push(m);
    }
  }
  return out;
}

// AudioBuffer → [L,R] stereo Float32 (up/downmix as needed).
export function bufferToStereo(ab) { return toChannels(ab, 2); }

// Per-track edit: trim [trimStartMs, len-trimEndMs), fade in/out (linear), and gain. Pure array math.
// Returns new [L,R]. See wav.test.mjs.
export function applyEdits(channels, sampleRate, { trimStartMs = 0, trimEndMs = 0, fadeInMs = 0, fadeOutMs = 0, gain = 1 } = {}) {
  const len = channels[0]?.length || 0;
  const s0 = Math.max(0, Math.min(len, Math.floor((trimStartMs / 1000) * sampleRate)));
  const s1 = Math.max(s0, Math.min(len, len - Math.floor((trimEndMs / 1000) * sampleRate)));
  const n = s1 - s0;
  const fi = Math.max(0, Math.min(n, Math.floor((fadeInMs / 1000) * sampleRate)));
  const fo = Math.max(0, Math.min(n, Math.floor((fadeOutMs / 1000) * sampleRate)));
  return channels.map((ch) => {
    const o = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let a = gain;
      if (fi && i < fi) a *= i / fi;
      if (fo && i >= n - fo) a *= (n - i) / fo;
      o[i] = (ch[s0 + i] || 0) * a;
    }
    return o;
  });
}

// Concatenate already-processed stereo tracks into one mixdown. crossfadeMs > 0 overlaps adjacent
// tracks (linear crossfade) and ignores the gap; otherwise inserts gapMs of silence. items:
// [{ channels:[L,R] }]. Returns { channels:[L,R], sampleRate }. Pure.
export function assembleAlbum(items, { gapMs = 800, crossfadeMs = 0, sampleRate = 44100 } = {}) {
  const cf = Math.max(0, Math.round((crossfadeMs / 1000) * sampleRate));
  const gap = cf > 0 ? 0 : Math.round((gapMs / 1000) * sampleRate);
  const ovAt = (i) => (i > 0 && cf > 0 ? Math.min(cf, items[i - 1].channels[0].length, items[i].channels[0].length) : 0);
  let total = 0;
  for (let i = 0; i < items.length; i++) { total += items[i].channels[0].length - ovAt(i) + (i < items.length - 1 ? gap : 0); }
  const L = new Float32Array(Math.max(0, total)), R = new Float32Array(Math.max(0, total));
  let end = 0;
  for (let i = 0; i < items.length; i++) {
    const [l, r] = items[i].channels; const n = l.length; const ov = ovAt(i); const start = end - ov;
    for (let j = 0; j < ov; j++) { const t = (j + 1) / (ov + 1); L[start + j] = L[start + j] * (1 - t) + l[j] * t; R[start + j] = R[start + j] * (1 - t) + r[j] * t; }
    for (let j = ov; j < n; j++) { L[start + j] = l[j]; R[start + j] = r[j]; }
    end = start + n + gap;
  }
  return { channels: [L, R], sampleRate };
}

// ── WAV encode (16-bit PCM, mono or stereo). Optional RIFF INFO tags. Pure. ────────────────────
function latin1(s) { const o = []; for (const ch of String(s ?? '')) { const c = ch.charCodeAt(0); o.push(c > 0xff ? 0x3f : c); } return o; }
function buildInfoList(tags = {}) {
  const sub = (id, text) => { const b = [...latin1(text), 0]; if (b.length % 2) b.push(0); return { id, bytes: b }; };
  const subs = [];
  const add = (id, v) => { if (v != null && v !== '') subs.push(sub(id, String(v))); };
  add('INAM', tags.title); add('IART', tags.artist); add('IPRD', tags.album);
  if (tags.track) add('ITRK', tags.trackTotal ? `${tags.track}/${tags.trackTotal}` : tags.track);
  add('IGNR', tags.genre); add('ICRD', tags.date || tags.year); add('IENG', tags.producer);
  add('ICOP', tags.copyright); add('ICMT', tags.comment); add('ILNG', tags.language);
  if (!subs.length) return null;
  let len = 4; for (const s of subs) len += 8 + s.bytes.length;
  return { len, subs };
}

// channels: array of Float32Array (1 or 2). All must be equal length.
export function encodeWav(channels, sampleRate, tags = null) {
  const ch = channels.length;
  const frames = channels[0]?.length || 0;
  const info = tags ? buildInfoList(tags) : null;
  const listBytes = info ? 8 + info.len : 0;
  const dataBytes = frames * ch * 2;
  const buf = new ArrayBuffer(44 + dataBytes + listBytes);
  const view = new DataView(buf);
  const wStr = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  wStr(0, 'RIFF'); view.setUint32(4, 36 + dataBytes + listBytes, true); wStr(8, 'WAVE');
  wStr(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, ch, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * ch * 2, true); view.setUint16(32, ch * 2, true); view.setUint16(34, 16, true);
  wStr(36, 'data'); view.setUint32(40, dataBytes, true);
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < ch; c++) { const s = Math.max(-1, Math.min(1, channels[c][i])); view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
  }
  if (info) {
    wStr(o, 'LIST'); view.setUint32(o + 4, info.len, true); wStr(o + 8, 'INFO'); o += 12;
    for (const s of info.subs) { wStr(o, s.id); view.setUint32(o + 4, s.bytes.length, true); o += 8; for (const b of s.bytes) view.setUint8(o++, b); }
  }
  return new Uint8Array(buf);
}

function concatBytes(list) { let n = 0; for (const a of list) n += a.length; const out = new Uint8Array(n); let o = 0; for (const a of list) { out.set(a, o); o += a.length; } return out; }

// ID3v2.3 tag to prepend to an MP3 so a player shows the album metadata + embedded cover art. Pure.
// `tags.picture = { mime, bytes:Uint8Array }` adds an APIC (front cover) frame. Uint8Array assembly
// keeps it safe for large images.
export function buildId3v2(tags = {}) {
  const frameBytes = (id, payload) => { const n = payload.length; return concatBytes([new Uint8Array([...latin1(id), (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff, 0, 0]), payload]); };
  const frames = [];
  const add = (id, v) => { if (v != null && v !== '') frames.push(frameBytes(id, new Uint8Array([0x00, ...latin1(String(v))]))); };
  add('TIT2', tags.title); add('TPE1', tags.artist); add('TALB', tags.album);
  if (tags.track) add('TRCK', tags.trackTotal ? `${tags.track}/${tags.trackTotal}` : tags.track);
  add('TPE2', tags.albumArtist); add('TCON', tags.genre); add('TYER', tags.year);
  add('TCOM', tags.composer); add('TPUB', tags.publisher); add('TCOP', tags.copyright);
  add('TBPM', tags.bpm); add('TLAN', tags.language); add('TIT1', tags.grouping); add('TIT3', tags.comment);
  if (tags.discNumber) add('TPOS', tags.discTotal ? `${tags.discNumber}/${tags.discTotal}` : tags.discNumber);
  if (tags.picture?.bytes?.length) { // APIC: encoding, mime\0, picture-type 0x03 (front), desc\0, data
    frames.push(frameBytes('APIC', concatBytes([new Uint8Array([0x00, ...latin1(tags.picture.mime || 'image/jpeg')]), new Uint8Array([0x00, 0x03, 0x00]), tags.picture.bytes])));
  }
  const body = concatBytes(frames);
  const n = body.length;
  return concatBytes([new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, (n >>> 21) & 0x7f, (n >>> 14) & 0x7f, (n >>> 7) & 0x7f, n & 0x7f]), body]);
}

export function buildM3u(fileNames, titles, secs, albumTitle = 'Album') {
  const out = ['#EXTM3U', `#PLAYLIST:${albumTitle}`];
  fileNames.forEach((f, i) => { out.push(`#EXTINF:${Math.round(secs[i] || 0)},${titles[i] || f}`); out.push(f); });
  return out.join('\n');
}
