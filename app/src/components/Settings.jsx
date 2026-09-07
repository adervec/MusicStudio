import { useEffect, useState } from 'react';
import Dialog from './Dialog.jsx';
import { MUSIC_MODELS, TTS_MODELS, listVoices, getSubscription } from '../api/elevenlabs.js';
import { dirPickerSupported } from '../backup/fs.js';

// API key, default models/voice, and the local backup folder. Key + prefs persist on-device.
export default function Settings({ apiKey, prefs, voices, backupName, publishName, onClose, onSave, onVoices, onPickBackup, onClearBackup, onPickPublish, onClearPublish, onManageSync, onExportData, onImportData,
  driveOn, driveEmail, driveAvailable, cloudBusy, onConnectDrive, onDisconnectDrive, onPushCatalog }) {
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

      <div className="section">Defaults</div>
      <label>Music model</label>
      <select value={p.musicModel} onChange={(e) => set('musicModel', e.target.value)}>
        {MUSIC_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select>
      <label>Default song length (seconds)</label>
      <input type="number" min="3" max="600" value={p.defaultLengthSec} onChange={(e) => set('defaultLengthSec', +e.target.value)} />
      <label>Dialog (TTS) model</label>
      <select value={p.ttsModel} onChange={(e) => set('ttsModel', e.target.value)}>
        {TTS_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select>
      <label>Default dialog voice {voices.length ? '' : '(Test the key to load voices)'}</label>
      <select value={p.defaultVoiceId || ''} onChange={(e) => set('defaultVoiceId', e.target.value)}>
        <option value="">— none —</option>
        {voices.map((v) => <option key={v.id} value={v.id}>{v.name}{v.category ? ` (${v.category})` : ''}</option>)}
      </select>
      <label>Gap between album tracks (ms)</label>
      <input type="number" min="0" max="5000" value={p.gapMs} onChange={(e) => set('gapMs', +e.target.value)} />

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
      <p className="note">The browser can't detect this. Paste the folder's absolute path here; then 📂 opens Explorer (when launched via the app's dev server). Otherwise 📂 copies the path.</p>

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
        <div className="grow">{driveOn ? <>Connected{driveEmail ? <> as <b>{driveEmail}</b></> : ''}</> : <span className="dim">Not connected.</span>}</div>
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
