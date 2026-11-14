import { safeUrl, normTitle } from '../album/library.js';
import { useState } from 'react';
import { uid, putClip, getClip, deleteClip } from '../state/db.js';
import { TTS_MODELS, MUSIC_PROMPT_MAX, newTrackModel } from '../api/elevenlabs.js';
import { SFX_MODELS } from '../api/music.js';
import AttachmentStrip from './AttachmentStrip.jsx';
import MusicFields, { QC_COLOR, qcTitle } from './MusicFields.jsx';
import { Stars, NotesPanel, hasNotes } from './Rating.jsx';
import { albumRating } from '../album/taste.js';
import { clipDurationMs } from '../audio/wav.js';
import { pickFile } from '../backup/fs.js';
import { fmtDuration, fmtUsd, musicCost, ttsCost } from '../state/pricing.js';
import { THEMES } from '../state/themes.js';
import { isGap, trackKey, duplicateIds } from '../album/skeleton.js';
import { usePlayer } from './usePlayer.js';
import Waveform from './Waveform.jsx';

// The album builder: curate prompts, generate music, splice dialog / uploads, reorder, edit
// (trim/fade/volume), and preview. `updateProject((prev)=>next)` persists.
export default function Editor({ project, apiKey, prefs, voices, ttsModels = TTS_MODELS, backupReady, group, onTheme, coverUrl, updateProject, backupClip, writeSkeleton, onSetCover, onClearCover, onDuplicateAlbum, onCopyPath, onExport, onMetadata, onAttachments, onLoadSkeleton, onScanFolder, onListAlbumAudio, onLinkFile, onGenerate, onUpload, onDeleteTakes, onInpaint, onFromSong, onFromVideo, onStems, finetunes = [], queued = 0, playlists, onAddToPlaylist, onPublish, publishName }) {
  const tracks = project.tracks || [];
  const player = usePlayer();
  const [openEdit, setOpenEdit] = useState(() => new Set());
  const [sel, setSel] = useState(() => new Set());
  const toggleSel = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  async function deleteSelected() {
    for (const id of sel) { const tk = tracks.find((x) => x.id === id); for (const c of [tk?.clipId, ...(tk?.takes || []).map((k) => k.clipId)]) if (c) await deleteClip(c); if (player.playing === id) player.stop(); }
    setTracks((ts) => ts.filter((tk) => !sel.has(tk.id)));
    setSel(new Set());
  }
  const [openNotes, setOpenNotes] = useState(() => new Set()); // tracks (and 'album') with the notes panel open
  const toggleNotes = (id) => setOpenNotes((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const ar = albumRating(project);
  const staticPlaylists = (playlists || []).filter((p) => p.kind === 'static');
  // 📎 Link file: one track at a time; the album folder's audio, best title match first.
  const [linking, setLinking] = useState(null); // { id, files: null (loading) | [{ name, used, match }] }
  async function startLink(tk) {
    setLinking({ id: tk.id, files: null });
    const key = normTitle(tk.title);
    const files = (await onListAlbumAudio()).map((f) => { const n = normTitle(f.name); return { ...f, match: !!key && (n === key || (Math.min(n.length, key.length) >= 3 && (n.includes(key) || key.includes(n)))) }; })
      .sort((a, b) => (b.match - a.match) || (a.used - b.used) || a.name.localeCompare(b.name, undefined, { numeric: true }));
    setLinking((l) => (l?.id === tk.id ? { id: tk.id, files } : l));
  }
  async function doLink(tk, src) { setLinking(null); if (player.playing === tk.id) player.stop(); await onLinkFile(tk.id, src); }

  const setTracks = (fn) => updateProject((p) => ({ ...p, tracks: fn(p.tracks || []) }));
  const patch = (id, up) => setTracks((ts) => ts.map((tk) => (tk.id === id ? { ...tk, ...up } : tk)));
  const setMeta = (k, v) => updateProject((p) => ({ ...p, [k]: v }));

  function addMusic() {
    setTracks((ts) => [...ts, { id: uid('t_'), type: 'music', title: `Track ${ts.length + 1}`, prompt: '', lengthMs: (prefs.defaultLengthSec || 60) * 1000, ...newTrackModel(prefs), instrumental: false, status: 'idle', gain: 1 }]);
  }
  function addDialog() {
    const v = voices.find((x) => x.id === prefs.defaultVoiceId);
    setTracks((ts) => [...ts, { id: uid('t_'), type: 'dialog', title: 'Dialog', text: '', voiceId: prefs.defaultVoiceId || '', voiceName: v?.name || '', ttsModel: prefs.ttsModel, status: 'idle', gain: 1 }]);
  }
  async function addUploads() { const files = await pickFile('audio/*'); if (files.length) onUpload(files); }


  async function remove(tk) {
    if (player.playing === tk.id) player.stop();
    for (const c of [tk.clipId, ...(tk.takes || []).map((k) => k.clipId)]) if (c) await deleteClip(c);
    setTracks((ts) => ts.filter((x) => x.id !== tk.id));
  }
  function move(id, dir) {
    setTracks((ts) => {
      const i = ts.findIndex((tk) => tk.id === id); const j = i + dir;
      if (i < 0 || j < 0 || j >= ts.length) return ts;
      const c = [...ts]; [c[i], c[j]] = [c[j], c[i]]; return c;
    });
  }
  async function duplicateTrack(tk) {
    const nt = { ...tk, id: uid('t_'), title: `${tk.title || 'Track'} (copy)`, backupFile: null };
    if (tk.clipId) { const b = await getClip(tk.clipId); if (b) { const nid = uid('clip_'); await putClip(nid, b); nt.clipId = nid; } }
    setTracks((ts) => { const i = ts.findIndex((x) => x.id === tk.id); const c = [...ts]; c.splice(i + 1, 0, nt); return c; });
  }
  const toggleEdit = (id) => setOpenEdit((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const editSec = (tk, k) => ((tk[k] || 0) / 1000);

  const gaps = tracks.filter(isGap);
  const dups = duplicateIds(tracks);
  // Estimated cost of filling the gaps, accounting for duplicate-reuse (a gap matching existing/earlier audio is free).
  const gapCost = (() => {
    const seen = new Set(tracks.filter((tk) => tk.clipId).map(trackKey).filter(Boolean));
    let c = 0;
    for (const tk of gaps) { const k = trackKey(tk); if (k && seen.has(k)) continue; if (k) seen.add(k); c += tk.type === 'music' ? musicCost(tk.lengthMs || 60000) : ttsCost((tk.text || '').trim().length); }
    return c;
  })();
  const totalMs = tracks.reduce((s, tk) => s + (tk.clipId ? tk.durationMs || 0 : 0), 0);
  const readyCount = tracks.filter((tk) => tk.clipId).length;

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
            <Stars value={project.rating || 0} onChange={(v) => setMeta('rating', v)} calc={ar.calc} n={ar.n} size={16} />
            <button className={`mini${hasNotes(project) ? ' primary' : ''}`} onClick={() => toggleNotes('album')} title="Album notes, likes and dislikes">📝</button>
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
            {Object.entries(THEMES).map(([k, tk]) => <option key={k} value={k}>{tk.label}</option>)}
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

      {openNotes.has('album') && <NotesPanel obj={project} what="album" onChange={(up) => updateProject((p) => ({ ...p, ...up }))} />}
      <AttachmentStrip list={project.attachments} />

      {!backupReady && <p className="note" style={{ color: 'var(--warn)' }}>⚠ Set a backup folder outside the app (Settings) — required before generating, and where the album skeleton is exposed for an external agent.</p>}

      <div className="row" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
        <button onClick={addMusic}>＋ Song</button>
        <button onClick={addDialog}>＋ Dialog</button>
        <button onClick={addUploads}>⭱ Upload audio</button>
        <button onClick={() => setTracks((ts) => [...ts, { id: uid('t_'), type: 'sfx', title: 'Sound effect', text: '', sfxDuration: 0, loop: false, promptInfluence: 0.3, sfxModel: SFX_MODELS[0].id, status: 'idle', gain: 1 }])} title="A sound-effect track (0.5–30 s) — transitions, interludes, ambience">＋ Sound effect</button>
        <button onClick={onFromSong} title="Reverse-engineer an existing song into a plan — recreate it, make siblings in its style">🎧 From a song…</button>
        <button onClick={onFromVideo} title="Score one or more video clips">🎬 From video…</button>
        <button onClick={() => onGenerate(gaps.map((tk) => tk.id))} disabled={!gaps.some((tk) => tk.status !== 'queued' && tk.status !== 'gen') || !backupReady} title={`Queue every track that has no audio yet — est. ${fmtUsd(gapCost)}. Keeps running while you browse other albums.`}>{queued ? `⏳ ${queued} queued for this album` : `⚡ Generate all gaps${gaps.length ? ` (${gaps.length}, ~${fmtUsd(gapCost)})` : ''}`}</button>
        <div className="grow" />
        <button onClick={() => player.playQueue(tracks.filter((tk) => tk.clipId))} disabled={!readyCount}>▶ Play all</button>
        <button onClick={() => player.enqueue(tracks.filter((tk) => tk.clipId))} disabled={!readyCount} title="Add this album to the end of the play queue">＋♫ Queue</button>
        <button onClick={onPublish} disabled={!readyCount} title={publishName ? `Write tagged tracks + playlist to ${publishName}/` : 'Set a publish folder in Settings (e.g. a phone-synced drive)'}>⇪ Publish</button>
        <button className="primary" onClick={onExport} disabled={!readyCount}>⤓ Export album</button>
      </div>
      <p className="note">{tracks.length} track{tracks.length === 1 ? '' : 's'} · {readyCount} ready · {gaps.length} gap{gaps.length === 1 ? '' : 's'} · {fmtDuration(totalMs)}</p>
      {dups.size > 0 && <p className="note" style={{ color: 'var(--warn)' }}>⚠ {dups.size} duplicate track{dups.size === 1 ? '' : 's'} (same prompt/voice) — “Generate all gaps” reuses audio instead of paying twice.</p>}

      {sel.size > 0 && (
        <div className="row" style={{ margin: '4px 0 10px', gap: 6, background: 'var(--panel2)', border: '1px solid var(--accent)', borderRadius: 8, padding: '6px 8px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13 }}>{sel.size} selected</span>
          <button className="mini" onClick={() => player.playQueue(tracks.filter((tk) => sel.has(tk.id) && tk.clipId))}>▶ Play</button>
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


      {!tracks.length && <div className="empty">Add a song, dialog line, or upload to start building your album.</div>}

      {tracks.map((tk, i) => (
        <div key={tk.id} className={`track ${player.playing === tk.id ? 'playing' : ''}`}>
          <div className="track-head">
            <input type="checkbox" checked={sel.has(tk.id)} onChange={() => toggleSel(tk.id)} style={{ width: 'auto' }} title="Select track" />
            <span className={`badge ${tk.type}`}>{tk.type}</span>
            <Stars value={tk.rating || 0} onChange={(v) => patch(tk.id, { rating: v })} size={12} />
            <button className="mini" onClick={() => patch(tk.id, { fav: !tk.fav })} title={tk.fav ? 'Unfavorite' : 'Favorite'} style={{ color: tk.fav ? 'var(--gold, #f5c451)' : 'var(--dim)', border: 'none', background: 'none', padding: 0 }}>{tk.fav ? '★' : '☆'}</button>
            {tk.qc && <span className="badge" style={{ color: QC_COLOR[tk.qc.grade], borderColor: QC_COLOR[tk.qc.grade] }} title={qcTitle(tk.qc)}>QC {tk.qc.grade}{tk.qc.flags?.length ? ' ⚠' : ''}</span>}
            {(tk.takes?.length || 0) > 0 && <span className="badge" title="Other takes of this track (open ▸ Takes below)">{tk.takes.length + 1} takes</span>}
            {dups.has(tk.id) && <span className="badge" style={{ color: 'var(--warn)', borderColor: 'var(--warn)' }} title="Same content as an earlier track — bulk-generate reuses its audio instead of paying again">⚠ dup</span>}
            <input className="grow" value={tk.title} onChange={(e) => patch(tk.id, { title: e.target.value })} />
            {tk.clipId && <span className="dim" style={{ fontSize: 12 }}>{fmtDuration(tk.durationMs)}</span>}
            <button className="mini" onClick={() => move(tk.id, -1)} disabled={i === 0} title="Move up">▲</button>
            <button className="mini" onClick={() => move(tk.id, 1)} disabled={i === tracks.length - 1} title="Move down">▼</button>
            {tk.clipId && <button className="mini" onClick={() => player.play(tk, tracks)}>{player.playing === tk.id ? (player.paused ? '▶' : '⏸') : '▶'}</button>}
            {tk.clipId && <button className="mini" onClick={() => player.enqueue([tk])} title="Add to the end of the play queue">＋♫</button>}
            {tk.clipId && <button className="mini" onClick={() => toggleEdit(tk.id)} title="Trim / fade">✎</button>}
            <button className={`mini${hasNotes(tk) ? ' primary' : ''}`} onClick={() => toggleNotes(tk.id)} title="Notes, likes and dislikes for this song">📝</button>
            <button className="mini" onClick={() => duplicateTrack(tk)} title="Duplicate track">⧉</button>
            <button className="mini danger" onClick={() => remove(tk)}>🗑</button>
          </div>

          {openNotes.has(tk.id) && <NotesPanel obj={tk} onChange={(up) => patch(tk.id, up)} />}
          {tk.clipId && <Waveform clipId={tk.clipId} progress={player.playing === tk.id ? (player.dur ? player.cur / player.dur : 0) : 0} onSeek={(frac) => { if (player.playing === tk.id) player.seek(frac * (player.dur || 0)); else player.play(tk, tracks); }} />}

          {tk.type === 'music' && <MusicFields t={tk} patch={(up) => patch(tk.id, up)} prefs={prefs} apiKey={apiKey} player={player} finetunes={finetunes} onDeleteTakes={onDeleteTakes} onInpaint={onInpaint} />}
          {tk.type === 'dialog' && (
            <>
              <label>Text</label>
              <textarea value={tk.text} onChange={(e) => patch(tk.id, { text: e.target.value })} placeholder="Spoken line to splice into the album…" />
              <div className="row" style={{ marginTop: 6 }}>
                <div className="grow"><label>Voice</label><select value={tk.voiceId} onChange={(e) => patch(tk.id, { voiceId: e.target.value, voiceName: voices.find((v) => v.id === e.target.value)?.name || '' })}>
                  <option value="">{voices.length ? '— pick a voice —' : '— test key in Settings to load voices —'}</option>
                  {voices.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select></div>
                <div className="grow"><label>Model</label><select value={tk.ttsModel} onChange={(e) => patch(tk.id, { ttsModel: e.target.value })}>{ttsModels.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></div>
              </div>
            </>
          )}
          {tk.type === 'sfx' && (
            <>
              <label>Sound to make</label>
              <textarea value={tk.text || ''} onChange={(e) => patch(tk.id, { text: e.target.value })} placeholder="e.g. heavy door slams shut in a stone hall, long echo" />
              <div className="row" style={{ marginTop: 6, flexWrap: 'wrap' }}>
                <div><label>Length (s, 0 = auto)</label><input type="number" min="0" max="30" step="0.5" value={tk.sfxDuration || 0} onChange={(e) => patch(tk.id, { sfxDuration: Math.max(0, Math.min(30, +e.target.value)) })} style={{ width: 90 }} /></div>
                <div><label>Follow prompt</label><input type="range" min="0" max="1" step="0.05" value={tk.promptInfluence ?? 0.3} onChange={(e) => patch(tk.id, { promptInfluence: +e.target.value })} style={{ width: 110 }} /></div>
                <div className="grow"><label>Model</label><select value={tk.sfxModel || SFX_MODELS[0].id} onChange={(e) => patch(tk.id, { sfxModel: e.target.value })}>{SFX_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></div>
                <label style={{ marginTop: 20 }}><input type="checkbox" checked={!!tk.loop} onChange={(e) => patch(tk.id, { loop: e.target.checked })} style={{ width: 'auto', marginRight: 5 }} />Loop seamlessly</label>
              </div>
            </>
          )}
          {tk.type === 'upload' && (
            <p className="note">Uploaded file: {tk.fileName}{' '}
              <button className="mini" title="Turn this upload into a song entry: keep the audio, add the prompt it was made from"
                onClick={() => patch(tk.id, { type: 'music', prompt: '', lengthMs: Math.max(3000, Math.min(600000, Math.round((tk.durationMs || 60000) / 1000) * 1000)), ...newTrackModel(prefs), instrumental: false })}>＋ Add prompt (make it a song)</button>
            </p>
          )}

          <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
            {tk.clipId && tk.type !== 'dialog' && <select className="mini" value="" onChange={(e) => { if (e.target.value) onStems(tk, e.target.value); }} style={{ width: 'auto' }} title="Split into stems (vocals, drums, bass…) — written to the album's stems/ folder"><option value="">🎚 Stems…</option><option value="six_stems_v1">6 stems</option><option value="two_stems_v1">2 stems (vocals / music)</option></select>}
            {tk.type !== 'upload' && (
              <button className="mini" onClick={() => onGenerate([tk.id])} disabled={tk.status === 'gen' || tk.status === 'queued' || (tk.type === 'sfx' ? !tk.text?.trim() : tk.type === 'music' ? (tk.usePlan ? !tk.plan?.chunks?.length : !tk.prompt?.trim() || tk.prompt.length > MUSIC_PROMPT_MAX) : !(tk.text.trim() && tk.voiceId))}>
                {tk.status === 'gen' ? '… generating' : tk.status === 'queued' ? '⏳ queued' : tk.clipId ? '↻ Regenerate' : '✦ Generate'}
              </button>
            )}
            <button className="mini" onClick={() => (linking?.id === tk.id ? setLinking(null) : startLink(tk))} title="Use an audio file that already exists — from this album's folder or your computer. No regeneration, no spend.">📎 {tk.clipId ? 'Relink' : 'Link file'}</button>
            <span className={`status ${tk.status === 'error' ? 'err' : ''}`}>
              {tk.status === 'gen' ? 'Calling ElevenLabs…' : tk.status === 'queued' ? 'Waiting in the generation queue' : tk.status === 'error' ? '⚠ ' + tk.error : tk.clipId ? '✓ ready' : ''}
            </span>
            <div className="grow" />
            <input value={tk.sourceUrl || ''} onChange={(e) => patch(tk.id, { sourceUrl: e.target.value.trim() })} placeholder="🔗 song page URL (e.g. ElevenLabs)" title="The web page this song was generated on" style={{ width: 230, fontSize: 12, padding: '3px 7px' }} />
            {safeUrl(tk.sourceUrl) && <a href={safeUrl(tk.sourceUrl)} target="_blank" rel="noopener noreferrer" title="Open the page this song was generated on">↗</a>}
            {tk.clipId && <span className="gain">vol <input type="range" min="0" max="1.5" step="0.05" value={tk.gain ?? 1} onChange={(e) => patch(tk.id, { gain: +e.target.value })} />{Math.round((tk.gain ?? 1) * 100)}%</span>}
          </div>

          {tk.stems?.length > 0 && (
            <div className="row" style={{ marginTop: 6, flexWrap: 'wrap', gap: 4, fontSize: 12 }}>
              <span className="dim">🎚 Stems:</span>
              {tk.stems.map((st) => { const tr = { ...st, id: st.clipId, title: `${tk.title} · ${st.name}`, gain: 1 }; return <button key={st.clipId} className="mini" onClick={() => player.play(tr, tk.stems.map((x) => ({ ...x, id: x.clipId, title: `${tk.title} · ${x.name}`, gain: 1 })))} title={st.file}>{player.playing === st.clipId && !player.paused ? '⏸' : '▶'} {st.name}</button>; })}
            </div>
          )}
          {linking?.id === tk.id && (
            <div className="row" style={{ marginTop: 6, flexWrap: 'wrap' }}>
              {backupReady && (
                <select value="" onChange={(e) => e.target.value && doLink(tk, e.target.value)} className="grow" style={{ minWidth: 220 }}>
                  <option value="">{linking.files === null ? 'Reading the album folder…' : linking.files.length ? `Pick a file in this album's folder (${linking.files.length})…` : 'No audio files in this album’s folder'}</option>
                  {(linking.files || []).map((f) => <option key={f.name} value={f.name}>{f.match ? '★ ' : ''}{f.used ? '(in use) ' : ''}{f.name}</option>)}
                </select>
              )}
              <button className="mini" onClick={() => pickFile('audio/*').then((fs) => fs[0] && doLink(tk, fs[0]))}>From computer…</button>
              <button className="mini" onClick={() => setLinking(null)}>Cancel</button>
              <span className="dim" style={{ fontSize: 11 }}>★ = name matches this track</span>
            </div>
          )}

          {tk.clipId && openEdit.has(tk.id) && (
            <div className="row" style={{ marginTop: 8, gap: 12, flexWrap: 'wrap', fontSize: 11, color: 'var(--dim)' }}>
              {[['trimStartMs', 'trim in'], ['trimEndMs', 'trim out'], ['fadeInMs', 'fade in'], ['fadeOutMs', 'fade out']].map(([k, lbl]) => (
                <span key={k}>{lbl} <input type="number" min="0" step="0.1" value={editSec(tk, k)} onChange={(e) => patch(tk.id, { [k]: Math.max(0, +e.target.value * 1000) })} style={{ width: 60 }} />s</span>
              ))}
              <span>· applied on export &amp; album mix</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
