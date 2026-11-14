import { useMemo, useState } from 'react';
import { usePlayer } from './usePlayer.js';
import { libraryRows, filterRows, sortRows, libraryStats, breakdown, toCsv, logbook } from '../album/library.js';
import { Stars } from './Rating.jsx';
import { groupFolderPath } from '../album/skeleton.js';
import { fmtDuration, fmtUsd } from '../state/pricing.js';
import { download } from '../backup/fs.js';
import { t } from '../i18n.js';

const COLS = [
  { key: 'rating', label: t('Rating') }, { key: 'fav', label: '♥' }, { key: 'title', label: t('Title') }, { key: 'album', label: t('Album') }, { key: 'group', label: t('Group') },
  { key: 'n', label: '#' }, { key: 'type', label: t('Type') }, { key: 'status', label: t('Status') }, { key: 'ms', label: t('Length') },
  { key: 'qc', label: t('QC') }, { key: 'takes', label: t('Takes') }, { key: 'genre', label: t('Genre') }, { key: 'year', label: t('Year') }, { key: 'url', label: '🔗' }, { key: 'prompt', label: t('Prompt') }, { key: 'notes', label: t('Notes') },
];
const BREAKDOWNS = [
  { label: t('By group'), fn: (r) => r.group.split('/')[0] }, { label: t('By genre'), fn: (r) => r.genre },
  { label: t('By year'), fn: (r) => String(r.year || '') }, { label: t('By type'), fn: (r) => r.type },
];
const MAX_ROWS = 1000; // ponytail: plain table, capped — virtualize if libraries outgrow it

// Every track in the library as one sortable, filterable table, with stats that follow the filter.
export default function Library({ projects, groups, onOpenAlbum, onRate, onGenerate, playlists = [], onAddToPlaylist }) {
  const player = usePlayer();
  const NOF = { q: '', group: '', type: '', status: '', fav: false, minRating: 0 };
  const [f, setF] = useState(NOF);
  const [sel, setSel] = useState(() => new Set()); const [anchor, setAnchor] = useState(-1);
  const [sort, setSort] = useState({ key: 'album', dir: 1 });
  const [showStats, setShowStats] = useState(true);
  const all = useMemo(() => libraryRows(projects, groups), [projects, groups]);
  const rows = useMemo(() => sortRows(filterRows(all, f), sort.key, sort.dir), [all, f, sort]);
  const s = useMemo(() => libraryStats(rows), [rows]);
  const groupOpts = useMemo(() => groups.map((g) => groupFolderPath(g, groups)).sort(), [groups]);
  const ready = rows.filter((r) => r.status === 'ready').map((r) => r.track);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : k === 'minRating' ? +e.target.value : e.target.value }));
  const key = (r) => r.albumId + ':' + r.id;
  // Click toggles; Shift+click selects the range from the last click (Ctrl/⌘ just toggles, as usual).
  const pick = (i, e) => { const shown = rows.slice(0, MAX_ROWS); setSel((s) => { const n = new Set(s); if (e.shiftKey && anchor >= 0) { const [a, b] = [Math.min(anchor, i), Math.max(anchor, i)]; for (let j = a; j <= b; j++) n.add(key(shown[j])); } else n.has(key(shown[i])) ? n.delete(key(shown[i])) : n.add(key(shown[i])); return n; }); setAnchor(i); };
  const chosen = rows.filter((r) => sel.has(key(r)));
  const byAlbum = (list) => { const m = new Map(); for (const r of list) { const a = m.get(r.albumId) || []; a.push(r.id); m.set(r.albumId, a); } return [...m].map(([projectId, trackIds]) => ({ projectId, trackIds })); };
  const by = (key) => setSort((x) => ({ key, dir: x.key === key ? -x.dir : key === 'ms' || key === 'fav' ? -1 : 1 }));
  const filtered = f.q || f.group || f.type || f.status || f.fav || f.minRating;

  return (
    <div>
      <div className="row" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 20 }}>{t('📊 Library')}</h2>
        <div className="grow" />
        <button className="mini" onClick={() => setShowStats((v) => !v)}>{showStats ? t('Hide stats') : t('Show stats')}</button>
        <button className="mini" onClick={() => download(new Blob([toCsv(rows, ['album', 'group', 'n', 'title', 'type', 'status', 'ms', 'rating', 'fav', 'qc', 'takes', 'seed', 'genre', 'year', 'artist', 'url', 'prompt', 'notes'])], { type: 'text/csv' }), 'musicstudio-library.csv')} disabled={!rows.length}>{t('⤓ CSV')}</button>
        <button className="mini" onClick={() => download(new Blob([JSON.stringify(logbook(projects, groups), null, 2)], { type: 'application/json' }), `musicstudio-logbook-${new Date().toISOString().slice(0, 10)}.json`)} title={t('Everything about every track — prompts, plans, lyrics, seeds, models, quality, takes, files, ratings, notes')}>{t('⤓ Logbook')}</button>
        <button className="primary" onClick={() => player.playQueue(ready)} disabled={!ready.length}>{t('▶ Play')}{' '}{filtered ? 'filtered' : 'all'} ({ready.length})</button>
      </div>

      <div className="lib-filters">
        <input value={f.q} onChange={set('q')} placeholder={t('Search titles, albums, prompts, genres, links…')} style={{ flex: 3 }} />
        <select value={f.group} onChange={set('group')}><option value="">{t('All groups')}</option>{groupOpts.map((g) => <option key={g} value={g}>{g}</option>)}</select>
        <select value={f.type} onChange={set('type')}><option value="">{t('All types')}</option><option value="music">{t('Song')}</option><option value="dialog">{t('Dialog')}</option><option value="upload">{t('Upload')}</option><option value="sfx">{t('Sound effect')}</option></select>
        <select value={f.status} onChange={set('status')}><option value="">{t('Any status')}</option><option value="ready">{t('Ready')}</option><option value="gap">{t('Gap (to generate)')}</option><option value="empty">{t('Empty')}</option></select>
        <label className="row" style={{ margin: 0, whiteSpace: 'nowrap' }}><input type="checkbox" style={{ width: 'auto' }} checked={f.fav} onChange={set('fav')} />{' '}{t('★ only')}</label>
        <select value={f.minRating} onChange={set('minRating')} style={{ maxWidth: 130 }}><option value={0}>{t('Any rating')}</option>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{'★'.repeat(n)}{n < 5 ? t(' or more') : ''}</option>)}</select>
        {filtered && <button className="mini" onClick={() => setF(NOF)}>{t('Clear')}</button>}
      </div>

      {showStats && (
        <>
          <div className="cards">
            <div className="card"><div className="dim">{t('Albums')}</div><div className="big">{s.albums}</div></div>
            <div className="card"><div className="dim">{t('Songs ready')}</div><div className="big">{s.ready}<span className="dim" style={{ fontSize: 14 }}> / {s.tracks}</span></div></div>
            <div className="card"><div className="dim">{t('Listening time')}</div><div className="big">{fmtDuration(s.ms)}</div></div>
            <div className="card"><div className="dim">{t('Gaps')}</div><div className="big" style={{ color: s.gaps ? 'var(--warn)' : undefined }}>{s.gaps}</div><div className="dim" style={{ fontSize: 11 }}>{t('≈ {usd} to generate', { usd: fmtUsd(s.gapCost) })}</div></div>
            <div className="card"><div className="dim">{t('Favorites')}</div><div className="big">{s.favs}</div></div>
          </div>
          <div className="lib-breakdowns">
            {BREAKDOWNS.map(({ label, fn }) => {
              const b = breakdown(rows, fn).slice(0, 8); const max = Math.max(1, ...b.map((x) => x.ms || x.n));
              return (
                <div key={label} className="card">
                  <div className="dim" style={{ marginBottom: 6 }}>{label}</div>
                  <div className="days">
                    {b.map((x) => (
                      <div key={x.k} className="day" title={t('{ready}/{n} ready · {duration}', { ready: x.ready, n: x.n, duration: fmtDuration(x.ms) })}>
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


      {sel.size > 0 && (
        <div className="bulk-bar">
          <b>{t('{size} selected', { size: sel.size })}</b>
          <button className="mini" onClick={() => player.playQueue(chosen.filter((r) => r.status === 'ready').map((r) => r.track))}>{t('▶ Play')}</button>
          <button className="mini" onClick={() => player.enqueue(chosen.filter((r) => r.status === 'ready').map((r) => r.track))}>{t('＋♫ Queue')}</button>
          <button className="mini" disabled={!chosen.some((r) => r.status === 'gap')} onClick={() => onGenerate(byAlbum(chosen.filter((r) => r.status === 'gap')))}>{t('⚡ Generate gaps ({count})', { count: chosen.filter((r) => r.status === 'gap').length })}</button>
          <select value="" onChange={(e) => { if (e.target.value !== '') onRate(byAlbum(chosen), +e.target.value); }} style={{ width: 'auto' }}><option value="">{t('★ Rate…')}</option>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{'★'.repeat(n)}</option>)}<option value="0">{t('clear rating')}</option></select>
          {playlists.some((p) => p.kind === 'static') && <select value="" onChange={(e) => { if (e.target.value) onAddToPlaylist(chosen.map((r) => ({ projectId: r.albumId, trackId: r.id })), e.target.value); }} style={{ width: 'auto' }}><option value="">{t('＋ Playlist…')}</option>{playlists.filter((p) => p.kind === 'static').map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
          <div className="grow" />
          <button className="mini" onClick={() => setSel(new Set())}>{t('Clear selection')}</button>
        </div>
      )}
      <div className="lib-table">
        <table>
          <thead><tr>
            <th><input type="checkbox" style={{ width: 'auto' }} title={t('Select all shown')} checked={!!rows.length && rows.slice(0, MAX_ROWS).every((r) => sel.has(key(r)))} onChange={(e) => setSel(e.target.checked ? new Set(rows.slice(0, MAX_ROWS).map(key)) : new Set())} /></th>
            <th />
            {COLS.map((c) => <th key={c.key} onClick={() => by(c.key)} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>{c.label}{sort.key === c.key ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>)}
          </tr></thead>
          <tbody>
            {rows.slice(0, MAX_ROWS).map((r, i) => (
              <tr key={r.albumId + r.id} className={`${player.playing === r.id ? 'playing' : ''}${sel.has(key(r)) ? ' sel' : ''}`}>
                <td><input type="checkbox" style={{ width: 'auto' }} checked={sel.has(key(r))} onClick={(e) => pick(i, e)} onChange={() => {}} /></td>
                <td style={{ whiteSpace: 'nowrap' }}>{r.status === 'ready' && <button className="mini" onClick={() => player.enqueue([r.track])} title={t('Add to the end of the play queue')}>＋</button>}{r.status === 'ready' && <button className="mini" onClick={() => player.play(r.track, ready)}>{player.playing === r.id && !player.paused ? '⏸' : '▶'}</button>}</td>
                <td><Stars value={r.rating} onChange={(v) => onRate([{ projectId: r.albumId, trackIds: [r.id] }], v)} size={12} /></td>
                <td style={{ color: 'var(--bad)' }}>{r.fav ? '♥' : ''}</td>
                <td>{r.title || <span className="dim">{t('(untitled)')}</span>}</td>
                <td><a href="#" onClick={(e) => { e.preventDefault(); onOpenAlbum(r.albumId); }}>{r.album}</a></td>
                <td className="dim">{r.group}</td>
                <td className="dim">{r.n}</td>
                <td><span className={`badge ${r.type}`}>{r.type}</span></td>
                <td style={{ color: r.status === 'gap' ? 'var(--warn)' : r.status === 'ready' ? 'var(--good)' : 'var(--dim)' }}>{r.status}</td>
                <td className="dim">{r.ms ? fmtDuration(r.ms) : ''}</td>
                <td>{r.qc && <span className="badge" style={{ color: r.qc === 'A' || r.qc === 'B' ? 'var(--good)' : r.qc === 'C' ? 'var(--warn)' : 'var(--bad)' }}>{r.qc}</span>}</td>
                <td className="dim">{r.takes > 1 ? r.takes : ''}</td>
                <td>{r.genre}</td>
                <td>{r.year}</td>
                <td>{r.url && <a href={r.url} target="_blank" rel="noopener noreferrer" title={r.url}>↗</a>}</td>
                <td className="lib-prompt" title={r.prompt}>{r.prompt}</td>
                <td className="lib-prompt" title={r.notes}>{r.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <div className="empty">{all.length ? t('Nothing matches these filters.') : t('No tracks in the library yet.')}</div>}
        {rows.length > MAX_ROWS && <p className="note">{t('Showing the first {MAX_ROWS} of {count} — narrow the filter to see the rest (CSV has them all).', { MAX_ROWS: MAX_ROWS, count: rows.length })}</p>}
      </div>
    </div>
  );
}
