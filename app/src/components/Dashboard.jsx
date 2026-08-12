import { useEffect, useMemo, useState } from 'react';
import Dialog from './Dialog.jsx';
import { getUsage, clearUsage, getSetting, setSetting } from '../state/db.js';
import { summarizeUsage, fmtUsd, fmtDuration } from '../state/pricing.js';
import { download } from '../backup/fs.js';

const fmtWhen = (ts) => new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

// Estimated spend through your own ElevenLabs key — music minutes + dialog characters — with a
// per-day trend, per-model table, and per-call log. Mirrors Tachyread's spend dashboard.
export default function Dashboard({ onClose }) {
  const [entries, setEntries] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [budget, setBudget] = useState(0);
  useEffect(() => { getUsage().then(setEntries).catch(() => setEntries([])); getSetting('spendBudget', 0).then(setBudget); }, []);
  const monthKey = new Date().toISOString().slice(0, 7);
  const monthSpend = useMemo(() => (entries || []).filter((e) => new Date(e.ts).toISOString().slice(0, 7) === monthKey).reduce((s, e) => s + (e.costUsd || 0), 0), [entries, monthKey]);
  async function saveBudget(v) { setBudget(v); await setSetting('spendBudget', v); }
  function exportCsv() {
    const rows = [['timestamp', 'kind', 'model', 'source', 'ms', 'chars', 'costUsd']];
    for (const e of entries || []) rows.push([new Date(e.ts).toISOString(), e.kind || '', e.model || '', e.source || '', e.ms || 0, e.chars || 0, (e.costUsd || 0).toFixed(6)]);
    download(new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' }), 'musicstudio-usage.csv');
  }

  const s = useMemo(() => (entries ? summarizeUsage(entries) : null), [entries]);
  const days = useMemo(() => (s ? Object.entries(s.byDay).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 14) : []), [s]);
  const maxDay = useMemo(() => days.reduce((m, [, d]) => Math.max(m, d.cost), 0) || 1, [days]);
  const recent = useMemo(() => (entries ? [...entries].reverse().slice(0, 60) : []), [entries]);

  async function clear() { await clearUsage(); setEntries([]); setConfirm(false); }

  return (
    <Dialog title="API usage & spend" onClose={onClose} width={720}
      footer={confirm
        ? <><button className="danger" onClick={clear}>Confirm — clear history</button><button onClick={() => setConfirm(false)}>Cancel</button></>
        : <><button onClick={() => setConfirm(true)}>🗑 Clear history</button><button className="primary" onClick={onClose}>Close</button></>}>
      {!s ? <p className="note">Loading…</p> : s.calls === 0 ? (
        <p className="note">No API calls yet. Generating songs and dialog with your key logs estimated spend here.</p>
      ) : (
        <>
          <div className="cards">
            <div className="card"><div className="h">Total (estimated)</div><div className="big">{fmtUsd(s.total)}</div><div className="dim">{s.calls} call{s.calls === 1 ? '' : 's'}</div></div>
            <div className="card"><div className="h">🎵 Music</div><div className="big">{fmtUsd(s.music.cost)}</div><div className="dim">{fmtDuration(s.music.ms)} · {s.music.calls} gen</div></div>
            <div className="card"><div className="h">🗣 Dialog</div><div className="big">{fmtUsd(s.tts.cost)}</div><div className="dim">{s.tts.chars.toLocaleString()} chars · {s.tts.calls} clip{s.tts.calls === 1 ? '' : 's'}</div></div>
          </div>
          <p className="note">Rough estimates from public list prices (music ≈ $0.15/min) — real billing depends on your plan. Logged locally only.</p>

          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <label style={{ margin: 0 }}>Monthly budget $</label>
            <input type="number" min="0" step="1" value={budget} onChange={(e) => saveBudget(+e.target.value)} style={{ width: 90 }} />
            {budget > 0 && <span style={{ fontSize: 12, color: monthSpend > budget ? 'var(--bad)' : 'var(--dim)' }}>{fmtUsd(monthSpend)} / {fmtUsd(budget)} this month{monthSpend > budget ? ' — over budget!' : ''}</span>}
            <div className="grow" />
            <button className="mini" onClick={exportCsv}>⤓ Export CSV</button>
          </div>
          {budget > 0 && <div className="day" style={{ gridTemplateColumns: '1fr', marginTop: 6 }}><div className="bar"><div style={{ width: `${Math.min(100, (monthSpend / budget) * 100)}%`, background: monthSpend > budget ? 'var(--bad)' : 'var(--accent)' }} /></div></div>}

          {days.length > 0 && <>
            <div className="section">By day</div>
            <div className="days">{days.map(([day, d]) => (
              <div key={day} className="day"><span>{day}</span><div className="bar"><div style={{ width: `${(d.cost / maxDay) * 100}%` }} /></div><span className="cost">{fmtUsd(d.cost)}</span></div>
            ))}</div>
          </>}

          <div className="section">By model</div>
          <table>
            <thead><tr><th>Model</th><th>Calls</th><th>Amount</th><th style={{ textAlign: 'right' }}>Est.</th></tr></thead>
            <tbody>{Object.entries(s.byModel).sort((a, b) => b[1].cost - a[1].cost).map(([model, m]) => (
              <tr key={model}><td>{model}</td><td>{m.calls}</td><td>{m.kind === 'tts' ? `${m.chars.toLocaleString()} chars` : fmtDuration(m.ms)}</td><td style={{ textAlign: 'right' }}>{fmtUsd(m.cost)}</td></tr>
            ))}</tbody>
          </table>

          <div className="section">Recent calls</div>
          <div className="log">{recent.map((e, i) => (
            <div key={i} className="log-row">
              <span className="dim">{fmtWhen(e.ts)}</span>
              <span>{e.kind === 'tts' ? '🗣 Dialog' : '🎵 Music'} · {e.model}</span>
              <span className="dim">{e.kind === 'tts' ? `${(e.chars || 0).toLocaleString()} ch` : fmtDuration(e.ms)}</span>
              <span style={{ textAlign: 'right' }}>{fmtUsd(e.costUsd || 0)}</span>
            </div>
          ))}</div>
        </>
      )}
    </Dialog>
  );
}
