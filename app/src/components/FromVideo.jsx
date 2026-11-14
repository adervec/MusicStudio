import { useState } from 'react';
import Dialog from './Dialog.jsx';
import { pickFile } from '../backup/fs.js';
import { t, fmtNum } from '../i18n.js';

// Score a video: one or more clips (combined in order) → a music track generated to fit them.
export default function FromVideo({ onCreate, onClose }) {
  const [videos, setVideos] = useState([]);
  const [o, setO] = useState({ description: '', tags: '', addSfx: false, useAudioRef: false });
  const set = (k) => (e) => setO({ ...o, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  return (
    <Dialog title={t('🎬 Music from video')} onClose={onClose} width={560}
      footer={<><button onClick={onClose}>{t('Cancel')}</button><button className="primary" disabled={!videos.length} onClick={() => onCreate({ videos, ...o, tags: o.tags.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 10) })}>{t('Add track & generate')}</button></>}>
      <div className="row"><button onClick={async () => { const fs = await pickFile('video/*'); if (fs.length) setVideos((v) => [...v, ...fs].slice(0, 10)); }}>{t('＋ Add video…')}</button>
        <span className="dim" style={{ fontSize: 12 }}>{t('up to 10 clips, combined in this order')}</span></div>
      {videos.map((v, i) => <div key={i} className="row" style={{ fontSize: 12 }}><span className="grow ell">🎬 {v.name}</span><span className="dim">{t('{fixed} MB', { fixed: fmtNum(v.size / 1048576, 1) })}</span><button className="mini" onClick={() => setVideos(videos.filter((_, j) => j !== i))}>✕</button></div>)}
      <label>{t('What the music should be (optional)')}</label>
      <textarea rows={3} value={o.description} onChange={set('description')} placeholder={t('e.g. tense cinematic build, resolving into a warm string theme')} />
      <label>{t('Style tags (optional, comma-separated)')}</label>
      <input value={o.tags} onChange={set('tags')} placeholder={t('cinematic, suspense')} />
      <label className="row"><input type="checkbox" style={{ width: 'auto' }} checked={o.addSfx} onChange={set('addSfx')} />{' '}{t('Add sound-effect cues from the video')}</label>
      <label className="row"><input type="checkbox" style={{ width: 'auto' }} checked={o.useAudioRef} onChange={set('useAudioRef')} />{' '}{t('Use the video\'s own audio as a style reference')}</label>
      <p className="note">{t('The video is only sent to ElevenLabs for this generation; it isn\'t stored by the app. If you reload before it runs, the track stays as a normal song gap with your description as its prompt.')}</p>
    </Dialog>
  );
}
