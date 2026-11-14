import { useState } from 'react';
import { t } from '../i18n.js';

// 1–5 stars; clicking the current value clears it. `calc` (from the parts underneath) shows beside it.
export function Stars({ value = 0, onChange, calc = null, n = 0, size = 14 }) {
  const [hover, setHover] = useState(0);
  const v = hover || value || 0;
  return (
    <span className="stars" onMouseLeave={() => setHover(0)} title={value ? t('Your rating: {value}★ (click again to clear)', { value: value }) : t('Rate')}>
      {[1, 2, 3, 4, 5].map((i) => (
        <button key={i} type="button" onMouseEnter={() => setHover(i)} onClick={() => onChange(value === i ? 0 : i)}
          style={{ fontSize: size, color: i <= v ? 'var(--gold, #f5c451)' : 'var(--line)' }}>★</button>
      ))}
      {calc != null && <span className="dim" style={{ fontSize: 11, marginInlineStart: 4 }} title={t.n('Calculated from {n} rated part underneath', 'Calculated from {n} rated parts underneath', n)}>{value ? '· ' : ''}{t('{calc}★ from {n}', { calc: calc, n: n })}</span>}
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
      <Chips items={obj.likes} onChange={(likes) => onChange({ likes })} tone="like" placeholder={t('👍 what you like about this {what} (Enter)', { what: what })} />
      <Chips items={obj.dislikes} onChange={(dislikes) => onChange({ dislikes })} tone="dislike" placeholder={t('👎 what you don\'t (Enter)')} />
      <textarea rows={2} value={obj.notes || ''} onChange={(e) => onChange({ notes: e.target.value })} placeholder={t('Notes on this {what} — agents read these when making more like it', { what: what })} />
    </div>
  );
}
export const hasNotes = (o) => !!(o?.notes || o?.likes?.length || o?.dislikes?.length);
