import { useState } from 'react';
import Dialog from './Dialog.jsx';
import { getClip } from '../state/db.js';
import { decodeBlob, bufferToStereo, applyEdits, assembleAlbum, encodeWav, buildM3u, sanitizeFilename } from '../audio/wav.js';
import { trackTags } from '../album/skeleton.js';
import { writeToDir, download, ensureWritable } from '../backup/fs.js';
import { renderTrackFile, coverPicture } from '../backup/publish.js';

const editsOf = (t) => ({ trimStartMs: t.trimStartMs || 0, trimEndMs: t.trimEndMs || 0, fadeInMs: t.fadeInMs || 0, fadeOutMs: t.fadeOutMs || 0, gain: t.gain ?? 1 });

// Export the album — either separate track files (originals copied when unedited, else rendered to
// WAV; ID3 tags + embedded cover on MP3s) + an .m3u, or one mixed-down WAV (per-track trim/fade/gain,
// then gaps or a crossfade). Writes into the backup folder if set, else downloads.
export default function Export({ project, backupDir, backupName, albumDir, gapMs = 800, onClose }) {
  const ready = (project.tracks || []).filter((t) => t.clipId);
  const [mode, setMode] = useState('tracks');
  const [crossfadeSec, setCrossfadeSec] = useState(0);
  const [busy, setBusy] = useState('');
  const [done, setDone] = useState('');
  const [err, setErr] = useState('');
  const album = project.title || 'Album';

  async function put(path, blob) {
    if (backupDir && await ensureWritable(backupDir)) await writeToDir(backupDir, path, blob);
    else download(blob, path.split('/').pop());
  }

  async function run() {
    setErr(''); setDone('');
    try {
      const folder = backupDir ? `${albumDir || sanitizeFilename(album)}/export/` : '';
      const picture = await coverPicture(project);
      if (mode === 'tracks') {
        const names = [], titles = [], secs = [];
        for (let i = 0; i < ready.length; i++) {
          setBusy(`Rendering ${i + 1}/${ready.length}…`);
          const f = await renderTrackFile(project, ready[i], i, ready.length, picture);
          await put(folder + f.name, f.out);
          names.push(f.name); titles.push(f.title); secs.push(f.secs);
        }
        setBusy('Writing playlist…');
        await put(folder + `${sanitizeFilename(album)}.m3u`, new Blob([buildM3u(names, titles, secs, album)], { type: 'audio/x-mpegurl' }));
      } else {
        const items = [];
        for (let i = 0; i < ready.length; i++) {
          setBusy(`Decoding ${i + 1}/${ready.length}…`);
          items.push({ channels: applyEdits(bufferToStereo(await decodeBlob(await getClip(ready[i].clipId))), 44100, editsOf(ready[i])) });
        }
        setBusy('Mixing…');
        const { channels, sampleRate } = assembleAlbum(items, { gapMs, crossfadeMs: crossfadeSec * 1000, sampleRate: 44100 });
        await put(folder + `${sanitizeFilename(album)}.wav`, new Blob([encodeWav(channels, sampleRate, trackTags(project, album, 0, 1))], { type: 'audio/wav' }));
      }
      setBusy('');
      setDone(backupDir ? `Exported to ${backupName}/${albumDir || sanitizeFilename(album)}/export/` : 'Exported (check your downloads).');
    } catch (e) { setBusy(''); setErr(e.message || String(e)); }
  }

  return (
    <Dialog title={`Export “${album}”`} onClose={onClose} width={520}
      footer={<><button onClick={onClose}>Close</button><button className="primary" onClick={run} disabled={!ready.length || !!busy}>{busy || 'Export'}</button></>}>
      {!ready.length ? <p className="note">No generated tracks yet. Generate or upload audio first.</p> : <>
        <p className="note">{ready.length} track{ready.length === 1 ? '' : 's'} ready · destination: {backupName ? <b>{backupName}</b> : 'browser download'}</p>
        <label><input type="radio" name="m" checked={mode === 'tracks'} onChange={() => setMode('tracks')} style={{ width: 'auto', marginRight: 6 }} />
          Separate track files (originals + .m3u; edited tracks & cover baked in)</label>
        <label><input type="radio" name="m" checked={mode === 'album'} onChange={() => setMode('album')} style={{ width: 'auto', marginRight: 6 }} />
          One mixed album WAV (trim/fade/volume applied)</label>
        {mode === 'album' && (
          <div className="row" style={{ marginTop: 6 }}>
            <label style={{ margin: 0 }}>Crossfade (sec, 0 = {gapMs}ms gaps)</label>
            <input type="number" min="0" max="10" step="0.5" value={crossfadeSec} onChange={(e) => setCrossfadeSec(+e.target.value)} style={{ width: 90 }} />
          </div>
        )}
        {err && <p className="note" style={{ color: 'var(--bad)' }}>{err}</p>}
        {done && <p className="note" style={{ color: 'var(--good)' }}>✓ {done}</p>}
      </>}
    </Dialog>
  );
}
