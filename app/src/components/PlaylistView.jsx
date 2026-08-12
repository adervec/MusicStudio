import { useState } from 'react';
import { usePlayer } from './usePlayer.js';
import Transport from './Transport.jsx';
import { fmtDuration } from '../state/pricing.js';
import { resolvePlaylist, ruleLabel, DYNAMIC_FIELDS } from '../album/playlists.js';

// A static (curated) or dynamic (rule-based) playlist: play it (with shuffle/repeat), and edit it —
// reorder/add/remove for static, or configure the rule for dynamic. onChange persists.
export default function PlaylistView({ playlist, projects, groups, onChange, onRename, onDelete, onOpenAlbum }) {
  const player = usePlayer();
  const [adding, setAdding] = useState(false);
  const tracks = resolvePlaylist(playlist, projects, groups);
  const totalMs = tracks.reduce((s, t) => s + (t.durationMs || 0), 0);

  const set = (patch) => onChange({ ...playlist, ...patch });
  const setItems = (items) => set({ items });
  const setRule = (rule) => set({ rule });
  const inList = (pid, tid) => (playlist.items || []).some((it) => it.projectId === pid && it.trackId === tid);
  const rule = playlist.rule || { field: 'all' };

  function moveItem(i, dir) { const j = i + dir; const it = [...(playlist.items || [])]; if (j < 0 || j >= it.length) return; [it[i], it[j]] = [it[j], it[i]]; setItems(it); }
  function removeItem(i) { setItems((playlist.items || []).filter((_, x) => x !== i)); }
  function addItem(pid, tid) { setItems([...(playlist.items || []), { projectId: pid, trackId: tid }]); }

  return (
    <div>
      <div className="row" style={{ marginBottom: 8 }}>
        <h2 style={{ fontSize: 20 }}>▤ {playlist.name}</h2>
        <span className="dim" style={{ fontSize: 12 }}>{playlist.kind === 'static' ? 'static' : `dynamic · ${ruleLabel(playlist, groups)}`}</span>
        <div className="grow" />
        <button className="mini" onClick={onRename}>✎ Rename</button>
        <button className="mini danger" onClick={onDelete}>🗑 Delete</button>
      </div>
      <div className="row" style={{ marginBottom: 8, gap: 10 }}>
        <label style={{ margin: 0 }}><input type="radio" checked={playlist.kind === 'static'} onChange={() => set({ kind: 'static' })} style={{ width: 'auto', marginRight: 4 }} />Static (hand-picked)</label>
        <label style={{ margin: 0 }}><input type="radio" checked={playlist.kind === 'dynamic'} onChange={() => set({ kind: 'dynamic' })} style={{ width: 'auto', marginRight: 4 }} />Dynamic (rule)</label>
        <div className="grow" />
        <button className="primary" onClick={() => player.playQueue(tracks)} disabled={!tracks.length}>▶ Play all ({tracks.length})</button>
      </div>
      <p className="note">{tracks.length} song{tracks.length === 1 ? '' : 's'} · {fmtDuration(totalMs)}</p>
      <Transport player={player} label={(id) => tracks.find((t) => t.id === id)?.title} />

      {playlist.kind === 'dynamic' ? (
        <div className="row" style={{ margin: '8px 0', gap: 8, flexWrap: 'wrap' }}>
          <label style={{ margin: 0 }}>Rule:</label>
          <select value={rule.field} onChange={(e) => setRule({ field: e.target.value, value: '' })} style={{ width: 'auto' }}>
            {DYNAMIC_FIELDS.map((f) => <option key={f.field} value={f.field}>{f.label}</option>)}
          </select>
          {rule.field === 'group' && <select value={rule.value || ''} onChange={(e) => setRule({ ...rule, value: e.target.value })} style={{ width: 'auto' }}><option value="">— pick —</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>}
          {rule.field === 'type' && <select value={rule.value || ''} onChange={(e) => setRule({ ...rule, value: e.target.value })} style={{ width: 'auto' }}><option value="">— pick —</option>{['music', 'dialog', 'upload'].map((x) => <option key={x} value={x}>{x}</option>)}</select>}
          {(rule.field === 'genre' || rule.field === 'search') && <input value={rule.value || ''} onChange={(e) => setRule({ ...rule, value: e.target.value })} placeholder="text…" style={{ maxWidth: 220 }} />}
        </div>
      ) : (
        <div className="row" style={{ margin: '6px 0' }}><button onClick={() => setAdding((a) => !a)}>{adding ? 'Done adding' : '＋ Add tracks'}</button></div>
      )}

      {adding && playlist.kind === 'static' && (
        <div className="track" style={{ maxHeight: 240, overflow: 'auto' }}>
          {projects.map((p) => {
            const ready = (p.tracks || []).filter((t) => t.clipId);
            if (!ready.length) return null;
            return (
              <div key={p.id} style={{ marginBottom: 4 }}>
                <div className="dim" style={{ fontSize: 12, fontWeight: 600 }}>{p.title || 'Untitled'}</div>
                {ready.map((t) => (
                  <div key={t.id} className="row" style={{ fontSize: 13, padding: '2px 0' }}>
                    <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                    <button className="mini" onClick={() => addItem(p.id, t.id)}>{inList(p.id, t.id) ? '＋ again' : '＋'}</button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* Track list */}
      {playlist.kind === 'static'
        ? (playlist.items || []).map((it, i) => {
            const p = projects.find((x) => x.id === it.projectId);
            const t = p?.tracks?.find((x) => x.id === it.trackId);
            return (
              <div key={i} className="row" style={{ padding: '4px 0', fontSize: 13, borderBottom: '1px solid var(--line)' }}>
                <span className="dim" style={{ width: 22 }}>{i + 1}</span>
                <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t ? t.title : <span style={{ color: 'var(--bad)' }}>(missing)</span>}<span className="dim"> · {p?.title || '?'}</span></span>
                {t?.clipId && <button className="mini" onClick={() => player.play(t, tracks)}>{player.playing === t.id ? (player.paused ? '▶' : '⏸') : '▶'}</button>}
                <button className="mini" onClick={() => moveItem(i, -1)} disabled={i === 0}>▲</button>
                <button className="mini" onClick={() => moveItem(i, 1)} disabled={i === (playlist.items.length - 1)}>▼</button>
                <button className="mini danger" onClick={() => removeItem(i)}>✕</button>
              </div>
            );
          })
        : tracks.map((t, i) => (
            <div key={t.id + i} className="row" style={{ padding: '4px 0', fontSize: 13, borderBottom: '1px solid var(--line)' }}>
              <span className="dim" style={{ width: 22 }}>{i + 1}</span>
              <span className={`badge ${t.type}`}>{t.type}</span>
              <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}<span className="dim"> · {t._album}</span></span>
              <span className="dim" style={{ fontSize: 12 }}>{fmtDuration(t.durationMs)}</span>
              <button className="mini" onClick={() => player.play(t, tracks)}>{player.playing === t.id ? (player.paused ? '▶' : '⏸') : '▶'}</button>
              <button className="mini" onClick={() => onOpenAlbum(t._projectId)} title="Open album">›</button>
            </div>
          ))}
      {!tracks.length && playlist.kind === 'dynamic' && <p className="note">No songs match this rule yet.</p>}
    </div>
  );
}
