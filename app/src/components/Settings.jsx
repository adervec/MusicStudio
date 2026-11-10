import { useEffect, useState } from 'react';
import Dialog from './Dialog.jsx';
import { MUSIC_MODELS, TTS_MODELS, listVoices, getSubscription } from '../api/elevenlabs.js';
// ttsModels (prop) is the account's live list; TTS_MODELS the fallback.
import { dirPickerSupported } from '../backup/fs.js';

// API key, default models/voice, and the local backup folder. Key + prefs persist on-device.
export default function Settings({ finetunes = [], projects = [], onRefreshFinetunes, onCreateFinetune, ttsModels, apiKey, prefs, voices, backupName, publishName, onClose, onSave, onVoices, onPickBackup, onClearBackup, onPickPublish, onClearPublish, onManageSync, onExportData, onImportData,
  driveOn, driveEmail, drivePicture, driveAvailable, cloudBusy, onConnectDrive, onDisconnectDrive, onPushCatalog }) {
  const [key, setKey] = useState(apiKey || '');
  const [p, setP] = useState(prefs);
  const [testing, setTesting] = useState('');
  const [credits, setCredits] = useState(null);
  const set = (k, v) => setP((x) => ({ ...x, [k]: v }));

  useEffect(() => { if (apiKey) getSubscription(apiKey).then(setCredits).catch(() => {}); }, [apiKey]);

  async function test() {
    setTesting('Checking…');
    try {
      const vs = await listVoices(key); onVoices(vs); setTesting(`✓ Key works — ${vs.length} voices`);
      getSubscription(key).then(setCredits).catch(() => {});
    } catch (e) { setTesting('✕ ' + e.message); }
  }

  return (
    <Dialog title="Settings" onClose={onClose} width={560}
      footer={<><button onClick={onClose}>Cancel</button><button className="primary" onClick={() => onSave(key, p)}>Save</button></>}>
      <div className="section">ElevenLabs API key</div>
      <div className="row">
        <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="xi-..." autoComplete="off" />
        <button className="mini" onClick={test} disabled={!key.trim()}>Test</button>
      </div>
      {testing && <p className="note">{testing}</p>}
      {credits && <p className="note" style={{ color: credits.remaining <= 0 ? 'var(--bad)' : 'var(--good)' }}>💳 {credits.remaining.toLocaleString()} of {credits.limit.toLocaleString()} credits remaining{credits.tier ? ` · ${credits.tier}` : ''}</p>}
      <p className="note">Stored on this device only; sent solely to ElevenLabs. Get one at elevenlabs.io → Profile → API Keys.</p>

      <div className="section">Font</div>
      {/* shared picker from https://adervec.github.io/font.js; the choice applies to every app by this maker */}
      <app-font-picker />

      <div className="section">Defaults</div>
      <label>Music model</label>
      <select value={p.musicModel || 'latest'} onChange={(e) => set('musicModel', e.target.value)}>
        <option value="latest">Latest — always ElevenLabs' newest model (recommended)</option>
        {MUSIC_MODELS.map((m) => <option key={m.id} value={m.id}>📌 Pin: {m.label}</option>)}
      </select>
      <div className="row" style={{ flexWrap: 'wrap', gap: 14, marginTop: 8 }}>
        <label className="row" style={{ margin: 0 }}>Takes per Generate <select value={p.takes || 1} onChange={(e) => set('takes', +e.target.value)} style={{ width: 70 }}>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
        <label className="row" style={{ margin: 0 }}><input type="checkbox" style={{ width: 'auto' }} checked={p.confirmSpend !== false} onChange={(e) => set('confirmSpend', e.target.checked)} /> Confirm before spending credits</label>
        <label className="row" style={{ margin: 0 }} title="Spell proper names phonetically in sung lyrics (per-track override under ▸ More)"><input type="checkbox" style={{ width: 'auto' }} checked={!!p.phoneticNames} onChange={(e) => set('phoneticNames', e.target.checked)} /> Phonetic names</label>
        <label className="row" style={{ margin: 0 }} title="Sign generated MP3s with C2PA content credentials (marks them as AI-generated)"><input type="checkbox" style={{ width: 'auto' }} checked={!!p.c2pa} onChange={(e) => set('c2pa', e.target.checked)} /> C2PA-sign MP3s</label>
      </div>
      <label>Default song length (seconds)</label>
      <input type="number" min="3" max="600" value={p.defaultLengthSec} onChange={(e) => set('defaultLengthSec', +e.target.value)} />
      <label>Dialog (TTS) model</label>
      <select value={p.ttsModel} onChange={(e) => set('ttsModel', e.target.value)}>
        {(ttsModels || TTS_MODELS).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select>
      <label>Default dialog voice {voices.length ? '' : '(Test the key to load voices)'}</label>
      <select value={p.defaultVoiceId || ''} onChange={(e) => set('defaultVoiceId', e.target.value)}>
        <option value="">— none —</option>
        {voices.map((v) => <option key={v.id} value={v.id}>{v.name}{v.category ? ` (${v.category})` : ''}</option>)}
      </select>
      <label>Gap between album tracks (ms)</label>
      <input type="number" min="0" max="5000" value={p.gapMs} onChange={(e) => set('gapMs', +e.target.value)} />

      <div className="section">Erase everything</div>
      <p className="note">Deletes every album, generated audio clip, the spend log, your API key and all settings from this browser. Files already in your backup folder and on Google Drive are not touched.</p>
      {/* Only this app's own data: every app by this maker shares one origin, so never localStorage.clear(). */}
      <button className="mini" onClick={() => {
        if (!window.confirm('Erase ALL Music Studio data in this browser, including generated audio you paid credits for?\n\nThis cannot be undone. Make sure your backup folder is up to date first.')) return;
        Object.keys(localStorage).filter((k) => k.startsWith('ms-')).forEach((k) => localStorage.removeItem(k));
        const del = indexedDB.deleteDatabase('MusicStudio');
        del.onsuccess = del.onerror = del.onblocked = () => window.location.reload();
      }}>Erase everything…</button>

      <div className="section">Finetunes — train a model on your own songs</div>
      <FinetunePanel finetunes={finetunes} projects={projects} onRefresh={onRefreshFinetunes} onCreate={onCreateFinetune} hasKey={!!apiKey} />

      <div className="section">Local backup folder</div>
      {dirPickerSupported() ? (
        <div className="row">
          <div className="grow">{backupName ? <>Backing up to <b>{backupName}</b></> : <span className="dim">No folder set — created audio is only in the browser.</span>}</div>
          <button className="mini" onClick={onPickBackup}>{backupName ? 'Change' : 'Choose folder'}</button>
          {backupName && <button className="mini danger" onClick={onClearBackup}>Clear</button>}
        </div>
      ) : <p className="note">Folder backup needs Chrome or Edge. Generated audio still saves in the browser and can be exported.</p>}
      <p className="note">Every song, dialog clip, and upload is written to <code>{'<folder>/<project>/'}</code> automatically.</p>

      <label>Backup folder full path — enables the 📂 buttons to open File Explorer{backupName ? ` (should end in “${backupName}”)` : ''}</label>
      <input value={p.backupPath || ''} onChange={(e) => set('backupPath', e.target.value)} placeholder="C:\\Users\\you\\Music\\My Albums" spellCheck={false} />
      <p className="note">The browser can't detect this. Paste the folder's absolute path here (Explorer → click the address bar → copy).</p>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><input type="checkbox" style={{ width: 'auto' }} checked={!!p.folderHelper} onChange={(e) => set('folderHelper', e.target.checked)} />Folder helper installed — 📂 opens File Explorer from the installed app / web version</label>
      <p className="note">One-time, per-user, no admin: run <code>tools\folder-helper\install.cmd</code> from the Music Studio repo (undo: <code>uninstall.cmd</code>). It only opens existing folders. The first click asks Chrome's permission — tick “Always allow”. Not needed when you start the app with “Launch Music Studio.cmd”.</p>

      <div className="section">Publish folder (device sync)</div>
      {dirPickerSupported() ? (
        <div className="row">
          <div className="grow">{publishName ? <>Publishing to <b>{publishName}</b></> : <span className="dim">No publish folder set.</span>}</div>
          <button className="mini" onClick={onPickPublish}>{publishName ? 'Change' : 'Choose folder'}</button>
          {publishName && <button className="mini danger" onClick={onClearPublish}>Clear</button>}
          {publishName && <button className="mini" onClick={onManageSync}>📱 Manage device sync…</button>}
        </div>
      ) : <p className="note">Needs Chrome or Edge.</p>}
      <p className="note">The folder your phone syncs (e.g. Google Drive → AutoSync). <b>📱 Sync</b> controls exactly which albums live there as <code>{'<Album>/'}</code> folders of numbered, tagged tracks + an .m3u; ⇪ Publish pushes one album immediately.</p>

      <div className="section">Google Drive (phone remote)</div>
      <div className="row">
        <div className="grow">{driveOn ? <>{/* the Google account picture shows whose Drive this is */}
          {drivePicture ? <img src={drivePicture} alt="" referrerPolicy="no-referrer" style={{ width: 22, height: 22, borderRadius: '50%', verticalAlign: 'middle', marginRight: 6 }} /> : null}Connected{driveEmail ? <> as <b>{driveEmail}</b></> : ''}</> : <span className="dim">Not connected.</span>}</div>
        <button className="mini" onClick={driveOn ? onDisconnectDrive : onConnectDrive} disabled={!driveAvailable || !!cloudBusy}>{cloudBusy || (driveOn ? 'Disconnect' : 'Connect Google Drive')}</button>
        {driveOn && publishName && <button className="mini" onClick={onPushCatalog} disabled={!!cloudBusy}>☁ Push library</button>}
      </div>
      <label>Device name — how this machine appears on your phone</label>
      <input value={p.deviceName || ''} onChange={(e) => set('deviceName', e.target.value)} placeholder="Desktop" />
      <p className="note">Publishes a <b>text-only catalog</b> (albums, descriptions, tracklists) to Drive's private app folder so your phone can browse this library and tick which albums it wants. The audio never goes through Drive's API — the desktop writes it to the publish folder and your Drive/AutoSync client carries it. Requests are applied the next time this desktop is running.</p>
      {!driveAvailable && <p className="note" style={{ color: 'var(--warn)' }}>Not enabled on this deployment — paste your own Google OAuth client ID below.</p>}
      <label>OAuth client ID (only needed on a fork / self-host)</label>
      <input value={p.driveClientId || ''} onChange={(e) => set('driveClientId', e.target.value)} placeholder="…apps.googleusercontent.com" spellCheck={false} />

      <div className="section">App data backup</div>
      <div className="row">
        <button className="mini" onClick={onExportData}>💾 Back up app data</button>
        <button className="mini" onClick={onImportData}>⟲ Restore…</button>
      </div>
      <p className="note">Downloads a JSON of your albums, groups, playlists, attachments and settings (not the audio — that's in your backup folder, recover with 🔎 Scan folder after restoring).</p>

      <div className="section">Elsewhere</div>
      <p className="note">More apps by the same maker, all free and local-first —{' '}
        <a href="https://adervec.github.io/portal/" target="_blank" rel="noopener noreferrer">adervec.github.io</a></p>
    </Dialog>
  );
}

function FinetunePanel({ finetunes, projects, onRefresh, onCreate, hasKey }) {
  const [o, setO] = useState({ name: '', genre: '', source: 'rated4' });
  const [busy, setBusy] = useState('');
  const set = (k) => (e) => setO({ ...o, [k]: e.target.value });
  return (
    <>
      {finetunes.length ? finetunes.map((f) => (
        <div key={f.id} className="row" style={{ fontSize: 13 }}>
          <span className="grow ell">{f.name} <span className="dim">· {f.primary_genre || ''} · {f.model_id}</span></span>
          <span style={{ color: f.status === 'completed' ? 'var(--good)' : f.status === 'failed' || f.status === 'blocked' ? 'var(--bad)' : 'var(--warn)' }}>{f.status}{f.status === 'in_progress' ? ` ${Math.round((f.training_progress || 0) * 100)}%` : ''}</span>
        </div>
      )) : <p className="note">{hasKey ? 'No finetunes yet.' : 'Needs the API key.'}</p>}
      <div className="row" style={{ marginTop: 6, flexWrap: 'wrap' }}>
        <input value={o.name} onChange={set('name')} placeholder="Name (5+ characters)" style={{ maxWidth: 180 }} />
        <input value={o.genre} onChange={set('genre')} placeholder="Primary genre" style={{ maxWidth: 140 }} />
        <select value={o.source} onChange={set('source')} style={{ maxWidth: 220 }}>
          <option value="rated4">Train on my ★★★★+ songs</option>
          <option value="fav">Train on my ♥ favourites</option>
          {projects.map((p) => <option key={p.id} value={p.id}>Album: {p.title}</option>)}
        </select>
        <button disabled={!hasKey || o.name.trim().length < 5 || !!busy} onClick={async () => { setBusy('Uploading…'); await onCreate(o); setBusy(''); }}>{busy || 'Create finetune'}</button>
        <button className="mini" onClick={onRefresh} disabled={!hasKey}>↻</button>
      </div>
      <p className="note">Uploads up to 50 of those songs' audio to ElevenLabs to train a private finetune. When it's completed, pick it per track under ▸ More (with a strength).</p>
    </>
  );
}
