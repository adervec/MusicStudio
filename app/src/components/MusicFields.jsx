import { useState } from 'react';
import PlanEditor from './PlanEditor.jsx';
import { MUSIC_MODELS, LATEST_MUSIC_MODEL, MUSIC_PROMPT_MAX, musicModelFor } from '../api/elevenlabs.js';
import { draftPlan } from '../api/music.js';
import { chooseTake } from '../album/takes.js';
import { fmtDuration } from '../state/pricing.js';
import { t, fmtNum, fmtDate } from '../i18n.js';

const STYLE_PRESETS = [
  'lo-fi hip-hop, mellow piano, vinyl crackle, 80 BPM', 'cinematic orchestral, epic, building strings',
  'synthwave, retro, driving arpeggios, 110 BPM', 'ambient, ethereal pads, slow, no drums',
  'jazz trio, warm, brushed drums, upright bass', 'darksynth, aggressive, industrial, 120 BPM',
  'acoustic folk, fingerpicked guitar, intimate', 'house, four-on-the-floor, groovy bassline, 124 BPM',
  'trailer hybrid, big percussion, tension', 'chiptune, upbeat, 8-bit, playful',
];
export const QC_COLOR = { A: 'var(--good)', B: 'var(--good)', C: 'var(--warn)', D: 'var(--bad)', F: 'var(--bad)' };
// i18n-keys: silent | very quiet | clipping | slow start | long silent tail | too short
const qcFlag = (f) => { const m = /^(\d+)s gap$/.exec(f); return m ? t('{seconds}s gap', { seconds: m[1] }) : t(f); };
export const qcTitle = (q) => (q ? t('Quality check {grade} ({score}/100){flags}\npeak {peak} dB · loudness {rms} dB · silence {silence}%', {
  grade: q.grade, score: q.score, flags: q.flags?.length ? ' — ' + q.flags.map(qcFlag).join(', ') : '', peak: fmtNum(q.peakDb, 1), rms: fmtNum(q.rmsDb, 1), silence: fmtNum(q.silencePct, 1) }) : '');

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
    if (!apiKey) return alert(t('Set your ElevenLabs API key in Settings first.'));
    setBusy(t('Drafting plan…'));
    try { const plan = await draftPlan({ prompt: [tk.prompt, tk.lyrics && `Lyrics:\n${tk.lyrics}`].filter(Boolean).join('\n\n') || tk.title, lengthMs: tk.lengthMs, model, source: tk.usePlan ? tk.plan : null }, apiKey); if (plan) patch({ plan, usePlan: true }); }
    catch (e) { alert(t('Draft failed: {error}', { error: e.message || e })); }
    setBusy('');
  }
  const asTrack = (k) => ({ ...k, id: k.id, title: `${tk.title || 'Track'} · take`, gain: tk.gain });

  return (
    <>
      <div className="row" style={{ marginTop: 6, gap: 6 }}>
        <span className="seg">
          <button className={`mini${!tk.usePlan ? ' primary' : ''}`} onClick={() => patch({ usePlan: false })}>{t('Prompt')}</button>
          <button className={`mini${tk.usePlan ? ' primary' : ''}`} onClick={() => patch({ usePlan: true, plan: tk.plan?.chunks?.length ? tk.plan : { chunks: [{ text: '[Intro]\n', duration_ms: Math.min(120000, tk.lengthMs || 30000), positive_styles: (tk.prompt || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 8), negative_styles: [], context_adherence: 'high' }] } })} title={t('Compose section by section (Music v2+)')}>{t('Composition plan')}</button>
        </span>
        <button className="mini" onClick={draft} disabled={!!busy} title={t('Let ElevenLabs draft a section-by-section plan from the prompt (and lyrics)')}>{busy || t('✨ Draft plan from prompt')}</button>
        {tk.genPlan?.chunks?.length > 0 && <button className="mini" onClick={() => patch({ plan: tk.genPlan, usePlan: true })} title={t('Load the exact plan ElevenLabs used for the current audio')}>{t('↺ Plan it used')}</button>}
      </div>

      {tk.usePlan
        ? <PlanEditor plan={tk.plan} onChange={(plan) => patch({ plan })} respect={tk.respectDurations !== false} onRespect={(v) => patch({ respectDurations: v })} />
        : <>
          <label>{t('Prompt')}</label>
          <textarea value={tk.prompt} onChange={(e) => patch({ prompt: e.target.value })} placeholder={t('e.g. Upbeat lo-fi hip-hop with mellow piano, warm vinyl crackle, 90 BPM')} />
          <div className="row" style={{ marginTop: 4 }}>
            <span style={{ order: 2, marginInlineStart: 'auto', fontSize: 11, color: (tk.prompt || '').length > MUSIC_PROMPT_MAX ? 'var(--bad)' : 'var(--dim)' }} title={t('ElevenLabs accepts up to 4,100 characters per prompt')}>{t('{localeString} / {localeString2} chars', { localeString: fmtNum((tk.prompt || '').length), localeString2: fmtNum(MUSIC_PROMPT_MAX) })}</span>
            <select value="" onChange={(e) => { if (e.target.value) patch({ prompt: (tk.prompt ? tk.prompt.trim() + ', ' : '') + e.target.value }); }} style={{ maxWidth: 240 }} title={t('Append a style to the prompt')}>
              <option value="">{t('＋ add a style…')}</option>
              {STYLE_PRESETS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {!tk.instrumental && <>
            <label>{t('Lyrics (optional)')}</label>
            <textarea rows={2} value={tk.lyrics || ''} onChange={(e) => patch({ lyrics: e.target.value })} placeholder={t('Leave empty to let ElevenLabs write them')} />
          </>}
        </>}

      <div className="row" style={{ marginTop: 6, flexWrap: 'wrap' }}>
        {!tk.usePlan && <div><label>{t('Length (sec)')}</label><input type="number" min="3" max="600" value={Math.round((tk.lengthMs || 60000) / 1000)} onChange={(e) => patch({ lengthMs: Math.max(3000, Math.min(600000, +e.target.value * 1000)) })} style={{ width: 90 }} /></div>}
        <div className="grow"><label>{t('Model')}</label><select value={tk.modelPinned ? model : 'latest'} onChange={(e) => patch(e.target.value === 'latest' ? { model: LATEST_MUSIC_MODEL, modelPinned: false } : { model: e.target.value, modelPinned: true })} title={t('Latest follows ElevenLabs\' newest model automatically; pin one only to keep a specific model')}>
          <option value="latest">{t('Latest — {value} (recommended)', { value: MUSIC_MODELS[0].label.split(' — ')[0] })}</option>
          {MUSIC_MODELS.map((m) => <option key={m.id} value={m.id}>{t('📌 Pin: {label}', { label: m.label })}</option>)}
        </select></div>
        <div><label>{t('Takes')}</label><select value={tk.takesN || prefs.takes || 1} onChange={(e) => patch({ takesN: +e.target.value })} style={{ width: 70 }} title={t('Generations per Generate — the best (quality check) becomes the song, the rest are kept as takes')}>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
        <label style={{ marginTop: 20 }}><input type="checkbox" checked={!!tk.instrumental} onChange={(e) => patch({ instrumental: e.target.checked })} style={{ width: 'auto', marginInlineEnd: 5 }} />{t('Instrumental')}</label>
        <button className="mini" style={{ marginTop: 18 }} onClick={() => setAdv((v) => !v)}>{adv ? '▾' : '▸'}{' '}{t('More')}</button>
      </div>
      {adv && (
        <div className="row" style={{ marginTop: 6, flexWrap: 'wrap', gap: 12, fontSize: 12 }}>
          <label className="row" style={{ margin: 0 }} title={t('Regenerate with the same seed as the current audio (with the same prompt it lands close to it)')}><input type="checkbox" style={{ width: 'auto' }} checked={!!tk.lockSeed} onChange={(e) => patch({ lockSeed: e.target.checked })} />{' '}{t('🔒 Reuse seed')}{' '}{Number.isInteger(tk.seed) ? <code>{tk.seed}</code> : <span className="dim">{t('(none yet)')}</span>}</label>
          <label className="row" style={{ margin: 0 }} title={t('Spell proper names phonetically in the sung lyrics, for better pronunciation')}><input type="checkbox" style={{ width: 'auto' }} checked={tk.phonetic ?? !!prefs.phoneticNames} onChange={(e) => patch({ phonetic: e.target.checked })} />{' '}{t('Phonetic names')}</label>
          <label className="row" style={{ margin: 0 }}>{t('Finetune')}<select value={tk.finetuneId || ''} onChange={(e) => patch({ finetuneId: e.target.value })} style={{ width: 'auto' }}>
              <option value="">{t('none')}</option>
              {finetunes.filter((f) => f.status === 'completed').map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select></label>
          {tk.finetuneId && <label className="row" style={{ margin: 0 }}>{t('strength')}{' '}<input type="range" min="0" max="2" step="0.1" value={tk.finetuneStrength ?? 1} onChange={(e) => patch({ finetuneStrength: +e.target.value })} style={{ width: 90 }} />{fmtNum(tk.finetuneStrength ?? 1, 1)}</label>}
        </div>
      )}

      {tk.genMeta && (tk.genMeta.genres?.length || tk.genMeta.description) && (
        <p className="note" title={t('How ElevenLabs described the current audio')}>🎼 {[tk.genMeta.genres?.join(', '), tk.genMeta.languages?.length && `lang ${tk.genMeta.languages.join('/')}`, tk.genMeta.explicit && 'explicit'].filter(Boolean).join(' · ')}{tk.genMeta.description ? ` — ${tk.genMeta.description}` : ''}</p>
      )}

      {tk.clipId && (
        <div className="row" style={{ marginTop: 6, flexWrap: 'wrap' }}>
          {takes.length > 0 && <button className="mini" onClick={() => setShowTakes((v) => !v)}>{showTakes ? '▾' : '▸'}{' '}{t('Takes ({n})', { n: takes.length + 1 })}</button>}
          <button className="mini" onClick={() => setIp(ip ? null : { from: 0, to: Math.min(20, Math.round((tk.durationMs || 0) / 1000)), text: '', styles: (tk.genPlan?.chunks?.[0]?.positive_styles || []).join(', ') })} title={t('Regenerate one part of this song and keep the rest (Music v2+)')}>{t('✂ Redo a section')}</button>
          {tk.lrc && <span className="dim" style={{ fontSize: 11 }} title={tk.lrc}>{t('♪ synced lyrics')}</span>}
        </div>
      )}
      {ip && (
        <div className="plan-chunk" style={{ marginTop: 6 }}>
          <div className="row" style={{ gap: 6, fontSize: 12 }}>{t('Replace from')}{' '}<input type="number" min="0" value={ip.from} onChange={(e) => setIp({ ...ip, from: +e.target.value })} style={{ width: 70 }} />{' '}{t('s to')}{' '}<input type="number" min="0" value={ip.to} onChange={(e) => setIp({ ...ip, to: +e.target.value })} style={{ width: 70 }} /> s
            <span className="dim">{t('of {duration} — the rest is kept exactly', { duration: fmtDuration(tk.durationMs) })}</span>
          </div>
          <textarea className="mono" rows={2} value={ip.text} onChange={(e) => setIp({ ...ip, text: e.target.value })} placeholder={t('[Bridge]\nnew lyric line {soaring}')} />
          <input value={ip.styles} onChange={(e) => setIp({ ...ip, styles: e.target.value })} placeholder={t('styles for the new part, e.g. choir swell, half-time drums')} />
          <div className="row" style={{ marginTop: 4 }}>
            <button className="primary mini" onClick={() => { onInpaint(tk, ip); setIp(null); }} disabled={ip.to - ip.from < 3}>{t('Regenerate this part → new take')}</button>
            <button className="mini" onClick={() => setIp(null)}>{t('Cancel')}</button>
          </div>
        </div>
      )}
      {showTakes && takes.length > 0 && (
        <div className="takes">
          {[{ ...tk, id: tk.repId || 'current', current: true, note: tk.takeNote, meta: tk.genMeta }, ...takes].map((k) => (
            <div key={k.id} className={`take-row${k.current ? ' now' : ''}`}>
              <button className="mini" onClick={() => player.play(asTrack(k), [asTrack(k)])}>{player.playing === k.id && !player.paused ? '⏸' : '▶'}</button>
              {k.qc && <span className="badge" style={{ color: QC_COLOR[k.qc.grade], borderColor: QC_COLOR[k.qc.grade] }} title={qcTitle(k.qc)}>{k.qc.grade}</span>}
              <span className="dim" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{fmtDuration(k.durationMs)}{Number.isInteger(k.seed) ? t(' · seed {seed}', { seed: k.seed }) : ''}{k.at ? ` · ${fmtDate(k.at)}` : ''}</span>
              <input className="grow" value={k.note || ''} placeholder={t('note (e.g. great vocals, weak ending)')}
                onChange={(e) => patch(k.current ? { takeNote: e.target.value } : { takes: takes.map((x) => (x.id === k.id ? { ...x, note: e.target.value } : x)) })} style={{ fontSize: 12, padding: '2px 6px' }} />
              {k.current ? <span className="badge" style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}>{t('in use')}</span>
                : <><button className="mini" onClick={() => patch(chooseTake(tk, k.id))} title={t('Use this take as the song')}>{t('Use')}</button>
                  <button className="mini danger" onClick={() => onDeleteTakes(tk, [k.id])} title={t('Delete this take and its file')}>🗑</button></>}
            </div>
          ))}
          <div className="row" style={{ marginTop: 4 }}><button className="mini danger" onClick={() => { if (confirm(t('Delete the {count} other take(s) and their files? The one in use stays.', { count: takes.length }))) onDeleteTakes(tk, takes.map((k) => k.id)); }}>{t('Keep only the take in use')}</button></div>
        </div>
      )}
    </>
  );
}
