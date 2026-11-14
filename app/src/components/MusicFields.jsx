import { useState } from 'react';
import PlanEditor from './PlanEditor.jsx';
import { MUSIC_MODELS, LATEST_MUSIC_MODEL, MUSIC_PROMPT_MAX, musicModelFor } from '../api/elevenlabs.js';
import { draftPlan } from '../api/music.js';
import { chooseTake } from '../album/takes.js';
import { fmtDuration } from '../state/pricing.js';

const STYLE_PRESETS = [
  'lo-fi hip-hop, mellow piano, vinyl crackle, 80 BPM', 'cinematic orchestral, epic, building strings',
  'synthwave, retro, driving arpeggios, 110 BPM', 'ambient, ethereal pads, slow, no drums',
  'jazz trio, warm, brushed drums, upright bass', 'darksynth, aggressive, industrial, 120 BPM',
  'acoustic folk, fingerpicked guitar, intimate', 'house, four-on-the-floor, groovy bassline, 124 BPM',
  'trailer hybrid, big percussion, tension', 'chiptune, upbeat, 8-bit, playful',
];
export const QC_COLOR = { A: 'var(--good)', B: 'var(--good)', C: 'var(--warn)', D: 'var(--bad)', F: 'var(--bad)' };
export const qcTitle = (q) => (q ? `Quality check ${q.grade} (${q.score}/100)${q.flags?.length ? ' — ' + q.flags.join(', ') : ''}\npeak ${q.peakDb} dB · loudness ${q.rmsDb} dB · silence ${q.silencePct}%` : '');

// Everything about one song track: prompt or composition plan, lyrics, model, takes (play / choose /
// note / delete), seed, ElevenLabs' own read of the result, and regenerating one section.
export default function MusicFields({ t: tk, patch, prefs, apiKey, player, finetunes = [], onDeleteTakes, onInpaint }) {
  const [busy, setBusy] = useState('');
  const [showTakes, setShowTakes] = useState(false);
  const [adv, setAdv] = useState(false);
  const [ip, setIp] = useState(null); // section-regeneration form { from, to, text, styles }
  const model = musicModelFor(tk);
  const takes = tk.takes || [];

  async function draft() {
    if (!apiKey) return alert('Set your ElevenLabs API key in Settings first.');
    setBusy('Drafting plan…');
    try { const plan = await draftPlan({ prompt: [tk.prompt, tk.lyrics && `Lyrics:\n${tk.lyrics}`].filter(Boolean).join('\n\n') || tk.title, lengthMs: tk.lengthMs, model, source: tk.usePlan ? tk.plan : null }, apiKey); if (plan) patch({ plan, usePlan: true }); }
    catch (e) { alert('Draft failed: ' + (e.message || e)); }
    setBusy('');
  }
  const asTrack = (k) => ({ ...k, id: k.id, title: `${tk.title || 'Track'} · take`, gain: tk.gain });

  return (
    <>
      <div className="row" style={{ marginTop: 6, gap: 6 }}>
        <span className="seg">
          <button className={`mini${!tk.usePlan ? ' primary' : ''}`} onClick={() => patch({ usePlan: false })}>Prompt</button>
          <button className={`mini${tk.usePlan ? ' primary' : ''}`} onClick={() => patch({ usePlan: true, plan: tk.plan?.chunks?.length ? tk.plan : { chunks: [{ text: '[Intro]\n', duration_ms: Math.min(120000, tk.lengthMs || 30000), positive_styles: (tk.prompt || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 8), negative_styles: [], context_adherence: 'high' }] } })} title="Compose section by section (Music v2+)">Composition plan</button>
        </span>
        <button className="mini" onClick={draft} disabled={!!busy} title="Let ElevenLabs draft a section-by-section plan from the prompt (and lyrics)">{busy || '✨ Draft plan from prompt'}</button>
        {tk.genPlan?.chunks?.length > 0 && <button className="mini" onClick={() => patch({ plan: tk.genPlan, usePlan: true })} title="Load the exact plan ElevenLabs used for the current audio">↺ Plan it used</button>}
      </div>

      {tk.usePlan
        ? <PlanEditor plan={tk.plan} onChange={(plan) => patch({ plan })} respect={tk.respectDurations !== false} onRespect={(v) => patch({ respectDurations: v })} />
        : <>
          <label>Prompt</label>
          <textarea value={tk.prompt} onChange={(e) => patch({ prompt: e.target.value })} placeholder="e.g. Upbeat lo-fi hip-hop with mellow piano, warm vinyl crackle, 90 BPM" />
          <div className="row" style={{ marginTop: 4 }}>
            <span style={{ order: 2, marginLeft: 'auto', fontSize: 11, color: (tk.prompt || '').length > MUSIC_PROMPT_MAX ? 'var(--bad)' : 'var(--dim)' }} title="ElevenLabs accepts up to 4,100 characters per prompt">{(tk.prompt || '').length.toLocaleString()} / {MUSIC_PROMPT_MAX.toLocaleString()} chars</span>
            <select value="" onChange={(e) => { if (e.target.value) patch({ prompt: (tk.prompt ? tk.prompt.trim() + ', ' : '') + e.target.value }); }} style={{ maxWidth: 240 }} title="Append a style to the prompt">
              <option value="">＋ add a style…</option>
              {STYLE_PRESETS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {!tk.instrumental && <>
            <label>Lyrics (optional)</label>
            <textarea rows={2} value={tk.lyrics || ''} onChange={(e) => patch({ lyrics: e.target.value })} placeholder="Leave empty to let ElevenLabs write them" />
          </>}
        </>}

      <div className="row" style={{ marginTop: 6, flexWrap: 'wrap' }}>
        {!tk.usePlan && <div><label>Length (sec)</label><input type="number" min="3" max="600" value={Math.round((tk.lengthMs || 60000) / 1000)} onChange={(e) => patch({ lengthMs: Math.max(3000, Math.min(600000, +e.target.value * 1000)) })} style={{ width: 90 }} /></div>}
        <div className="grow"><label>Model</label><select value={tk.modelPinned ? model : 'latest'} onChange={(e) => patch(e.target.value === 'latest' ? { model: LATEST_MUSIC_MODEL, modelPinned: false } : { model: e.target.value, modelPinned: true })} title="Latest follows ElevenLabs' newest model automatically; pin one only to keep a specific model">
          <option value="latest">Latest — {MUSIC_MODELS[0].label.split(' — ')[0]} (recommended)</option>
          {MUSIC_MODELS.map((m) => <option key={m.id} value={m.id}>📌 Pin: {m.label}</option>)}
        </select></div>
        <div><label>Takes</label><select value={tk.takesN || prefs.takes || 1} onChange={(e) => patch({ takesN: +e.target.value })} style={{ width: 70 }} title="Generations per Generate — the best (quality check) becomes the song, the rest are kept as takes">{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
        <label style={{ marginTop: 20 }}><input type="checkbox" checked={!!tk.instrumental} onChange={(e) => patch({ instrumental: e.target.checked })} style={{ width: 'auto', marginRight: 5 }} />Instrumental</label>
        <button className="mini" style={{ marginTop: 18 }} onClick={() => setAdv((v) => !v)}>{adv ? '▾' : '▸'} More</button>
      </div>
      {adv && (
        <div className="row" style={{ marginTop: 6, flexWrap: 'wrap', gap: 12, fontSize: 12 }}>
          <label className="row" style={{ margin: 0 }} title="Regenerate with the same seed as the current audio (with the same prompt it lands close to it)"><input type="checkbox" style={{ width: 'auto' }} checked={!!tk.lockSeed} onChange={(e) => patch({ lockSeed: e.target.checked })} /> 🔒 Reuse seed {Number.isInteger(tk.seed) ? <code>{tk.seed}</code> : <span className="dim">(none yet)</span>}</label>
          <label className="row" style={{ margin: 0 }} title="Spell proper names phonetically in the sung lyrics, for better pronunciation"><input type="checkbox" style={{ width: 'auto' }} checked={tk.phonetic ?? !!prefs.phoneticNames} onChange={(e) => patch({ phonetic: e.target.checked })} /> Phonetic names</label>
          <label className="row" style={{ margin: 0 }}>Finetune
            <select value={tk.finetuneId || ''} onChange={(e) => patch({ finetuneId: e.target.value })} style={{ width: 'auto' }}>
              <option value="">none</option>
              {finetunes.filter((f) => f.status === 'completed').map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select></label>
          {tk.finetuneId && <label className="row" style={{ margin: 0 }}>strength <input type="range" min="0" max="2" step="0.1" value={tk.finetuneStrength ?? 1} onChange={(e) => patch({ finetuneStrength: +e.target.value })} style={{ width: 90 }} />{(tk.finetuneStrength ?? 1).toFixed(1)}</label>}
        </div>
      )}

      {tk.genMeta && (tk.genMeta.genres?.length || tk.genMeta.description) && (
        <p className="note" title="How ElevenLabs described the current audio">🎼 {[tk.genMeta.genres?.join(', '), tk.genMeta.languages?.length && `lang ${tk.genMeta.languages.join('/')}`, tk.genMeta.explicit && 'explicit'].filter(Boolean).join(' · ')}{tk.genMeta.description ? ` — ${tk.genMeta.description}` : ''}</p>
      )}

      {tk.clipId && (
        <div className="row" style={{ marginTop: 6, flexWrap: 'wrap' }}>
          {takes.length > 0 && <button className="mini" onClick={() => setShowTakes((v) => !v)}>{showTakes ? '▾' : '▸'} Takes ({takes.length + 1})</button>}
          <button className="mini" onClick={() => setIp(ip ? null : { from: 0, to: Math.min(20, Math.round((tk.durationMs || 0) / 1000)), text: '', styles: (tk.genPlan?.chunks?.[0]?.positive_styles || []).join(', ') })} title="Regenerate one part of this song and keep the rest (Music v2+)">✂ Redo a section</button>
          {tk.lrc && <span className="dim" style={{ fontSize: 11 }} title={tk.lrc}>♪ synced lyrics</span>}
        </div>
      )}
      {ip && (
        <div className="plan-chunk" style={{ marginTop: 6 }}>
          <div className="row" style={{ gap: 6, fontSize: 12 }}>
            Replace from <input type="number" min="0" value={ip.from} onChange={(e) => setIp({ ...ip, from: +e.target.value })} style={{ width: 70 }} /> s
            to <input type="number" min="0" value={ip.to} onChange={(e) => setIp({ ...ip, to: +e.target.value })} style={{ width: 70 }} /> s
            <span className="dim">of {fmtDuration(tk.durationMs)} — the rest is kept exactly</span>
          </div>
          <textarea className="mono" rows={2} value={ip.text} onChange={(e) => setIp({ ...ip, text: e.target.value })} placeholder={'[Bridge]\nnew lyric line {soaring}'} />
          <input value={ip.styles} onChange={(e) => setIp({ ...ip, styles: e.target.value })} placeholder="styles for the new part, e.g. choir swell, half-time drums" />
          <div className="row" style={{ marginTop: 4 }}>
            <button className="primary mini" onClick={() => { onInpaint(tk, ip); setIp(null); }} disabled={ip.to - ip.from < 3}>Regenerate this part → new take</button>
            <button className="mini" onClick={() => setIp(null)}>Cancel</button>
          </div>
        </div>
      )}
      {showTakes && takes.length > 0 && (
        <div className="takes">
          {[{ ...tk, id: tk.repId || 'current', current: true, note: tk.takeNote, meta: tk.genMeta }, ...takes].map((k) => (
            <div key={k.id} className={`take-row${k.current ? ' now' : ''}`}>
              <button className="mini" onClick={() => player.play(asTrack(k), [asTrack(k)])}>{player.playing === k.id && !player.paused ? '⏸' : '▶'}</button>
              {k.qc && <span className="badge" style={{ color: QC_COLOR[k.qc.grade], borderColor: QC_COLOR[k.qc.grade] }} title={qcTitle(k.qc)}>{k.qc.grade}</span>}
              <span className="dim" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{fmtDuration(k.durationMs)}{Number.isInteger(k.seed) ? ` · seed ${k.seed}` : ''}{k.at ? ` · ${new Date(k.at).toLocaleDateString()}` : ''}</span>
              <input className="grow" value={k.note || ''} placeholder="note (e.g. great vocals, weak ending)"
                onChange={(e) => patch(k.current ? { takeNote: e.target.value } : { takes: takes.map((x) => (x.id === k.id ? { ...x, note: e.target.value } : x)) })} style={{ fontSize: 12, padding: '2px 6px' }} />
              {k.current ? <span className="badge" style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}>in use</span>
                : <><button className="mini" onClick={() => patch(chooseTake(tk, k.id))} title="Use this take as the song">Use</button>
                  <button className="mini danger" onClick={() => onDeleteTakes(tk, [k.id])} title="Delete this take and its file">🗑</button></>}
            </div>
          ))}
          <div className="row" style={{ marginTop: 4 }}><button className="mini danger" onClick={() => { if (confirm(`Delete the ${takes.length} other take(s) and their files? The one in use stays.`)) onDeleteTakes(tk, takes.map((k) => k.id)); }}>Keep only the take in use</button></div>
        </div>
      )}
    </>
  );
}
