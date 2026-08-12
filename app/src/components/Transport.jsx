const fmtClock = (s) => { s = Math.max(0, s || 0); return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`; };

// Player controls bound to a usePlayer() instance. `label(id)` maps a track id → display title.
export default function Transport({ player, label }) {
  const { playing, paused, pos, cur, dur, shuffle, repeat } = player;
  if (!playing) return null;
  return (
    <div className="row" style={{ margin: '4px 0 12px', gap: 6, background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: 8, padding: '6px 8px', flexWrap: 'wrap' }}>
      <button className="mini" onClick={player.toggleShuffle} title="Shuffle" style={{ color: shuffle ? 'var(--accent)' : undefined, borderColor: shuffle ? 'var(--accent)' : undefined }}>🔀</button>
      <button className="mini" onClick={player.prev} disabled={pos.idx <= 0 && repeat !== 'all'} title="Previous track">⏮</button>
      <button className="mini" onClick={player.togglePause} title={paused ? 'Play' : 'Pause'}>{paused ? '▶' : '⏸'}</button>
      <button className="mini" onClick={player.next} disabled={pos.idx >= pos.total - 1 && repeat !== 'all'} title="Next track">⏭</button>
      <button className="mini" onClick={player.stop} title="Stop">⏹</button>
      <button className="mini" onClick={player.cycleRepeat} title={`Repeat: ${repeat}`} style={{ color: repeat !== 'off' ? 'var(--accent)' : undefined, borderColor: repeat !== 'off' ? 'var(--accent)' : undefined }}>{repeat === 'one' ? '🔂' : '🔁'}</button>
      <span className="dim" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{pos.idx + 1}/{pos.total}</span>
      <span style={{ fontSize: 12, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label?.(playing) || ''}</span>
      <input className="grow" type="range" min="0" max={dur || 0} step="0.01" value={cur} onChange={(e) => player.seek(+e.target.value)} style={{ minWidth: 120 }} />
      <span className="dim" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{fmtClock(cur)} / {fmtClock(dur)}</span>
    </div>
  );
}
