import { useMemo, useState } from 'react';
import Dialog from './Dialog.jsx';
import { albumFolderPath } from '../album/skeleton.js';
import { fmtDuration } from '../state/pricing.js';

// Choose which albums live on the device (the publish folder a phone syncs). Apply reconciles
// the folder: selected albums are (re)published, deselected app-published folders are removed.
export default function DeviceSync({ projects, groups, syncMap, deviceName, busy, onApply, onClose }) {
  const [sel, setSel] = useState(() => new Set(Object.keys(syncMap || {}).filter((id) => syncMap[id]?.on)));
  const rows = useMemo(() => (projects || [])
    .map((p) => ({
      p,
      path: albumFolderPath(p, groups || []),
      ready: (p.tracks || []).filter((t) => t.clipId).length,
      ms: (p.tracks || []).reduce((s, t) => s + (t.clipId ? (t.durationMs || 0) : 0), 0),
    }))
    .sort((a, b) => a.path.localeCompare(b.path)), [projects, groups]);
  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selRows = rows.filter((r) => sel.has(r.p.id));
  const totalMs = selRows.reduce((s, r) => s + r.ms, 0);

  return (
    <Dialog title={`Device sync — ${deviceName}`} onClose={onClose} width={640}
      footer={<><button onClick={onClose}>Close</button>
        <button className="mini" onClick={() => setSel(new Set(rows.filter((r) => r.ready).map((r) => r.p.id)))}>All</button>
        <button className="mini" onClick={() => setSel(new Set())}>None</button>
        <button className="primary" onClick={() => onApply(sel)} disabled={!!busy}>{busy || 'Apply & sync'}</button></>}>
      <p className="note">Ticked albums are kept on the device as tagged tracks + playlist; unticking removes them from the device on Apply (the library copy is untouched). Only app-published folders (with an .m3u) are ever removed.</p>
      <div style={{ maxHeight: 380, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 6, padding: '4px 8px' }}>
        {rows.map((r) => (
          <label key={r.p.id} className="row" style={{ padding: '3px 0', margin: 0, alignItems: 'center', opacity: r.ready ? 1 : 0.5 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={sel.has(r.p.id)} onChange={() => toggle(r.p.id)} disabled={!r.ready} />
            <span className="grow" style={{ fontSize: 13 }}>{r.path}</span>
            <span className="dim" style={{ fontSize: 12 }}>{r.ready ? `${r.ready} trk · ${fmtDuration(r.ms)}` : 'no audio'}</span>
          </label>
        ))}
      </div>
      <p className="note">{selRows.length} album{selRows.length === 1 ? '' : 's'} selected · {fmtDuration(totalMs)} of audio</p>
    </Dialog>
  );
}
