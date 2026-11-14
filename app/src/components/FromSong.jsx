import { useState } from 'react';
import Dialog from './Dialog.jsx';
import { pickFile } from '../backup/fs.js';
import { uploadSong, lyricsFromWords, planMs } from '../api/music.js';
import { LATEST_MUSIC_MODEL } from '../api/elevenlabs.js';
import { fmtDuration } from '../state/pricing.js';
import { t } from '../i18n.js';

// Reverse-engineer a finished song: ElevenLabs analyses it and returns its composition plan
// (sections, styles, lyrics). From that: recreate it, make sibling songs in the same style, optionally
// "sound like" the original (conditioning on its audio), and keep the original as a track.
export default function FromSong({ apiKey, busy, onCreate, onClose }) {
  const [file, setFile] = useState(null);
  const [an, setAn] = useState(null); // { songId, plan, words }
  const [err, setErr] = useState('');
  const [working, setWorking] = useState('');
  const [o, setO] = useState({ recreate: true, siblings: 3, direction: '', soundAlike: true, strength: 'medium', addOriginal: true, generate: false });
  const set = (k) => (e) => setO({ ...o, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'number' ? +e.target.value : e.target.value });

  async function choose() {
    const [f] = await pickFile('audio/*'); if (!f) return;
    setFile(f); setAn(null); setErr(''); setWorking(t('Analysing with ElevenLabs…'));
    try { setAn(await uploadSong(f, { extractPlanModel: LATEST_MUSIC_MODEL, withTimestamps: true, name: f.name }, apiKey)); }
    catch (e) { setErr(e.message || String(e)); }
    setWorking('');
  }
  const chunks = an?.plan?.chunks || [];
  const lyrics = an ? lyricsFromWords(an.words) : '';
  const styles = [...new Set(chunks.flatMap((c) => c.positive_styles || []))];
  const count = (o.recreate ? 1 : 0) + (o.siblings || 0) + (o.addOriginal ? 1 : 0);
  return (
    <Dialog title={t('🎧 New tracks from an existing song')} onClose={onClose} width={680}
      footer={<><button onClick={onClose}>{t('Cancel')}</button>
        <button className="primary" disabled={!an || !count || !!busy} onClick={() => onCreate({ file, analysis: an, lyrics, ...o })}>{busy || t.n('Add {n} track', 'Add {n} tracks', count)}</button></>}>
      <p className="note">{t('ElevenLabs listens to the song and returns its plan — sections, styles, lyrics. Nothing is generated (no music credits) until you press Generate on the new tracks.')}</p>
      <div className="row"><button onClick={choose} disabled={!!working || !apiKey}>{file ? t('Choose another song…') : t('Choose a song…')}</button>
        {file && <span className="ell">{file.name}</span>}{!apiKey && <span className="dim">{t('needs the API key (Settings)')}</span>}</div>
      {working && <p className="note">{working}</p>}
      {err && <p className="note" style={{ color: 'var(--bad)' }}>⚠ {err}</p>}
      {an && (
        <>
          <div className="wiz-list" style={{ maxHeight: 200, marginTop: 8, fontSize: 12 }}>
            <div><b>{t.n('{n} section', '{n} sections', chunks.length)}</b> · {fmtDuration(planMs(an.plan))}{styles.length ? ` · ${styles.slice(0, 12).join(', ')}` : ''}</div>
            {chunks.map((c, i) => <div key={i} className="dim">{i + 1}. {(c.text || '').split('\n')[0] || '(section)'} — {Math.round((c.duration_ms || 0) / 1000)}s{c.positive_styles?.length ? ` · ${c.positive_styles.slice(0, 4).join(', ')}` : ''}</div>)}
            {lyrics && <details><summary>{t('Lyrics ({count} lines)', { count: lyrics.split('\n').length })}</summary><pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{lyrics}</pre></details>}
          </div>
          <label className="row" style={{ marginTop: 8 }}><input type="checkbox" style={{ width: 'auto' }} checked={o.recreate} onChange={set('recreate')} />{' '}{t('Recreate it — one track with this exact plan')}</label>
          <div className="row"><span>{t('Siblings: new songs in the same style')}</span><input type="number" min="0" max="8" value={o.siblings} onChange={set('siblings')} style={{ width: 64 }} /></div>
          {o.siblings > 0 && <input value={o.direction} onChange={set('direction')} placeholder={t('optional direction for the siblings, e.g. darker, slower, a ballad, new lyrics about the sea')} />}
          <label className="row"><input type="checkbox" style={{ width: 'auto' }} checked={o.soundAlike} onChange={set('soundAlike')} />{' '}{t('Sound like the original (condition on its audio)')}{o.soundAlike && <select value={o.strength} onChange={set('strength')} style={{ width: 'auto' }}><option value="low">{t('loosely')}</option><option value="medium">{t('clearly')}</option><option value="high">{t('closely')}</option><option value="xhigh">{t('very closely')}</option></select>}</label>
          <label className="row"><input type="checkbox" style={{ width: 'auto' }} checked={o.addOriginal} onChange={set('addOriginal')} />{' '}{t('Also add the original song as a track (kept, not regenerated)')}</label>
          <label className="row"><input type="checkbox" style={{ width: 'auto' }} checked={o.generate} onChange={set('generate')} />{' '}{t('Queue the new tracks for generation right away (asks to confirm the cost)')}</label>
        </>
      )}
    </Dialog>
  );
}
