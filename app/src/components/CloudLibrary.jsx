import { safeUrl } from '../album/library.js';
import { useEffect, useMemo, useState } from 'react';
import { fmtDuration } from '../state/pricing.js';
import { pendingChanges, initialWant } from '../cloud/catalog.js';
import { t, fmtDateTime } from '../i18n.js';

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
      || a.tracks.some((tk) => (tk.title || '').toLowerCase().includes(needle)));
  }, [catalog, q]);

  const toggle = (id) => { setWant((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); setDirty(true); };
  const pending = pendingChanges(catalog, want);
  const wantedMs = (catalog?.albums || []).filter((a) => want.has(a.id)).reduce((s, a) => s + a.ms, 0);
  const stamp = catalog?.updatedAt ? fmtDateTime(catalog.updatedAt) : '—';

  if (!catalog) {
    return <div className="empty" style={{ marginTop: 40 }}>{t('No library published to Drive yet.')}<br />
      <span className="dim">{t('On your desktop, connect Drive in Settings and press ☁ Push library.')}</span>
      <div style={{ marginTop: 12 }}><button onClick={onRefresh} disabled={!!busy}>{busy || t('⟳ Check again')}</button></div>
    </div>;
  }

  return (
    <>
      <div className="head">
        <h2>☁ {catalog.device || t('Desktop')}{' '}{t('library')}</h2>
        <p className="note">{t('{count} albums · published {stamp}', { count: catalog.albums.length, stamp: stamp })}{catalog.publishName ? t(' · device folder: {publishName}', { publishName: catalog.publishName }) : ''}</p>
      </div>

      <div className="row" style={{ marginBottom: 8 }}>
        <input placeholder={t('Search albums, tracks, descriptions…')} value={q} onChange={(e) => setQ(e.target.value)} className="grow" />
        <button className="mini" onClick={onRefresh} disabled={!!busy}>⟳</button>
      </div>

      <div className="row" style={{ marginBottom: 8 }}>
        <span className="grow note" style={{ margin: 0 }}>{t.n('{n} album', '{n} albums', want.size)}{' '}{t('wanted · {duration}', { duration: fmtDuration(wantedMs) })}{pending.length ? t.n(' · {n} change pending', ' · {n} changes pending', pending.length) : t(' · in sync')}
        </span>
        <button className="primary" onClick={() => onSave(want)} disabled={!!busy || !dirty}>{busy || (dirty ? t('☁ Save sync request') : t('Saved'))}</button>
      </div>
      {!!pending.length && (
        <p className="note" style={{ color: 'var(--warn)' }}>
          ⏳ {isDesktop ? t('Press 📱 Sync to apply now.') : t('Your desktop will apply these the next time it runs Music Studio.')}
          {pending.some((c) => c.action === 'blocked') && t(' Some wanted albums have no audio generated yet.')}
        </p>
      )}

      <div className="tracks">
        {albums.map((a) => {
          const ch = pending.find((c) => c.id === a.id);
          return (
            <div className="track" key={a.id}>
              <div className="track-head">
                <input type="checkbox" style={{ width: 'auto' }} checked={want.has(a.id)} onChange={() => toggle(a.id)} disabled={!a.readyCount && !want.has(a.id)} />
                <button className="mini" onClick={() => setOpen(open === a.id ? null : a.id)} title={t('Show description and tracks')}>{open === a.id ? '▾' : '▸'}</button>
                <div className="grow">
                  <b>{a.title}</b>
                  <div className="dim" style={{ fontSize: 12 }}>{a.path}</div>
                </div>
                <span className="dim" style={{ fontSize: 12 }}>
                  {a.readyCount}/{a.trackCount} · {fmtDuration(a.ms)}
                </span>
                {ch
                  ? <span style={{ fontSize: 12, color: 'var(--warn)' }}>{ch.action === 'add' ? t('⏳ will add') : ch.action === 'remove' ? t('⏳ will remove') : t('⚠ no audio')}</span>
                  : a.onDevice ? <span style={{ fontSize: 12, color: 'var(--good)' }}>{t('✓ on device')}</span> : null}
              </div>
              {open === a.id && (
                <div style={{ padding: '4px 0 8px 28px' }}>
                  {a.description && <p className="note" style={{ whiteSpace: 'pre-wrap' }}>{a.description}</p>}
                  {!!Object.keys(a.meta || {}).length && (
                    <p className="note dim">{Object.entries(a.meta).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(' · ')}</p>
                  )}
                  <ol style={{ margin: '6px 0', paddingLeft: 22, fontSize: 13 }}>
                    {a.tracks.map((tk, i) => (
                      <li key={i} style={{ marginBottom: 4, opacity: tk.ready ? 1 : 0.55 }}>
                        {tk.fav ? '★ ' : ''}{tk.title || <span className="dim">{t('untitled')}</span>}
                        {tk.ms ? <span className="dim"> · {fmtDuration(tk.ms)}</span> : null}
                        {!tk.ready && <span className="dim">{' '}{t('· not generated')}</span>}
                        {safeUrl(tk.url) && <> · <a href={safeUrl(tk.url)} target="_blank" rel="noopener noreferrer">{t('song page ↗')}</a></>}
                        {tk.prompt && <div className="dim" style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{tk.prompt}</div>}
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
