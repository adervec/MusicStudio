import { useState } from 'react';

// 1–5 stars; clicking the current value clears it. `calc` (from the parts underneath) shows beside it.
export function Stars({ value = 0, onChange, calc = null, n = 0, size = 14 }) {
  const [hover, setHover] = useState(0);
  const v = hover || value || 0;
  return (
    <span className="stars" onMouseLeave={() => setHover(0)} title={value ? `Your rating: ${value}★ (click again to clear)` : 'Rate'}>
      {[1, 2, 3, 4, 5].map((i) => (
        <button key={i} type="button" onMouseEnter={() => setHover(i)} onClick={() => onChange(value === i ? 0 : i)}
          style={{ fontSize: size, color: i <= v ? 'var(--gold, #f5c451)' : 'var(--line)' }}>★</button>
      ))}
      {calc != null && <span className="dim" style={{ fontSize: 11, marginLeft: 4 }} title={`Calculated from ${n} rated part${n === 1 ? '' : 's'} underneath`}>{value ? '· ' : ''}{calc}★ from {n}</span>}
    </span>
  );
}

// Short phrases as chips: Enter or comma adds, ✕ removes.
function Chips({ items = [], onChange, placeholder, tone }) {
  const [text, setText] = useState('');
  const add = () => { const v = text.trim().replace(/,$/, ''); if (v && !items.includes(v)) onChange([...items, v]); setText(''); };
  return (
    <div className="chips">
      {items.map((x) => <span key={x} className={`chip ${tone}`}>{x}<button type="button" onClick={() => onChange(items.filter((y) => y !== x))}>✕</button></span>)}
      <input value={text} onChange={(e) => setText(e.target.value)} onBlur={add} placeholder={placeholder}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } }} />
    </div>
  );
}

// Notes + likes + dislikes for a song, album or group. These feed the taste profile agents read.
export function NotesPanel({ obj, onChange, what = 'song' }) {
  return (
    <div className="notes-panel">
      <Chips items={obj.likes} onChange={(likes) => onChange({ likes })} tone="like" placeholder={`👍 what you like about this ${what} (Enter)`} />
      <Chips items={obj.dislikes} onChange={(dislikes) => onChange({ dislikes })} tone="dislike" placeholder="👎 what you don't (Enter)" />
      <textarea rows={2} value={obj.notes || ''} onChange={(e) => onChange({ notes: e.target.value })} placeholder={`Notes on this ${what} — agents read these when making more like it`} />
    </div>
  );
}
export const hasNotes = (o) => !!(o?.notes || o?.likes?.length || o?.dislikes?.length);
