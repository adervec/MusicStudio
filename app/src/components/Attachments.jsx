import { useState } from 'react';
import Dialog from './Dialog.jsx';
import { pickFile } from '../backup/fs.js';
import AttachmentPreview from './AttachmentPreview.jsx';
import { t, fmtNum } from '../i18n.js';

const fmtSize = (n) => (n >= 1e6 ? fmtNum(n / 1e6, 1) + ' MB' : n >= 1e3 ? fmtNum(Math.round(n / 1e3), 0) + ' KB' : fmtNum(n || 0, 0) + ' B');
const icon = (a) => (a.kind === 'note' ? '📝' : '📎');

// Attach reference material to an album — style guides, inspirations, notes (typed or AI-generated
// pasted text), or uploaded files. Everything is written to the album's attachments/ folder so a
// separate Claude Code session can read it. onAddNote/onAddFiles/onDelete persist + back up; previews
// render inline (AttachmentPreview); onDownload saves a file.
export default function Attachments({ title = 'Album attachments', where = 'album', project, onAddNote, onAddFiles, onDelete, onDownload, onClose }) {
  const list = project.attachments || [];
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [source, setSource] = useState('hand');
  const [openId, setOpenId] = useState(null);

  async function addNote() {
    if (!text.trim()) return;
    await onAddNote({ name: name.trim() || 'Note', text, source });
    setName(''); setText('');
  }
  async function addFiles() { const files = await pickFile('*/*'); if (files.length) await onAddFiles(files, source); }
  const toggle = (a) => setOpenId((x) => (x === a.id ? null : a.id));

  return (
    <Dialog title={title} onClose={onClose} width={620} footer={<button className="primary" onClick={onClose}>{t('Done')}</button>}>
      <p className="note">{t('Liner notes, style guides, inspirations and references for this {where}. Each is saved to', { where: where })}{' '}<code>{`<${where}>/attachments/`}</code>{' '}{t('in your backup folder so an external Claude Code session can read it while building the skeleton.')}</p>

      <div className="section">{t('Add')}</div>
      <div className="row" style={{ gap: 8 }}>
        <label style={{ margin: 0 }}>{t('Source:')}</label>
        <label style={{ margin: 0 }}><input type="radio" checked={source === 'hand'} onChange={() => setSource('hand')} style={{ width: 'auto', marginRight: 4 }} />{t('By hand')}</label>
        <label style={{ margin: 0 }}><input type="radio" checked={source === 'ai'} onChange={() => setSource('ai')} style={{ width: 'auto', marginRight: 4 }} />{t('AI-generated')}</label>
      </div>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Note title (e.g. Style guide, Mood board notes)')} style={{ marginTop: 6 }} />
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Write or paste a note / style guide / inspiration…')} rows={4} style={{ marginTop: 6 }} />
      <div className="row" style={{ marginTop: 6 }}>
        <button onClick={addNote} disabled={!text.trim()}>{t('＋ Add note')}</button>
        <button onClick={addFiles}>{t('⭱ Attach file(s)')}</button>
      </div>

      <div className="section">{t('Attached ({count})', { count: list.length })}</div>
      {!list.length && <p className="note">{t('Nothing attached yet.')}</p>}
      {list.map((a) => (
        <div key={a.id} className="track" style={{ padding: '8px 10px' }}>
          <div className="track-head">
            <span>{icon(a)}</span>
            <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
            <span className={`badge ${a.source === 'ai' ? 'dialog' : ''}`}>{a.source === 'ai' ? t('AI') : 'hand'}</span>
            <span className="dim" style={{ fontSize: 11 }}>{fmtSize(a.size)}</span>
            <button className="mini" onClick={() => toggle(a)}>{openId === a.id ? t('Hide') : t('View')}</button>
            {a.kind !== 'note' && <button className="mini" onClick={() => onDownload(a)} title={t('Download')}>⤓</button>}
            <button className="mini danger" onClick={() => onDelete(a)}>🗑</button>
          </div>
          {openId === a.id && <AttachmentPreview a={a} />}
        </div>
      ))}
    </Dialog>
  );
}
