import { safeUrl, normTitle } from '../album/library.js';
import { useState } from 'react';
import { uid, putClip, getClip, deleteClip } from '../state/db.js';
import { composeMusic, tts, MUSIC_MODELS, TTS_MODELS, MUSIC_PROMPT_MAX } from '../api/elevenlabs.js';
import AttachmentPreview from './AttachmentPreview.jsx';
import { clipDurationMs } from '../audio/wav.js';
import { pickFile } from '../backup/fs.js';
import { fmtDuration, fmtUsd, musicCost, ttsCost } from '../state/pricing.js';
import { THEMES } from '../state/themes.js';
import { isGap, trackKey, duplicateIds } from '../album/skeleton.js';
import { usePlayer } from './usePlayer.js';
import Transport from './Transport.jsx';
import Waveform from './Waveform.jsx';

const STYLE_PRESETS = [
  'lo-fi hip-hop, mellow piano, vinyl crackle, 80 BPM', 'cinematic orchestral, epic, building strings',
  'synthwave, retro, driving arpeggios, 110 BPM', 'ambient, ethereal pads, slow, no drums',
  'jazz trio, warm, brushed drums, upright bass', 'darksynth, aggressive, industrial, 120 BPM',
  'acoustic folk, fingerpicked guitar, intimate', 'house, four-on-the-floor, groovy bassline, 124 BPM',
  'trailer hybrid, big percussion, tension', 'chiptune, upbeat, 8-bit, playful',
];
// The album builder: curate prompts, generate music, splice dialog / uploads, reorder, edit
// (trim/fade/volume), and preview. `updateProject((prev)=>next)` persists.
export default function Editor({ project, apiKey, prefs, voices, ttsModels = TTS_MODELS, backupReady, group, onTheme, coverUrl, updateProject, backupClip, writeSkeleton, onSetCover, onClearCover, onDuplicateAlbum, onCopyPath, onExport, onMetadata, onAttachments, onLoadSkeleton, onScanFolder, onListAlbumAudio, onLinkFile, playlists, onAddToPlaylist, onPublish, publishName }) {
  const tracks = project.tracks || [];
  const player = usePlayer();
  const [openEdit, setOpenEdit] = useState(() => new Set());
  const [sel, setSel] = useState(() => new Set());
  const toggleSel = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  async function deleteSelected() {
    for (const id of sel) { const t = tracks.find((x) => x.id === id); if (t?.clipId) await deleteClip(t.clipId); if (player.playing === id) player.stop(); }
    setTracks((ts) => ts.filter((t) => !sel.has(t.id)));
    setSel(new Set());
  }
  const [openAtt, setOpenAtt] = useState(null); // attachment id previewed on the album page
  const staticPlaylists = (playlists || []).filter((p) => p.kind === 'static');
  // 📎 Link file: one track at a time; the album folder's audio, best title match first.
  const [linking, setLinking] = useState(null); // { id, files: null (loading) | [{ name, used, match }] }
  async function startLink(t) {
    setLinking({ id: t.id, files: null });
    const key = normTitle(t.title);
    const files = (await onListAlbumAudio()).map((f) => { const n = normTitle(f.name); return { ...f, match: !!key && (n === key || (Math.min(n.length, key.length) >= 3 && (n.includes(key) || key.includes(n)))) }; })
      .sort((a, b) => (b.match - a.match) || (a.used - b.used) || a.name.localeCompare(b.name, undefined, { numeric: true }));
    setLinking((l) => (l?.id === t.id ? { id: t.id, files } : l));
  }
  async function doLink(t, src) { setLinking(null); if (player.playing === t.id) player.stop(); await onLinkFile(t.id, src); }

  const setTracks = (fn) => updateProject((p) => ({ ...p, tracks: fn(p.tracks || []) }));
  const patch = (id, up) => setTracks((ts) => ts.map((t) => (t.id === id ? { ...t, ...up } : t)));
  const setMeta = (k, v) => updateProject((p) => ({ ...p, [k]: v }));

  function addMusic() {
    setTracks((ts) => [...ts, { id: uid('t_'), type: 'music', title: `Track ${ts.length + 1}`, prompt: '', lengthMs: (prefs.defaultLengthSec || 60) * 1000, model: prefs.musicModel, instrumental: false, status: 'idle', gain: 1 }]);
  }
  function addDialog() {
    const v = voices.find((x) => x.id === prefs.defaultVoiceId);
    setTracks((ts) => [...ts, { id: uid('t_'), type: 'dialog', title: 'Dialog', text: '', voiceId: prefs.defaultVoiceId || '', voiceName: v?.name || '', ttsModel: prefs.ttsModel, status: 'idle', gain: 1 }]);
  }
  async function addUploads() {
    const files = await pickFile('audio/*');
    for (const f of files) {
      const clipId = uid('clip_');
      await putClip(clipId, f);
      const t = { id: uid('t_'), type: 'upload', title: f.name.replace(/\.[^.]+$/, ''), fileName: f.name, clipId, durationMs: await clipDurationMs(f), sizeBytes: f.size, mime: f.type, status: 'ready', gain: 1 };
      setTracks((ts) => [...ts, t]);
      const file = await backupClip(t, f);
      if (file) patch(t.id, { backupFile: file });
    }
    writeSkeleton?.();
  }

  async function generate(t) {
    if (!apiKey) { patch(t.id, { status: 'error', error: 'Set your ElevenLabs API key in Settings.' }); return null; }
    if (!backupReady) { patch(t.id, { status: 'error', error: 'Choose a backup folder (outside the app) in Settings before generating.' }); return null; }
    patch(t.id, { status: 'gen', error: '' });
    try {
      const blob = t.type === 'music'
        ? await composeMusic({ prompt: t.prompt, lengthMs: t.lengthMs, model: t.model, instrumental: t.instrumental, apiKey })
        : await tts({ text: t.text, voiceId: t.voiceId, model: t.ttsModel, apiKey });
      const clipId = t.clipId || uid('clip_');
      await putClip(clipId, blob);
      const durationMs = await clipDurationMs(blob);
      const ready = { ...t, status: 'ready', clipId, durationMs, sizeBytes: blob.size, mime: blob.type, error: '' };
      patch(t.id, { status: 'ready', clipId, durationMs, sizeBytes: blob.size, mime: blob.type, error: '' });
      const file = await backupClip(ready, blob);
      if (file) patch(t.id, { backupFile: file });
      writeSkeleton?.();
      // The maker's app portal keeps a character sheet from what its apps report. Writing and
      // generating a track is a few minutes of creative work; amount is in units of ten minutes.
      try {
        const k = 'portal-activity', a = JSON.parse(localStorage.getItem(k) || '[]');
        a.push([Math.round(Date.now() / 1000), 'MusicStudio', 'compose', 1]);
        localStorage.setItem(k, JSON.stringify(a.slice(-2000)));
      } catch { /* quota — ignore */ }
      return { clipId, durationMs, sizeBytes: blob.size, mime: blob.type };
    } catch (e) { patch(t.id, { status: 'error', error: e.message || String(e) }); return null; }
  }

  async function remove(t) {
    if (player.playing === t.id) player.stop();
    if (t.clipId) await deleteClip(t.clipId);
    setTracks((ts) => ts.filter((x) => x.id !== t.id));
  }
  function move(id, dir) {
    setTracks((ts) => {
      const i = ts.findIndex((t) => t.id === id); const j = i + dir;
      if (i < 0 || j < 0 || j >= ts.length) return ts;
      const c = [...ts]; [c[i], c[j]] = [c[j], c[i]]; return c;
    });
  }
  async function duplicateTrack(t) {
    const nt = { ...t, id: uid('t_'), title: `${t.title || 'Track'} (copy)`, backupFile: null };
    if (t.clipId) { const b = await getClip(t.clipId); if (b) { const nid = uid('clip_'); await putClip(nid, b); nt.clipId = nid; } }
    setTracks((ts) => { const i = ts.findIndex((x) => x.id === t.id); const c = [...ts]; c.splice(i + 1, 0, nt); return c; });
  }
  const toggleEdit = (id) => setOpenEdit((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const editSec = (t, k) => ((t[k] || 0) / 1000);

  const gaps = tracks.filter(isGap);
  const dups = duplicateIds(tracks);
  const [bulk, setBulk] = useState(null);
  // Estimated cost of filling the gaps, accounting for duplicate-reuse (a gap matching existing/earlier audio is free).
  const gapCost = (() => {
    const seen = new Set(tracks.filter((t) => t.clipId).map(trackKey).filter(Boolean));
    let c = 0;
    for (const t of gaps) { const k = trackKey(t); if (k && seen.has(k)) continue; if (k) seen.add(k); c += t.type === 'music' ? musicCost(t.lengthMs || 60000) : ttsCost((t.text || '').trim().length); }
    return c;
  })();
  // Copy an existing clip into a duplicate track instead of paying to generate the same thing again.
  async function reuseClip(t, info) {
    const b = await getClip(info.clipId); if (!b) return null;
    const nid = uid('clip_'); await putClip(nid, b);
    patch(t.id, { status: 'ready', clipId: nid, durationMs: info.durationMs || 0, sizeBytes: info.sizeBytes || 0, mime: info.mime, error: '' });
    const file = await backupClip({ ...t, clipId: nid }, b); if (file) patch(t.id, { backupFile: file });
    writeSkeleton?.();
    return { clipId: nid, durationMs: info.durationMs || 0, sizeBytes: info.sizeBytes || 0, mime: info.mime };
  }
  async function generateAll() {
    const list = tracks.filter(isGap);
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') { try { Notification.requestPermission(); } catch { /* */ } }
    const byKey = new Map(); // reuse identical content (already-generated or generated earlier this run)
    for (const x of tracks) { const k = trackKey(x); if (k && x.clipId) byKey.set(k, { clipId: x.clipId, durationMs: x.durationMs, sizeBytes: x.sizeBytes, mime: x.mime }); }
    let ok = 0, fail = 0;
    for (let i = 0; i < list.length; i++) {
      const t = list[i], k = trackKey(t);
      setBulk(`${k && byKey.has(k) ? 'Reusing' : 'Generating'} ${i + 1}/${list.length}…`);
      const r = k && byKey.has(k) ? await reuseClip(t, byKey.get(k)) : await generate(t);
      if (r) { ok++; if (k) byKey.set(k, r); } else fail++;
    }
    setBulk(null);
    try { if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification('Music Studio', { body: `“${project.title || 'Album'}” — ${ok} ready${fail ? `, ${fail} failed` : ''}` }); } catch { /* */ }
  }

  const totalMs = tracks.reduce((s, t) => s + (t.clipId ? t.durationMs || 0 : 0), 0);
  const readyCount = tracks.filter((t) => t.clipId).length;

  return (
    <div>
      <div className="row" style={{ marginBottom: 8 }}>
        <button className="cover" title="Album cover — click to set" onClick={() => pickFile('image/*').then((fs) => fs[0] && onSetCover(fs[0]))}>
          {coverUrl ? <img src={coverUrl} alt="cover" /> : <span>＋<br />cover</span>}
        </button>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row"><input className="grow" value={project.title} onChange={(e) => setMeta('title', e.target.value)} placeholder="Album title" style={{ fontSize: 18, fontWeight: 600 }} /></div>
          <div className="row" style={{ marginTop: 4 }}>
            <input value={project.artist || ''} onChange={(e) => setMeta('artist', e.target.value)} placeholder="Artist" style={{ maxWidth: 200 }} />
            <button className="mini" onClick={onDuplicateAlbum} title="Duplicate this album">⧉ Duplicate</button>
            <button className="mini" onClick={onCopyPath} disabled={!backupReady} title="Open this album's folder in File Explorer (or copy its path)">📂 Open folder</button>
            {coverUrl && <button className="mini" onClick={onClearCover}>Remove cover</button>}
          </div>
        </div>
      </div>
      {group && (
        <div className="row" style={{ marginBottom: 8, fontSize: 12 }}>
          <span className="dim">📁 {group.name}</span>
          <span className="dim">· 🎨 theme</span>
          <select value={group.theme || 'default'} onChange={(e) => onTheme(e.target.value)} style={{ width: 'auto' }} title="Visual theme for this album's group">
            {Object.entries(THEMES).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
          </select>
        </div>
      )}
      <textarea value={project.description || ''} onChange={(e) => setMeta('description', e.target.value)} placeholder="Album description / creative brief — the skeleton an external Claude Code session will build from…" style={{ marginBottom: 8, minHeight: 40 }} />
      <div className="row" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
        <button onClick={onMetadata}>🏷 Metadata…</button>
        <button onClick={onAttachments}>📎 Attachments{project.attachments?.length ? ` (${project.attachments.length})` : ''}…</button>
        <button onClick={() => writeSkeleton()} disabled={!backupReady} title="Write album.json + AGENT.md to the backup folder">⤓ Write skeleton</button>
        <button onClick={onLoadSkeleton} disabled={!backupReady} title="Re-import album.json edited by an agent">⤒ Load skeleton</button>
        <button onClick={onScanFolder} disabled={!backupReady} title="Scan this album's folder — recover audio for gap tracks and import any loose audio files">🔎 Scan folder</button>
      </div>

      {!!project.attachments?.length && (
        <div style={{ marginBottom: 10 }}>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            <span className="dim" style={{ fontSize: 12 }}>Attachments:</span>
            {project.attachments.map((a) => (
              <button key={a.id} className={`mini${openAtt === a.id ? ' primary' : ''}`} onClick={() => setOpenAtt((x) => (x === a.id ? null : a.id))} title="Preview">{a.kind === 'note' ? '📝' : '📎'} {a.name}</button>
            ))}
          </div>
          {project.attachments.filter((a) => a.id === openAtt).map((a) => <AttachmentPreview key={a.id} a={a} />)}
        </div>
      )}

      {!backupReady && <p className="note" style={{ color: 'var(--warn)' }}>⚠ Set a backup folder outside the app (Settings) — required before generating, and where the album skeleton is exposed for an external agent.</p>}

      <div className="row" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
        <button onClick={addMusic}>＋ Song</button>
        <button onClick={addDialog}>＋ Dialog</button>
        <button onClick={addUploads}>⭱ Upload audio</button>
        <button onClick={generateAll} disabled={!gaps.length || !!bulk || !backupReady} title={`Generate every track that has no audio yet — est. ${fmtUsd(gapCost)}`}>{bulk || `⚡ Generate all gaps${gaps.length ? ` (${gaps.length}, ~${fmtUsd(gapCost)})` : ''}`}</button>
        <div className="grow" />
        <button onClick={() => player.playQueue(tracks.filter((t) => t.clipId))} disabled={!readyCount}>▶ Play all</button>
        <button onClick={onPublish} disabled={!readyCount} title={publishName ? `Write tagged tracks + playlist to ${publishName}/` : 'Set a publish folder in Settings (e.g. a phone-synced drive)'}>⇪ Publish</button>
        <button className="primary" onClick={onExport} disabled={!readyCount}>⤓ Export album</button>
      </div>
      <p className="note">{tracks.length} track{tracks.length === 1 ? '' : 's'} · {readyCount} ready · {gaps.length} gap{gaps.length === 1 ? '' : 's'} · {fmtDuration(totalMs)}</p>
      {dups.size > 0 && <p className="note" style={{ color: 'var(--warn)' }}>⚠ {dups.size} duplicate track{dups.size === 1 ? '' : 's'} (same prompt/voice) — “Generate all gaps” reuses audio instead of paying twice.</p>}

      {sel.size > 0 && (
        <div className="row" style={{ margin: '4px 0 10px', gap: 6, background: 'var(--panel2)', border: '1px solid var(--accent)', borderRadius: 8, padding: '6px 8px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13 }}>{sel.size} selected</span>
          <button className="mini" onClick={() => player.playQueue(tracks.filter((t) => sel.has(t.id) && t.clipId))}>▶ Play</button>
          {staticPlaylists.length > 0 && (
            <select value="" onChange={(e) => { if (e.target.value) { onAddToPlaylist([...sel].map((id) => ({ projectId: project.id, trackId: id })), e.target.value); setSel(new Set()); } }} style={{ width: 'auto' }}>
              <option value="">＋ Add to playlist…</option>
              {staticPlaylists.map((pl) => <option key={pl.id} value={pl.id}>{pl.name}</option>)}
            </select>
          )}
          <button className="mini danger" onClick={deleteSelected}>🗑 Delete</button>
          <div className="grow" />
          <button className="mini" onClick={() => setSel(new Set())}>Clear</button>
        </div>
      )}

      <Transport player={player} label={(id) => tracks.find((t) => t.id === id)?.title} />

      {!tracks.length && <div className="empty">Add a song, dialog line, or upload to start building your album.</div>}

      {tracks.map((t, i) => (
        <div key={t.id} className={`track ${player.playing === t.id ? 'playing' : ''}`}>
          <div className="track-head">
            <input type="checkbox" checked={sel.has(t.id)} onChange={() => toggleSel(t.id)} style={{ width: 'auto' }} title="Select track" />
            <span className={`badge ${t.type}`}>{t.type}</span>
            <button className="mini" onClick={() => patch(t.id, { fav: !t.fav })} title={t.fav ? 'Unfavorite' : 'Favorite'} style={{ color: t.fav ? 'var(--gold, #f5c451)' : 'var(--dim)', border: 'none', background: 'none', padding: 0 }}>{t.fav ? '★' : '☆'}</button>
            {dups.has(t.id) && <span className="badge" style={{ color: 'var(--warn)', borderColor: 'var(--warn)' }} title="Same content as an earlier track — bulk-generate reuses its audio instead of paying again">⚠ dup</span>}
            <input className="grow" value={t.title} onChange={(e) => patch(t.id, { title: e.target.value })} />
            {t.clipId && <span className="dim" style={{ fontSize: 12 }}>{fmtDuration(t.durationMs)}</span>}
            <button className="mini" onClick={() => move(t.id, -1)} disabled={i === 0} title="Move up">▲</button>
            <button className="mini" onClick={() => move(t.id, 1)} disabled={i === tracks.length - 1} title="Move down">▼</button>
            {t.clipId && <button className="mini" onClick={() => player.play(t, tracks)}>{player.playing === t.id ? (player.paused ? '▶' : '⏸') : '▶'}</button>}
            {t.clipId && <button className="mini" onClick={() => toggleEdit(t.id)} title="Trim / fade">✎</button>}
            <button className="mini" onClick={() => duplicateTrack(t)} title="Duplicate track">⧉</button>
            <button className="mini danger" onClick={() => remove(t)}>🗑</button>
          </div>

          {t.clipId && <Waveform clipId={t.clipId} progress={player.playing === t.id ? (player.dur ? player.cur / player.dur : 0) : 0} onSeek={(frac) => { if (player.playing === t.id) player.seek(frac * (player.dur || 0)); else player.play(t, tracks); }} />}

          {t.type === 'music' && (
            <>
              <label>Prompt</label>
              <textarea value={t.prompt} onChange={(e) => patch(t.id, { prompt: e.target.value })} placeholder="e.g. Upbeat lo-fi hip-hop with mellow piano, warm vinyl crackle, 90 BPM" />
              <div className="row" style={{ marginTop: 4 }}>
                <span style={{ order: 2, marginLeft: 'auto', fontSize: 11, color: (t.prompt || '').length > MUSIC_PROMPT_MAX ? 'var(--bad)' : 'var(--dim)' }} title="ElevenLabs accepts up to 4,100 characters per prompt">{(t.prompt || '').length.toLocaleString()} / {MUSIC_PROMPT_MAX.toLocaleString()} chars</span>
                <select value="" onChange={(e) => { if (e.target.value) patch(t.id, { prompt: (t.prompt ? t.prompt.trim() + ', ' : '') + e.target.value }); }} style={{ maxWidth: 240 }} title="Append a style to the prompt">
                  <option value="">＋ add a style…</option>
                  {STYLE_PRESETS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="row" style={{ marginTop: 6, flexWrap: 'wrap' }}>
                <div><label>Length (sec)</label><input type="number" min="3" max="600" value={Math.round(t.lengthMs / 1000)} onChange={(e) => patch(t.id, { lengthMs: Math.max(3000, Math.min(600000, +e.target.value * 1000)) })} style={{ width: 90 }} /></div>
                <div className="grow"><label>Model</label><select value={t.model} onChange={(e) => patch(t.id, { model: e.target.value })}>{MUSIC_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></div>
                <label style={{ marginTop: 20 }}><input type="checkbox" checked={!!t.instrumental} onChange={(e) => patch(t.id, { instrumental: e.target.checked })} style={{ width: 'auto', marginRight: 5 }} />Instrumental</label>
              </div>
            </>
          )}
          {t.type === 'dialog' && (
            <>
              <label>Text</label>
              <textarea value={t.text} onChange={(e) => patch(t.id, { text: e.target.value })} placeholder="Spoken line to splice into the album…" />
              <div className="row" style={{ marginTop: 6 }}>
                <div className="grow"><label>Voice</label><select value={t.voiceId} onChange={(e) => patch(t.id, { voiceId: e.target.value, voiceName: voices.find((v) => v.id === e.target.value)?.name || '' })}>
                  <option value="">{voices.length ? '— pick a voice —' : '— test key in Settings to load voices —'}</option>
                  {voices.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select></div>
                <div className="grow"><label>Model</label><select value={t.ttsModel} onChange={(e) => patch(t.id, { ttsModel: e.target.value })}>{ttsModels.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></div>
              </div>
            </>
          )}
          {t.type === 'upload' && (
            <p className="note">Uploaded file: {t.fileName}{' '}
              <button className="mini" title="Turn this upload into a song entry: keep the audio, add the prompt it was made from"
                onClick={() => patch(t.id, { type: 'music', prompt: '', lengthMs: Math.max(3000, Math.min(600000, Math.round((t.durationMs || 60000) / 1000) * 1000)), model: t.model || prefs.musicModel, instrumental: false })}>＋ Add prompt (make it a song)</button>
            </p>
          )}

          <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
            {t.type !== 'upload' && (
              <button className="mini" onClick={() => generate(t)} disabled={t.status === 'gen' || (t.type === 'music' ? !t.prompt.trim() || t.prompt.length > MUSIC_PROMPT_MAX : !(t.text.trim() && t.voiceId))}>
                {t.status === 'gen' ? '… generating' : t.clipId ? '↻ Regenerate' : '✦ Generate'}
              </button>
            )}
            <button className="mini" onClick={() => (linking?.id === t.id ? setLinking(null) : startLink(t))} title="Use an audio file that already exists — from this album's folder or your computer. No regeneration, no spend.">📎 {t.clipId ? 'Relink' : 'Link file'}</button>
            <span className={`status ${t.status === 'error' ? 'err' : ''}`}>
              {t.status === 'gen' ? 'Calling ElevenLabs…' : t.status === 'error' ? '⚠ ' + t.error : t.clipId ? '✓ ready' : ''}
            </span>
            <div className="grow" />
            <input value={t.sourceUrl || ''} onChange={(e) => patch(t.id, { sourceUrl: e.target.value.trim() })} placeholder="🔗 song page URL (e.g. ElevenLabs)" title="The web page this song was generated on" style={{ width: 230, fontSize: 12, padding: '3px 7px' }} />
            {safeUrl(t.sourceUrl) && <a href={safeUrl(t.sourceUrl)} target="_blank" rel="noopener noreferrer" title="Open the page this song was generated on">↗</a>}
            {t.clipId && <span className="gain">vol <input type="range" min="0" max="1.5" step="0.05" value={t.gain ?? 1} onChange={(e) => patch(t.id, { gain: +e.target.value })} />{Math.round((t.gain ?? 1) * 100)}%</span>}
          </div>

          {linking?.id === t.id && (
            <div className="row" style={{ marginTop: 6, flexWrap: 'wrap' }}>
              {backupReady && (
                <select value="" onChange={(e) => e.target.value && doLink(t, e.target.value)} className="grow" style={{ minWidth: 220 }}>
                  <option value="">{linking.files === null ? 'Reading the album folder…' : linking.files.length ? `Pick a file in this album's folder (${linking.files.length})…` : 'No audio files in this album’s folder'}</option>
                  {(linking.files || []).map((f) => <option key={f.name} value={f.name}>{f.match ? '★ ' : ''}{f.used ? '(in use) ' : ''}{f.name}</option>)}
                </select>
              )}
              <button className="mini" onClick={() => pickFile('audio/*').then((fs) => fs[0] && doLink(t, fs[0]))}>From computer…</button>
              <button className="mini" onClick={() => setLinking(null)}>Cancel</button>
              <span className="dim" style={{ fontSize: 11 }}>★ = name matches this track</span>
            </div>
          )}

          {t.clipId && openEdit.has(t.id) && (
            <div className="row" style={{ marginTop: 8, gap: 12, flexWrap: 'wrap', fontSize: 11, color: 'var(--dim)' }}>
              {[['trimStartMs', 'trim in'], ['trimEndMs', 'trim out'], ['fadeInMs', 'fade in'], ['fadeOutMs', 'fade out']].map(([k, lbl]) => (
                <span key={k}>{lbl} <input type="number" min="0" step="0.1" value={editSec(t, k)} onChange={(e) => patch(t.id, { [k]: Math.max(0, +e.target.value * 1000) })} style={{ width: 60 }} />s</span>
              ))}
              <span>· applied on export &amp; album mix</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
