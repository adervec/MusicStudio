import { useState } from 'react';
import { fmtDuration } from '../state/pricing.js';
import { isGap, duplicateIds } from '../album/skeleton.js';
import { t } from '../i18n.js';

// Nested group tree: groups can contain sub-groups and albums, arbitrarily deep. Flat data
// (groups/projects carry parentId); rendered recursively. `onMove` reparents; group moves are
// blocked from landing inside their own descendants (no cycles).
export default function Sidebar({ groups, projects, playlists, activeId, activeGroupId, activePlaylistId, expanded, onToggle, onOpen, onSelectGroup, onSelectPlaylist, onNewPlaylist, onNewAlbum, onNewGroup, onDeleteAlbum, onDeleteGroup, onMove, onRenameGroup, onCopyAlbumPath, onCopyGroupPath }) {
  const [q, setQ] = useState('');
  const [gapFilter, setGapFilter] = useState('all'); // 'all' | 'gaps' | 'complete'
  const ql = q.trim().toLowerCase();
  const albumGaps = (a) => (a.tracks || []).filter(isGap).length;
  const albumMatches = (a) => gapFilter === 'all' || (gapFilter === 'gaps' ? albumGaps(a) > 0 : albumGaps(a) === 0);
  const matches = ql ? projects.filter((p) => (p.title || '').toLowerCase().includes(ql) && albumMatches(p)) : null;
  const rootGroups = groups.filter((g) => !g.parentId);
  const rootAlbums = projects.filter((p) => !p.parentId && albumMatches(p));

  function descendants(id) {
    const out = new Set(); const stack = [id];
    while (stack.length) { const cur = stack.pop(); for (const g of groups) if (g.parentId === cur && !out.has(g.id)) { out.add(g.id); stack.push(g.id); } }
    return out;
  }
  function groupGaps(gid) {
    let n = 0;
    for (const a of projects) if (a.parentId === gid) n += albumGaps(a);
    for (const g of groups) if (g.parentId === gid) n += groupGaps(g.id);
    return n;
  }

  function MoveSelect({ kind, id, parentId }) {
    const banned = kind === 'group' ? descendants(id).add(id) : new Set();
    return (
      <select className="move" value={parentId || ''} onClick={(e) => e.stopPropagation()} onChange={(e) => onMove(kind, id, e.target.value || null)} title={t('Move to group')}>
        {kind === 'group' && <option value="">{t('⌂ root')}</option>}
        {kind === 'album' && !parentId && <option value="">{t('— pick a group —')}</option>}
        {groups.filter((g) => !banned.has(g.id)).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>
    );
  }

  function Album({ a, depth }) {
    const dur = (a.tracks || []).reduce((s, tk) => s + (tk.clipId ? tk.durationMs || 0 : 0), 0);
    const g = albumGaps(a); const d = duplicateIds(a.tracks).size;
    return (
      <div className={`proj ${activeId === a.id ? 'active' : ''}`} style={{ marginLeft: depth * 14 }} onClick={() => onOpen(a.id)}>
        <div className="row">
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="t" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>🎵 {a.title || t('Untitled')}</div>
            <div className="m">{t('{count} tr · {duration}', { count: (a.tracks || []).length, duration: fmtDuration(dur) })}{g > 0 && <span style={{ color: 'var(--warn)' }}>{' '}{t.n('· {n} gap', '· {n} gaps', g)}</span>}
              {d > 0 && <span style={{ color: 'var(--warn)' }} title={t('{d} duplicate track(s)', { d: d })}> · ⚠{d}</span>}
            </div>
          </div>
          <MoveSelect kind="album" id={a.id} parentId={a.parentId} />
          <button className="mini" onClick={(e) => { e.stopPropagation(); onCopyAlbumPath(a); }} title={t('Open folder in Explorer (or copy path)')}>📂</button>
          <button className="mini danger" onClick={(e) => { e.stopPropagation(); onDeleteAlbum(a); }}>🗑</button>
        </div>
      </div>
    );
  }

  function Group({ g, depth }) {
    const open = expanded.has(g.id);
    const subs = groups.filter((x) => x.parentId === g.id);
    const albums = projects.filter((x) => x.parentId === g.id && albumMatches(x));
    return (
      <div>
        <div className="grp-row" style={{ marginLeft: depth * 14 }}>
          <span onClick={() => onToggle(g.id)} style={{ cursor: 'pointer' }} title={open ? t('Collapse') : t('Expand')}>{open ? '▾' : '▸'}</span>
          <span className="grow" onClick={() => onSelectGroup(g)} title={t('View group contents')} style={{ cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: activeGroupId === g.id ? 'var(--accent)' : undefined }}> 📁 {g.name}{groupGaps(g.id) > 0 && <span style={{ color: 'var(--warn)', fontWeight: 400 }}> · {groupGaps(g.id)}⚡</span>}</span>
          <button className="mini" title={t('New album in group')} onClick={() => onNewAlbum(g.id)}>＋♪</button>
          <button className="mini" title={t('New sub-group')} onClick={() => onNewGroup(g.id)}>＋📁</button>
          <MoveSelect kind="group" id={g.id} parentId={g.parentId} />
          <button className="mini" title={t('Open folder in Explorer (or copy path)')} onClick={() => onCopyGroupPath(g)}>📂</button>
          <button className="mini" title={t('Rename')} onClick={() => onRenameGroup(g)}>✎</button>
          <button className="mini danger" title={t('Delete group (albums move up)')} onClick={() => onDeleteGroup(g)}>🗑</button>
        </div>
        {open && <>{subs.map((s) => <Group key={s.id} g={s} depth={depth + 1} />)}{albums.map((a) => <Album key={a.id} a={a} depth={depth + 1} />)}</>}
      </div>
    );
  }

  return (
    <div>
      <div className="row" style={{ marginBottom: 8 }}>
        <button className="primary grow" onClick={() => onNewGroup(null)}>{t('＋ Group')}</button>
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search albums…')} style={{ marginBottom: 6 }} />
      <select value={gapFilter} onChange={(e) => setGapFilter(e.target.value)} style={{ marginBottom: 10 }} title={t('Filter albums by generation status')}>
        <option value="all">{t('All albums')}</option>
        <option value="gaps">{t('Only with gaps')}</option>
        <option value="complete">{t('Only complete (no gaps)')}</option>
      </select>
      {matches ? (
        matches.length ? matches.map((a) => <Album key={a.id} a={a} depth={0} />) : <p className="note">{t('No albums match “{q}”.', { q: q })}</p>
      ) : <>
        {!groups.length && <p className="note">{t('Create a group first — every album lives in a group. Then use the group\'s ＋♪ to add albums.')}</p>}
        {rootGroups.map((g) => <Group key={g.id} g={g} depth={0} />)}
        {rootAlbums.map((a) => <Album key={a.id} a={a} depth={0} />)}
      </>}

      <div className="row" style={{ marginTop: 16, marginBottom: 6 }}>
        <div className="section grow" style={{ margin: 0, border: 'none', paddingBottom: 0 }}>{t('Playlists')}</div>
        <button className="mini" onClick={onNewPlaylist} title={t('New playlist')}>＋</button>
      </div>
      {!(playlists || []).length && <p className="note">{t('None yet.')}</p>}
      {(playlists || []).map((pl) => (
        <div key={pl.id} className={`proj ${activePlaylistId === pl.id ? 'active' : ''}`} onClick={() => onSelectPlaylist(pl)}>
          <div className="t" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>▤ {pl.name}</div>
          <div className="m">{pl.kind === 'static' ? `${(pl.items || []).length} song${(pl.items || []).length === 1 ? '' : 's'}` : 'dynamic'}</div>
        </div>
      ))}
    </div>
  );
}
