// Publish an album to the "device" folder (e.g. a Google-Drive-synced drive a phone watches):
// tagged track files + .m3u into <publishDir>/<Album Title>/. Shared by Export (tracks mode).
// Also plans the file-tag sync: which master/published files carry which tags (see App runTagSync).
import { getClip } from '../state/db.js';
import { decodeBlob, bufferToStereo, applyEdits, encodeWav, buildM3u, trackFileName, sanitizeFilename, retagBytes } from '../audio/wav.js';
import { trackTags } from '../album/skeleton.js';
import { writeToDir, ensureWritable, listFiles, removeFromDir } from './fs.js';

const extFromName = (n) => n?.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
const editsOf = (t) => ({ trimStartMs: t.trimStartMs || 0, trimEndMs: t.trimEndMs || 0, fadeInMs: t.fadeInMs || 0, fadeOutMs: t.fadeOutMs || 0, gain: t.gain ?? 1 });
const hasEdits = (t) => !!(t.trimStartMs || t.trimEndMs || t.fadeInMs || t.fadeOutMs) || (t.gain ?? 1) !== 1;
const MIME = { mp3: 'audio/mpeg', wav: 'audio/wav' };
export const mimeOf = (ext) => MIME[ext] || 'application/octet-stream';
// A published file's extension: edits render to WAV; otherwise the source's own format.
export const publishExt = (t, blobType = t.mime) => (hasEdits(t) ? 'wav' : extFromName(t.fileName) || (blobType === 'audio/wav' ? 'wav' : 'mp3'));
// What changes a file's *audio* (vs only its tags): which clip, its size, and the edits.
const audioKey = (t) => JSON.stringify([t.clipId, t.sizeBytes || 0, t.durationMs || 0, editsOf(t)]);
const tagSig = (project, tags) => JSON.stringify([tags, project.cover?.id || null]);

// Master files (the app's own copies in the backup folder): numbered by position in the album, the
// way the app lists them. → [{ trackId, file, ext, tags, sig }]
export function masterTargets(project) {
  const all = project.tracks || [];
  return all.flatMap((t, i) => {
    const ext = extFromName(t.backupFile);
    if (!t.clipId || !t.backupFile || !MIME[ext]) return [];
    const tags = trackTags(project, t.title || `Track ${i + 1}`, i, all.length);
    return [{ trackId: t.id, file: t.backupFile, ext, tags, sig: tagSig(project, tags) + audioKey(t) }];
  });
}

// Published copies: ready tracks only, numbered like their filenames. → { folder, files: [{ trackId, name, ext, tags, sig, audio }] }
export function publishTargets(project) {
  const ready = (project.tracks || []).filter((t) => t.clipId);
  return {
    folder: sanitizeFilename(project.title || 'Album'),
    files: ready.map((t, i) => {
      const title = t.title || `Track ${i + 1}`, ext = publishExt(t), tags = trackTags(project, title, i, ready.length);
      return { trackId: t.id, name: trackFileName(i, ready.length, title, ext), ext, tags, sig: tagSig(project, tags), audio: audioKey(t) };
    }),
  };
}
// The remembered state of an album's published folder (stored per album; see App).
export const publishState = (project) => { const st = publishTargets(project); return { folder: st.folder, names: st.files.map((f) => f.name), sigs: Object.fromEntries(st.files.map((f) => [f.trackId, f.sig + f.audio])) }; };

export async function coverPicture(project) {
  if (!project.cover?.id) return null;
  const blob = await getClip(project.cover.id); if (!blob) return null;
  return { mime: blob.type || 'image/jpeg', bytes: new Uint8Array(await blob.arrayBuffer()) };
}

// Retag a blob (mp3/wav); unsupported formats come back untouched.
export async function retagBlob(blob, ext, tags) {
  const out = retagBytes(new Uint8Array(await blob.arrayBuffer()), ext, tags);
  return out ? new Blob([out], { type: mimeOf(ext) }) : blob;
}

// Render one ready track to its final export file: original audio when unedited, else edits rendered
// to WAV — either way tagged (ID3 / RIFF INFO + id3 chunk, cover embedded). ponytail: no MP3 encoder in
// the browser — WAV sources stay WAV; add an encoder dep only if phone storage becomes a real problem.
export async function renderTrackFile(project, t, i, n, picture) {
  const blob = await getClip(t.clipId);
  const title = t.title || `Track ${i + 1}`;
  const ext = publishExt(t, blob?.type);
  const tags = { ...trackTags(project, title, i, n), picture };
  const src = hasEdits(t) ? new Blob([encodeWav(applyEdits(bufferToStereo(await decodeBlob(blob)), 44100, editsOf(t)), 44100)], { type: 'audio/wav' }) : blob;
  return { name: trackFileName(i, n, title, ext), title, out: await retagBlob(src, ext, tags), secs: Math.round((t.durationMs || 0) / 1000) };
}

// Returns the number of tracks written (0 = nothing ready, album skipped). Files left over from an
// earlier publish of this album (renamed/removed tracks) are deleted from its folder.
export async function publishAlbum(project, dir, onProgress = () => {}) {
  const ready = (project.tracks || []).filter((t) => t.clipId);
  if (!ready.length) return 0;
  if (!(await ensureWritable(dir))) throw new Error('Publish folder permission denied.');
  const album = project.title || 'Album';
  const folder = sanitizeFilename(album);
  const picture = await coverPicture(project);
  const names = [], titles = [], secs = [];
  for (let i = 0; i < ready.length; i++) {
    onProgress(i + 1, ready.length, album);
    const f = await renderTrackFile(project, ready[i], i, ready.length, picture);
    await writeToDir(dir, `${folder}/${f.name}`, f.out);
    names.push(f.name); titles.push(f.title); secs.push(f.secs);
  }
  const m3u = `${folder}.m3u`;
  await writeToDir(dir, `${folder}/${m3u}`, new Blob([buildM3u(names, titles, secs, album)], { type: 'audio/x-mpegurl' }));
  const keep = new Set([...names, m3u]);
  for (const f of await listFiles(dir, folder).catch(() => [])) {
    if (!keep.has(f) && /\.(mp3|wav|m4a|aac|ogg|opus|flac|webm|m3u)$/i.test(f)) await removeFromDir(dir, `${folder}/${f}`).catch(() => {});
  }
  return ready.length;
}
