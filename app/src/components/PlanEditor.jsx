import { useState } from 'react';
import { planMs, chunkMs } from '../api/music.js';
import { fmtDuration } from '../state/pricing.js';

// Comma-separated style tags, committed on blur so typing commas works.
function Styles({ value, onChange, placeholder }) {
  const [text, setText] = useState(null);
  return <input value={text ?? (value || []).join(', ')} placeholder={placeholder} onChange={(e) => setText(e.target.value)}
    onBlur={() => { if (text != null) { onChange(text.split(',').map((s) => s.trim()).filter(Boolean)); setText(null); } }} />;
}

// Composition plan editor (Music v2+): the song as ordered chunks — each a section with its own
// lyrics/directions, length and styles — plus "keep audio" chunks that reuse part of a stored song
// (what section regeneration builds). The first chunk's styles set the overall genre.
export default function PlanEditor({ plan, onChange, respect = true, onRespect }) {
  const chunks = plan?.chunks || [];
  const set = (i, up) => onChange({ chunks: chunks.map((c, j) => (j === i ? { ...c, ...up } : c)) });
  const move = (i, d) => { const c = [...chunks]; const j = i + d; if (j < 0 || j >= c.length) return; [c[i], c[j]] = [c[j], c[i]]; onChange({ chunks: c }); };
  const del = (i) => onChange({ chunks: chunks.filter((_, j) => j !== i) });
  const add = () => onChange({ chunks: [...chunks, { text: `[Section ${chunks.length + 1}]\n`, duration_ms: 20000, positive_styles: [], negative_styles: [], context_adherence: 'high' }] });
  return (
    <div className="plan">
      {chunks.map((c, i) => (
        <div key={i} className="plan-chunk">
          <div className="row" style={{ gap: 6 }}>
            <b style={{ fontSize: 12 }}>{i + 1}.</b>
            {c.song_id
              ? <span className="grow dim" style={{ fontSize: 12 }}>♻ Keep existing audio {fmtDuration(c.range.start_ms)}–{fmtDuration(c.range.end_ms)} <span title={c.song_id}>(stored song)</span></span>
              : <><span className="grow" />
                <label style={{ margin: 0, fontSize: 11 }}>sec <input type="number" min="3" max="120" value={Math.round((c.duration_ms || 0) / 1000)} onChange={(e) => set(i, { duration_ms: Math.max(3000, Math.min(120000, +e.target.value * 1000)) })} style={{ width: 64 }} /></label>
                <select value={c.context_adherence || 'high'} onChange={(e) => set(i, { context_adherence: e.target.value })} style={{ width: 'auto', fontSize: 11 }} title="How closely this part follows the parts around it">
                  <option value="high">follow context: high</option><option value="medium">medium</option><option value="low">low (freer)</option>
                </select></>}
            <button className="mini" onClick={() => move(i, -1)} disabled={!i}>▲</button>
            <button className="mini" onClick={() => move(i, 1)} disabled={i === chunks.length - 1}>▼</button>
            <button className="mini" onClick={() => del(i)}>✕</button>
          </div>
          {!c.song_id && <>
            <textarea className="mono" rows={Math.min(8, Math.max(2, (c.text || '').split('\n').length))} value={c.text || ''} onChange={(e) => set(i, { text: e.target.value })}
              placeholder={'[Verse 1]\nlyric line\nanother line {whispered}'} />
            <div className="row" style={{ gap: 6 }}>
              <Styles value={c.positive_styles} onChange={(v) => set(i, { positive_styles: v })} placeholder={i === 0 ? 'styles — the first part sets the genre: dark synthwave, 120 BPM, male vocals' : 'styles for this part (optional)'} />
              <Styles value={c.negative_styles} onChange={(v) => set(i, { negative_styles: v })} placeholder="avoid (optional)" />
            </div>
            {c.conditioning_ref?.song_id && <div className="dim" style={{ fontSize: 11 }}>🎧 Sounds like a reference song ({c.condition_strength || 'default'} strength) <button className="mini" onClick={() => set(i, { conditioning_ref: null, condition_strength: null })}>remove</button></div>}
          </>}
        </div>
      ))}
      <div className="row" style={{ marginTop: 6 }}>
        <button className="mini" onClick={add}>＋ Section</button>
        <span className="dim" style={{ fontSize: 12 }}>{chunks.length} section{chunks.length === 1 ? '' : 's'} · {fmtDuration(planMs(plan))}{chunks.some((c) => !c.song_id && chunkMs(c) < 3000) ? ' · each part ≥ 3 s' : ''}</span>
        <div className="grow" />
        {onRespect && <label className="row" style={{ margin: 0, fontSize: 12 }}><input type="checkbox" style={{ width: 'auto' }} checked={respect} onChange={(e) => onRespect(e.target.checked)} /> hold section lengths strictly</label>}
      </div>
    </div>
  );
}
