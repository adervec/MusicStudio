import { usePlayer } from './usePlayer.js';
import { fmtDuration } from '../state/pricing.js';
import { isGap } from '../album/skeleton.js';
import { descendantIds } from '../album/library.js';
import AttachmentStrip from './AttachmentStrip.jsx';
import { Stars, NotesPanel, hasNotes } from './Rating.jsx';
import { groupRatings, albumRating } from '../album/taste.js';
import { useState } from 'react';

// Read-only overview of a group: every album under it (recursively) with its songs, and a Play-all
// across the whole group. No editing — click an album to open it in the editor.
export default function GroupView({ group, groups, projects, onOpenAlbum, onCopyPath, onAttachments, onChangeGroup }) {
  const [notes, setNotes] = useState(false);
  const gr = groupRatings(groups, projects).get(group.id) || {};
  const player = usePlayer();

  const ids = descendantIds(group.id, groups);
  const albums = projects.filter((p) => ids.has(p.parentId));
  const allReady = albums.flatMap((a) => (a.tracks || []).filter((t) => t.clipId));
  const totalMs = allReady.reduce((s, t) => s + (t.durationMs || 0), 0);
  const gaps = albums.reduce((s, a) => s + (a.tracks || []).filter(isGap).length, 0);

  return (
    <div>
      <div className="row" style={{ marginBottom: 8 }}>
        <h2 style={{ fontSize: 20 }}>📁 {group.name}</h2>
        <Stars value={group.rating || 0} onChange={(v) => onChangeGroup({ rating: v })} calc={gr.calc} n={gr.n} size={16} />
        <button className={`mini${hasNotes(group) ? ' primary' : ''}`} onClick={() => setNotes((v) => !v)} title="Group notes, likes and dislikes">📝</button>
        <div className="grow" />
        <button className="mini" onClick={onAttachments} title="Liner notes, artwork or references for this whole set of albums">📎 Attachments{group.attachments?.length ? ` (${group.attachments.length})` : ''}…</button>
        <button className="mini" onClick={onCopyPath} title="Open this group's folder in File Explorer (or copy its path)">📂 Open folder</button>
        <button className="primary" onClick={() => player.playQueue(allReady)} disabled={!allReady.length}>▶ Play all ({allReady.length})</button>
      </div>
      <p className="note">{albums.length} album{albums.length === 1 ? '' : 's'} · {allReady.length} song{allReady.length === 1 ? '' : 's'} · {fmtDuration(totalMs)}{gaps > 0 && <span style={{ color: 'var(--warn)' }}> · {gaps} gap{gaps === 1 ? '' : 's'}</span>} · read-only</p>
      {notes && <NotesPanel obj={group} what="group" onChange={onChangeGroup} />}
      <AttachmentStrip list={group.attachments} />

      {!albums.length && <div className="empty">No albums in this group yet.</div>}
      {albums.map((a) => (
        <div key={a.id} className="track">
          <div className="track-head">
            <span className="grow" style={{ fontWeight: 600, cursor: 'pointer' }} onClick={() => onOpenAlbum(a.id)} title="Open album">🎵 {a.title || 'Untitled'}</span>
            {(() => { const r = albumRating(a); return r.eff ? <span className="dim" style={{ fontSize: 12 }} title={r.mine ? 'your rating' : `from ${r.n} rated songs`}>{(Math.round(r.eff * 10) / 10)}★{r.mine ? '' : '*'}</span> : null; })()}
            <span className="dim" style={{ fontSize: 12 }}>{(a.tracks || []).filter((t) => t.clipId).length}/{(a.tracks || []).length}</span>
            <button className="mini" onClick={() => onOpenAlbum(a.id)}>Open ›</button>
          </div>
          {(a.tracks || []).map((t) => (
            <div key={t.id} className="row" style={{ padding: '3px 0', fontSize: 13 }}>
              <span className={`badge ${t.type}`}>{t.type}</span>
              <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title || '(untitled)'}</span>
              {t.clipId
                ? <><span className="dim" style={{ fontSize: 12 }}>{fmtDuration(t.durationMs)}</span><button className="mini" onClick={() => player.play(t, allReady)}>{player.playing === t.id ? (player.paused ? '▶' : '⏸') : '▶'}</button></>
                : <span className="dim" style={{ fontSize: 12, color: 'var(--warn)' }}>gap</span>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
