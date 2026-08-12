import { useEffect, useMemo, useState } from 'react';
import Dialog from './Dialog.jsx';

// Scan the backup folder for groups/albums created on disk (e.g. by a separate Claude Code session)
// and import them. Root-level folders that aren't albums (e.g. Inputs, Music) can be toggled to be
// ignored. onScan() → { albums, rootFolders }; onApply(ignoredArray) persists ignores + imports.
export default function Import({ onScan, ignored, onApply, onClose }) {
  const [scan, setScan] = useState(null);
  const [err, setErr] = useState('');
  const [ign, setIgn] = useState(new Set(ignored));
  const [busy, setBusy] = useState(false);

  useEffect(() => { onScan().then(setScan).catch((e) => setErr(e.message || String(e))); }, []); // eslint-disable-line

  const topOf = (a) => (a.groupPath[0] || a.folderName); // the root folder an album lives under
  const importable = useMemo(() => (scan ? scan.albums.filter((a) => !ign.has(topOf(a))) : []), [scan, ign]);

  function toggle(name) { setIgn((s) => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n; }); }
  async function apply() { setBusy(true); await onApply([...ign]); setBusy(false); onClose(); }

  return (
    <Dialog title="Import from folder" onClose={onClose} width={560}
      footer={<><button onClick={onClose}>Cancel</button><button className="primary" onClick={apply} disabled={!scan || busy}>{busy ? 'Importing…' : `Import (${importable.length})`}</button></>}>
      <p className="note">Groups and albums found in the backup folder are synced into the app. An album is any folder containing an <code>album.json</code>; its parent folders become groups. Tick a root folder to <b>ignore</b> it (e.g. folders that aren't albums).</p>
      {err && <p className="note" style={{ color: 'var(--bad)' }}>Scan failed: {err}</p>}
      {!scan && !err && <p className="note">Scanning…</p>}
      {scan && (
        <>
          <div className="section">Root folders</div>
          {!scan.rootFolders.length && <p className="note">No folders at the backup root yet.</p>}
          {scan.rootFolders.map((name) => {
            const count = scan.albums.filter((a) => (a.groupPath[0] || a.folderName) === name).length;
            return (
              <label key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0' }}>
                <input type="checkbox" checked={ign.has(name)} onChange={() => toggle(name)} style={{ width: 'auto' }} />
                <span className="grow">📁 {name}</span>
                <span className="dim" style={{ fontSize: 12 }}>{ign.has(name) ? 'ignored' : `${count} album${count === 1 ? '' : 's'}`}</span>
              </label>
            );
          })}
          <p className="note" style={{ marginTop: 10 }}><b>{importable.length}</b> album{importable.length === 1 ? '' : 's'} across {new Set(importable.map((a) => a.groupPath.join('/'))).size} group path(s) will be synced. Existing albums are matched and left as-is; new ones are added.</p>
        </>
      )}
    </Dialog>
  );
}
