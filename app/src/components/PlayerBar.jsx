import { useEffect, useState } from 'react';
import { usePlayer } from './usePlayer.js';
import { t } from '../i18n.js';

const fmtClock = (s) => { s = Math.max(0, s || 0); return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`; };
const on = (b) => (b ? { color: 'var(--accent)', borderColor: 'var(--accent)' } : undefined);

// The persistent mini-player along the bottom: what's playing (click the album to open it),
// transport + seek, and an editable "Up next" queue panel. Stays put while you navigate.
// `info(trackId)` → { title, album, albumId } from the live library (titles stay current).
export default function PlayerBar({ info, onOpenAlbum }) {
  const p = usePlayer();
  const [open, setOpen] = useState(false);
  const shown = p.queue.length > 0;
  useEffect(() => { document.documentElement.style.setProperty('--bar', shown ? '62px' : '0px'); }, [shown]);
  if (!shown) return null;
  const tk = p.queue[p.index];
  const meta = (x) => ({ title: x?.title, ...(info?.(x?.id) || {}) });
  const m = meta(tk);
  return (
    <>
      {open && (
        <div className="queue-panel">
          <div className="row" style={{ padding: '8px 12px', borderBottom: '1px solid var(--line)' }}>
            <b>{t('Up next')}</b><span className="dim" style={{ fontSize: 12 }}>{t('{n} after this · {count} total', { n: p.queue.length - p.index - 1, count: p.queue.length })}</span>
            <div className="grow" />
            <button className="mini" onClick={p.clearUpcoming} disabled={p.index >= p.queue.length - 1}>{t('Clear upcoming')}</button>
            <button className="mini" onClick={() => setOpen(false)}>✕</button>
          </div>
          <div style={{ overflowY: 'auto', maxHeight: '50vh' }}>
            {p.queue.map((x, i) => {
              const mx = meta(x);
              return (
                <div key={x.id + ':' + i} className={`queue-row${i === p.index ? ' now' : ''}${i < p.index ? ' past' : ''}`}>
                  <span className="dim" style={{ width: 26, textAlign: 'right', fontSize: 11 }}>{i === p.index ? (p.paused ? '❚❚' : '♪') : i + 1}</span>
                  <span className="grow" style={{ minWidth: 0, cursor: 'pointer' }} onClick={() => p.playIndex(i)} title={t('Play this')}>
                    <div className="ell">{mx.title || t('Untitled')}</div>
                    <div className="ell dim" style={{ fontSize: 11 }}>{mx.album || ''}</div>
                  </span>
                  <span className="dim" style={{ fontSize: 11 }}>{x.durationMs ? fmtClock(x.durationMs / 1000) : ''}</span>
                  <button className="mini" onClick={() => p.moveItem(i, -1)} disabled={!i} title={t('Move up')}>▲</button>
                  <button className="mini" onClick={() => p.moveItem(i, 1)} disabled={i === p.queue.length - 1} title={t('Move down')}>▼</button>
                  <button className="mini" onClick={() => p.removeAt(i)} title={t('Remove from queue')}>✕</button>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="player-bar">
        <div className="pb-now">
          <div className="ell" style={{ fontWeight: 600 }}>{m.title || t('Untitled')}</div>
          <div className="ell dim" style={{ fontSize: 12 }}>
            {m.albumId ? <a href="#" onClick={(e) => { e.preventDefault(); onOpenAlbum(m.albumId); }}>{m.album}</a> : m.album}
          </div>
        </div>
        <div className="pb-controls">
          <button className="mini" onClick={p.toggleShuffle} title={t('Shuffle upcoming')} style={on(p.shuffle)}>🔀</button>
          <button className="mini" onClick={p.prev} title={t('Previous (←)')}>⏮</button>
          <button onClick={p.togglePause} title={t('Play / pause (Space)')} className="primary" style={{ minWidth: 40 }}>{p.paused ? '▶' : '⏸'}</button>
          <button className="mini" onClick={p.next} disabled={p.index >= p.queue.length - 1 && p.repeat !== 'all'} title={t('Next (→)')}>⏭</button>
          <button className="mini" onClick={p.cycleRepeat} title={t('Repeat: {repeat}', { repeat: p.repeat })} style={on(p.repeat !== 'off')}>{p.repeat === 'one' ? '🔂' : '🔁'}</button>
        </div>
        <div className="pb-seek">
          <span className="dim">{fmtClock(p.cur)}</span>
          <input type="range" min="0" max={p.dur || 0} step="0.01" value={p.cur} onChange={(e) => p.seek(+e.target.value)} />
          <span className="dim">{fmtClock(p.dur)}</span>
        </div>
        <button className={`mini${open ? ' primary' : ''}`} onClick={() => setOpen((v) => !v)} title={t('Show / edit the queue')}>☰ {p.index + 1}/{p.queue.length}</button>
        <button className="mini" onClick={p.stop} title={t('Stop and clear the queue')}>✕</button>
      </div>
    </>
  );
}
