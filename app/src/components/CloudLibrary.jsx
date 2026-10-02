import { safeUrl } from '../album/library.js';
import { useEffect, useMemo, useState } from 'react';
import { fmtDuration } from '../state/pricing.js';
import { pendingChanges, initialWant } from '../cloud/catalog.js';

// The phone's view of the desktop master's library: browse every album, its description, metadata
// and tracklist (with prompts), and tick which albums should live on the device. Saving writes a
// request file to Drive; the desktop applies it the next time it's running and picks it up.
export default function CloudLibrary({ catalog, requests, busy, onSave, onRefresh, isDesktop }) {
  const [want, setWant] = useState(() => initialWant(catalog, requests));
  const [open, setOpen] = useState(null);
  const [q, setQ] = useState('');
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setWant(initialWant(catalog, requests)); setDirty(false); }, [catalog, requests]);

  const albums = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (catalog?.albums || []).filter((a) => !needle
      || a.title.toLowerCase().includes(needle) || a.path.toLowerCase().includes(needle)
      || (a.description || '').toLowerCase().includes(needle)
      || a.tracks.some((t) => (t.title || '').toLowerCase().includes(needle)));
  }, [catalog, q]);

  const toggle = (id) => { setWant((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); setDirty(true); };
  const pending = pendingChanges(catalog, want);
  const wantedMs = (catalog?.albums || []).filter((a) => want.has(a.id)).reduce((s, a) => s + a.ms, 0);
  const stamp = catalog?.updatedAt ? new Date(catalog.updatedAt).toLocaleString() : '—';

  if (!catalog) {
    return <div className="empty" style={{ marginTop: 40 }}>
      No library published to Drive yet.<br />
      <span className="dim">On your desktop, connect Drive in Settings and press ☁ Push library.</span>
      <div style={{ marginTop: 12 }}><button onClick={onRefresh} disabled={!!busy}>{busy || '⟳ Check again'}</button></div>
    </div>;
  }

  return (
    <>
      <div className="head">
        <h2>☁ {catalog.device || 'Desktop'} library</h2>
        <p className="note">{catalog.albums.length} albums · published {stamp}{catalog.publishName ? ` · device folder: ${catalog.publishName}` : ''}</p>
      </div>

      <div className="row" style={{ marginBottom: 8 }}>
        <input placeholder="Search albums, tracks, descriptions…" value={q} onChange={(e) => setQ(e.target.value)} className="grow" />
        <button className="mini" onClick={onRefresh} disabled={!!busy}>⟳</button>
      </div>

      <div className="row" style={{ marginBottom: 8 }}>
        <span className="grow note" style={{ margin: 0 }}>
          {want.size} album{want.size === 1 ? '' : 's'} wanted · {fmtDuration(wantedMs)}
          {pending.length ? ` · ${pending.length} change${pending.length === 1 ? '' : 's'} pending` : ' · in sync'}
        </span>
        <button className="primary" onClick={() => onSave(want)} disabled={!!busy || !dirty}>{busy || (dirty ? '☁ Save sync request' : 'Saved')}</button>
      </div>
      {!!pending.length && (
        <p className="note" style={{ color: 'var(--warn)' }}>
          ⏳ {isDesktop ? 'Press 📱 Sync to apply now.' : 'Your desktop will apply these the next time it runs Music Studio.'}
          {pending.some((c) => c.action === 'blocked') && ' Some wanted albums have no audio generated yet.'}
        </p>
      )}

      <div className="tracks">
        {albums.map((a) => {
          const ch = pending.find((c) => c.id === a.id);
          return (
            <div className="track" key={a.id}>
              <div className="track-head">
                <input type="checkbox" style={{ width: 'auto' }} checked={want.has(a.id)} onChange={() => toggle(a.id)} disabled={!a.readyCount && !want.has(a.id)} />
                <button className="mini" onClick={() => setOpen(open === a.id ? null : a.id)} title="Show description and tracks">{open === a.id ? '▾' : '▸'}</button>
                <div className="grow">
                  <b>{a.title}</b>
                  <div className="dim" style={{ fontSize: 12 }}>{a.path}</div>
                </div>
                <span className="dim" style={{ fontSize: 12 }}>
                  {a.readyCount}/{a.trackCount} · {fmtDuration(a.ms)}
                </span>
                {ch
                  ? <span style={{ fontSize: 12, color: 'var(--warn)' }}>{ch.action === 'add' ? '⏳ will add' : ch.action === 'remove' ? '⏳ will remove' : '⚠ no audio'}</span>
                  : a.onDevice ? <span style={{ fontSize: 12, color: 'var(--good)' }}>✓ on device</span> : null}
              </div>
              {open === a.id && (
                <div style={{ padding: '4px 0 8px 28px' }}>
                  {a.description && <p className="note" style={{ whiteSpace: 'pre-wrap' }}>{a.description}</p>}
                  {!!Object.keys(a.meta || {}).length && (
                    <p className="note dim">{Object.entries(a.meta).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(' · ')}</p>
                  )}
                  <ol style={{ margin: '6px 0', paddingLeft: 22, fontSize: 13 }}>
                    {a.tracks.map((t, i) => (
                      <li key={i} style={{ marginBottom: 4, opacity: t.ready ? 1 : 0.55 }}>
                        {t.fav ? '★ ' : ''}{t.title || <span className="dim">untitled</span>}
                        {t.ms ? <span className="dim"> · {fmtDuration(t.ms)}</span> : null}
                        {!t.ready && <span className="dim"> · not generated</span>}
                        {safeUrl(t.url) && <> · <a href={safeUrl(t.url)} target="_blank" rel="noopener noreferrer">song page ↗</a></>}
                        {t.prompt && <div className="dim" style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{t.prompt}</div>}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
