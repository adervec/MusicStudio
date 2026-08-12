// Publish an album to the "device" folder (e.g. a Google-Drive-synced drive a phone watches):
// tagged track files + .m3u into <publishDir>/<Album Title>/. Shared by Export (tracks mode).
import { getClip } from '../state/db.js';
import { decodeBlob, bufferToStereo, applyEdits, encodeWav, buildId3v2, buildM3u, trackFileName, sanitizeFilename } from '../audio/wav.js';
import { trackTags } from '../album/skeleton.js';
import { writeToDir, ensureWritable } from './fs.js';

const extOf = (t, blob) => (t.fileName?.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase()) || (blob?.type === 'audio/wav' ? 'wav' : 'mp3');
const editsOf = (t) => ({ trimStartMs: t.trimStartMs || 0, trimEndMs: t.trimEndMs || 0, fadeInMs: t.fadeInMs || 0, fadeOutMs: t.fadeOutMs || 0, gain: t.gain ?? 1 });
const hasEdits = (t) => !!(t.trimStartMs || t.trimEndMs || t.fadeInMs || t.fadeOutMs) || (t.gain ?? 1) !== 1;

export async function coverPicture(project) {
  if (!project.cover?.id) return null;
  const blob = await getClip(project.cover.id); if (!blob) return null;
  return { mime: blob.type || 'image/jpeg', bytes: new Uint8Array(await blob.arrayBuffer()) };
}

// Render one ready track to its final export file: original copied when unedited (ID3 + cover on
// MP3s), else edits rendered to tagged WAV. ponytail: no MP3 encoder in the browser — WAV sources
// stay WAV; add an encoder dep only if phone storage becomes a real problem.
export async function renderTrackFile(project, t, i, n, picture) {
  const blob = await getClip(t.clipId);
  const title = t.title || `Track ${i + 1}`;
  let out, ext;
  if (hasEdits(t)) {
    const channels = applyEdits(bufferToStereo(await decodeBlob(blob)), 44100, editsOf(t));
    out = new Blob([encodeWav(channels, 44100, trackTags(project, title, i, n))], { type: 'audio/wav' }); ext = 'wav';
  } else {
    ext = extOf(t, blob);
    out = ext === 'mp3' ? new Blob([buildId3v2({ ...trackTags(project, title, i, n), picture }), blob], { type: 'audio/mpeg' }) : blob;
  }
  return { name: trackFileName(i, n, title, ext), title, out, secs: Math.round((t.durationMs || 0) / 1000) };
}

// Returns the number of tracks written (0 = nothing ready, album skipped).
export async function publishAlbum(project, dir, onProgress = () => {}) {
  const ready = (project.tracks || []).filter((t) => t.clipId);
  if (!ready.length) return 0;
  if (!(await ensureWritable(dir))) throw new Error('Publish folder permission denied.');
  const album = project.title || 'Album';
  const folder = sanitizeFilename(album) + '/';
  const picture = await coverPicture(project);
  const names = [], titles = [], secs = [];
  for (let i = 0; i < ready.length; i++) {
    onProgress(i + 1, ready.length, album);
    const f = await renderTrackFile(project, ready[i], i, ready.length, picture);
    await writeToDir(dir, folder + f.name, f.out);
    names.push(f.name); titles.push(f.title); secs.push(f.secs);
  }
  await writeToDir(dir, folder + `${sanitizeFilename(album)}.m3u`, new Blob([buildM3u(names, titles, secs, album)], { type: 'audio/x-mpegurl' }));
  return ready.length;
}
