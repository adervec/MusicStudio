import { useMemo, useState } from 'react';
import Dialog from './Dialog.jsx';
import { uid } from '../state/db.js';
import { groupFolderPath } from '../album/skeleton.js';
import { planRearrange, descendantIds, ALBUM_FIELDS, albumField } from '../album/library.js';

// Bulk-rearrange the group tree (and the folders on disk): tick groups/albums, then either move them
// all under one path, or sort the ticked albums into sub-groups by a field (genre, year, …).
// Nothing happens until Apply; the preview shows every folder move first.
export default function Reorganize({ groups, projects, busy, onApply, onClose }) {
  const [mode, setMode] = useState('move');
  const [sel, setSel] = useState(new Set()); // 'g:<id>' | 'a:<id>'
  const [q, setQ] = useState('');
  const [dest, setDest] = useState('');
  const [field, setField] = useState('genre');
  const [base, setBase] = useState('');
  const [prune, setPrune] = useState(true);

  // Depth-first tree: groups (by name) then their albums (by title).
  const tree = useMemo(() => {
    const out = [];
    const walk = (parentId, depth) => {
      for (const g of groups.filter((x) => (x.parentId || null) === parentId).sort((a, b) => a.name.localeCompare(b.name))) {
        out.push({ key: 'g:' + g.id, kind: 'group', id: g.id, label: g.name, depth, parentId }); walk(g.id, depth + 1);
      }
      for (const p of projects.filter((x) => (x.parentId || null) === parentId).sort((a, b) => (a.title || '').localeCompare(b.title || ''))) {
        out.push({ key: 'a:' + p.id, kind: 'album', id: p.id, label: p.title || 'Untitled', depth, parentId, p });
      }
    };
    walk(null, 0);
    return out;
  }, [groups, projects]);
  const paths = useMemo(() => groups.map((g) => groupFolderPath(g, groups)).sort(), [groups]);
  const ql = q.trim().toLowerCase();
  const shown = ql ? tree.filter((r) => r.label.toLowerCase().includes(ql)) : tree;

  // Ticked groups carry their contents, so anything under a ticked group isn't moved separately.
  const plan = useMemo(() => {
    const selGroups = tree.filter((r) => r.kind === 'group' && sel.has(r.key)).map((r) => r.id);
    const under = new Set(selGroups.flatMap((id) => [...descendantIds(id, groups)]));
    let items;
    if (mode === 'move') {
      items = tree.filter((r) => sel.has(r.key) && !under.has(r.parentId)).map((r) => ({ kind: r.kind, id: r.id, dest }));
    } else {
      items = tree.filter((r) => r.kind === 'album' && (sel.has(r.key) || under.has(r.parentId)))
        .map((r) => ({ kind: 'album', id: r.id, dest: [base, albumField(r.p, field) || 'Unknown'].filter(Boolean).join('/') }));
    }
    return { ...planRearrange(items, groups, projects, () => uid('g_')), count: items.length };
  }, [tree, sel, mode, dest, field, base, groups, projects]);

  const toggle = (k) => setSel((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const labelOf = (id) => tree.find((r) => r.id === id)?.label || id;

  return (
    <Dialog title="🗂 Reorganize library" onClose={onClose} width={760}
      footer={<><button onClick={onClose}>Close</button>
        <label className="row" style={{ margin: 0, marginRight: 'auto' }}><input type="checkbox" style={{ width: 'auto' }} checked={prune} onChange={(e) => setPrune(e.target.checked)} /> Remove groups this leaves empty</label>
        <button className="primary" disabled={!!busy || !plan.moves.length} onClick={() => onApply(plan, prune)}>{busy || `Apply ${plan.moves.length} move${plan.moves.length === 1 ? '' : 's'}`}</button></>}>
      <div className="row" style={{ marginBottom: 8 }}>
        <button className={mode === 'move' ? 'primary' : ''} onClick={() => setMode('move')}>Move to a group</button>
        <button className={mode === 'groupby' ? 'primary' : ''} onClick={() => setMode('groupby')}>Sort into groups by field</button>
      </div>
      <datalist id="group-paths">{paths.map((p) => <option key={p} value={p} />)}</datalist>
      {mode === 'move' ? (
        <>
          <label>Destination group — pick one or type a new path (“Archive/2026” creates both); empty = top level</label>
          <input list="group-paths" value={dest} onChange={(e) => setDest(e.target.value)} placeholder="e.g. Darksynth Albums/Cycle 5" />
        </>
      ) : (
        <div className="row">
          <div className="grow"><label>Field</label>
            <select value={field} onChange={(e) => setField(e.target.value)}>{ALBUM_FIELDS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select></div>
          <div style={{ flex: 2 }}><label>Under (optional) — e.g. “By genre”</label>
            <input list="group-paths" value={base} onChange={(e) => setBase(e.target.value)} placeholder="top level" /></div>
        </div>
      )}

      <div className="row" style={{ marginTop: 10 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter the tree…" className="grow" />
        <button className="mini" onClick={() => setSel(new Set(shown.filter((r) => mode === 'move' || r.kind === 'album').map((r) => r.key)))}>All</button>
        <button className="mini" onClick={() => setSel(new Set())}>None</button>
      </div>
      <div className="wiz-list" style={{ maxHeight: 240 }}>
        {shown.map((r) => (
          <label key={r.key} className="row" style={{ margin: 0, padding: '2px 0', paddingLeft: ql ? 0 : r.depth * 16 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={sel.has(r.key)} onChange={() => toggle(r.key)} />
            <span style={{ fontSize: 13, fontWeight: r.kind === 'group' ? 600 : 400 }}>{r.kind === 'group' ? '📁' : '🎵'} {r.label}</span>
          </label>
        ))}
      </div>

      <label>Preview — {plan.moves.length} folder move{plan.moves.length === 1 ? '' : 's'}{plan.created.length ? `, ${plan.created.length} new group${plan.created.length === 1 ? '' : 's'}` : ''}{plan.count > plan.moves.length + plan.blocked.length ? ` (${plan.count - plan.moves.length - plan.blocked.length} already in place)` : ''}</label>
      <div className="wiz-list" style={{ maxHeight: 180, fontSize: 12 }}>
        {!plan.moves.length && !plan.blocked.length && <div className="dim">Tick something and choose where it goes.</div>}
        {plan.moves.map((m) => <div key={m.id}>{m.kind === 'group' ? '📁' : '🎵'} <span className="dim">{m.from}</span> → <b>{m.to}</b></div>)}
        {plan.blocked.map((b) => <div key={b.id} style={{ color: 'var(--bad)' }}>✕ {labelOf(b.id)} — {b.why}</div>)}
      </div>
    </Dialog>
  );
}
