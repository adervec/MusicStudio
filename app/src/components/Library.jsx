import { useMemo, useState } from 'react';
import { usePlayer } from './usePlayer.js';
import Transport from './Transport.jsx';
import { libraryRows, filterRows, sortRows, libraryStats, breakdown, toCsv } from '../album/library.js';
import { groupFolderPath } from '../album/skeleton.js';
import { fmtDuration, fmtUsd } from '../state/pricing.js';
import { download } from '../backup/fs.js';

const COLS = [
  { key: 'fav', label: '★' }, { key: 'title', label: 'Title' }, { key: 'album', label: 'Album' }, { key: 'group', label: 'Group' },
  { key: 'n', label: '#' }, { key: 'type', label: 'Type' }, { key: 'status', label: 'Status' }, { key: 'ms', label: 'Length' },
  { key: 'genre', label: 'Genre' }, { key: 'year', label: 'Year' }, { key: 'prompt', label: 'Prompt' },
];
const BREAKDOWNS = [
  { label: 'By group', fn: (r) => r.group.split('/')[0] }, { label: 'By genre', fn: (r) => r.genre },
  { label: 'By year', fn: (r) => String(r.year || '') }, { label: 'By type', fn: (r) => r.type },
];
const MAX_ROWS = 1000; // ponytail: plain table, capped — virtualize if libraries outgrow it

// Every track in the library as one sortable, filterable table, with stats that follow the filter.
export default function Library({ projects, groups, onOpenAlbum }) {
  const player = usePlayer();
  const [f, setF] = useState({ q: '', group: '', type: '', status: '', fav: false });
  const [sort, setSort] = useState({ key: 'album', dir: 1 });
  const [showStats, setShowStats] = useState(true);
  const all = useMemo(() => libraryRows(projects, groups), [projects, groups]);
  const rows = useMemo(() => sortRows(filterRows(all, f), sort.key, sort.dir), [all, f, sort]);
  const s = useMemo(() => libraryStats(rows), [rows]);
  const groupOpts = useMemo(() => groups.map((g) => groupFolderPath(g, groups)).sort(), [groups]);
  const ready = rows.filter((r) => r.status === 'ready').map((r) => r.track);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const by = (key) => setSort((x) => ({ key, dir: x.key === key ? -x.dir : key === 'ms' || key === 'fav' ? -1 : 1 }));
  const filtered = f.q || f.group || f.type || f.status || f.fav;

  return (
    <div>
      <div className="row" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 20 }}>📊 Library</h2>
        <div className="grow" />
        <button className="mini" onClick={() => setShowStats((v) => !v)}>{showStats ? 'Hide stats' : 'Show stats'}</button>
        <button className="mini" onClick={() => download(new Blob([toCsv(rows, ['album', 'group', 'n', 'title', 'type', 'status', 'ms', 'genre', 'year', 'artist', 'fav', 'prompt'])], { type: 'text/csv' }), 'musicstudio-library.csv')} disabled={!rows.length}>⤓ CSV</button>
        <button className="primary" onClick={() => player.playQueue(ready)} disabled={!ready.length}>▶ Play {filtered ? 'filtered' : 'all'} ({ready.length})</button>
      </div>

      <div className="lib-filters">
        <input value={f.q} onChange={set('q')} placeholder="Search titles, albums, prompts, genres…" style={{ flex: 3 }} />
        <select value={f.group} onChange={set('group')}><option value="">All groups</option>{groupOpts.map((g) => <option key={g} value={g}>{g}</option>)}</select>
        <select value={f.type} onChange={set('type')}><option value="">All types</option><option value="music">Song</option><option value="dialog">Dialog</option><option value="upload">Upload</option></select>
        <select value={f.status} onChange={set('status')}><option value="">Any status</option><option value="ready">Ready</option><option value="gap">Gap (to generate)</option><option value="empty">Empty</option></select>
        <label className="row" style={{ margin: 0, whiteSpace: 'nowrap' }}><input type="checkbox" style={{ width: 'auto' }} checked={f.fav} onChange={set('fav')} /> ★ only</label>
        {filtered && <button className="mini" onClick={() => setF({ q: '', group: '', type: '', status: '', fav: false })}>Clear</button>}
      </div>

      {showStats && (
        <>
          <div className="cards">
            <div className="card"><div className="dim">Albums</div><div className="big">{s.albums}</div></div>
            <div className="card"><div className="dim">Songs ready</div><div className="big">{s.ready}<span className="dim" style={{ fontSize: 14 }}> / {s.tracks}</span></div></div>
            <div className="card"><div className="dim">Listening time</div><div className="big">{fmtDuration(s.ms)}</div></div>
            <div className="card"><div className="dim">Gaps</div><div className="big" style={{ color: s.gaps ? 'var(--warn)' : undefined }}>{s.gaps}</div><div className="dim" style={{ fontSize: 11 }}>≈ {fmtUsd(s.gapCost)} to generate</div></div>
            <div className="card"><div className="dim">Favorites</div><div className="big">{s.favs}</div></div>
          </div>
          <div className="lib-breakdowns">
            {BREAKDOWNS.map(({ label, fn }) => {
              const b = breakdown(rows, fn).slice(0, 8); const max = Math.max(1, ...b.map((x) => x.ms || x.n));
              return (
                <div key={label} className="card">
                  <div className="dim" style={{ marginBottom: 6 }}>{label}</div>
                  <div className="days">
                    {b.map((x) => (
                      <div key={x.k} className="day" title={`${x.ready}/${x.n} ready · ${fmtDuration(x.ms)}`}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.k}</span>
                        <div className="bar"><div style={{ width: `${((x.ms || x.n) / max) * 100}%` }} /></div>
                        <span className="cost">{x.ms ? fmtDuration(x.ms) : `${x.n} trk`}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <Transport player={player} label={(id) => rows.find((r) => r.id === id)?.title || ''} />

      <div className="lib-table">
        <table>
          <thead><tr>
            <th />
            {COLS.map((c) => <th key={c.key} onClick={() => by(c.key)} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>{c.label}{sort.key === c.key ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>)}
          </tr></thead>
          <tbody>
            {rows.slice(0, MAX_ROWS).map((r) => (
              <tr key={r.albumId + r.id} className={player.playing === r.id ? 'playing' : ''}>
                <td>{r.status === 'ready' && <button className="mini" onClick={() => player.play(r.track, ready)}>{player.playing === r.id && !player.paused ? '⏸' : '▶'}</button>}</td>
                <td style={{ color: 'var(--gold, #f5c451)' }}>{r.fav ? '★' : ''}</td>
                <td>{r.title || <span className="dim">(untitled)</span>}</td>
                <td><a href="#" onClick={(e) => { e.preventDefault(); onOpenAlbum(r.albumId); }}>{r.album}</a></td>
                <td className="dim">{r.group}</td>
                <td className="dim">{r.n}</td>
                <td><span className={`badge ${r.type}`}>{r.type}</span></td>
                <td style={{ color: r.status === 'gap' ? 'var(--warn)' : r.status === 'ready' ? 'var(--good)' : 'var(--dim)' }}>{r.status}</td>
                <td className="dim">{r.ms ? fmtDuration(r.ms) : ''}</td>
                <td>{r.genre}</td>
                <td>{r.year}</td>
                <td className="lib-prompt" title={r.prompt}>{r.prompt}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <div className="empty">{all.length ? 'Nothing matches these filters.' : 'No tracks in the library yet.'}</div>}
        {rows.length > MAX_ROWS && <p className="note">Showing the first {MAX_ROWS} of {rows.length} — narrow the filter to see the rest (CSV has them all).</p>}
      </div>
    </div>
  );
}
