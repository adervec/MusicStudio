import { useState } from 'react';
import Dialog from './Dialog.jsx';
import { pickFile } from '../backup/fs.js';

const fmtSize = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : n >= 1e3 ? Math.round(n / 1e3) + ' KB' : (n || 0) + ' B');
const icon = (a) => (a.kind === 'note' ? '📝' : '📎');

// Attach reference material to an album — style guides, inspirations, notes (typed or AI-generated
// pasted text), or uploaded files. Everything is written to the album's attachments/ folder so a
// separate Claude Code session can read it. onAddNote/onAddFiles/onDelete persist + back up; onReadNote
// returns a note's text; onDownload saves a file.
export default function Attachments({ project, onAddNote, onAddFiles, onDelete, onReadNote, onDownload, onClose }) {
  const list = project.attachments || [];
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [source, setSource] = useState('hand');
  const [openId, setOpenId] = useState(null);
  const [openText, setOpenText] = useState('');

  async function addNote() {
    if (!text.trim()) return;
    await onAddNote({ name: name.trim() || 'Note', text, source });
    setName(''); setText('');
  }
  async function addFiles() { const files = await pickFile('*/*'); if (files.length) await onAddFiles(files, source); }
  async function toggle(a) {
    if (openId === a.id) return setOpenId(null);
    if (a.kind === 'note') { setOpenText(await onReadNote(a)); setOpenId(a.id); }
    else onDownload(a);
  }

  return (
    <Dialog title="Album attachments" onClose={onClose} width={620} footer={<button className="primary" onClick={onClose}>Done</button>}>
      <p className="note">Style guides, inspirations, and notes for this album. Each is saved to <code>{'<album>/attachments/'}</code> in your backup folder so an external Claude Code session can read it while building the skeleton.</p>

      <div className="section">Add</div>
      <div className="row" style={{ gap: 8 }}>
        <label style={{ margin: 0 }}>Source:</label>
        <label style={{ margin: 0 }}><input type="radio" checked={source === 'hand'} onChange={() => setSource('hand')} style={{ width: 'auto', marginRight: 4 }} />By hand</label>
        <label style={{ margin: 0 }}><input type="radio" checked={source === 'ai'} onChange={() => setSource('ai')} style={{ width: 'auto', marginRight: 4 }} />AI-generated</label>
      </div>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Note title (e.g. Style guide, Mood board notes)" style={{ marginTop: 6 }} />
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Write or paste a note / style guide / inspiration…" rows={4} style={{ marginTop: 6 }} />
      <div className="row" style={{ marginTop: 6 }}>
        <button onClick={addNote} disabled={!text.trim()}>＋ Add note</button>
        <button onClick={addFiles}>⭱ Attach file(s)</button>
      </div>

      <div className="section">Attached ({list.length})</div>
      {!list.length && <p className="note">Nothing attached yet.</p>}
      {list.map((a) => (
        <div key={a.id} className="track" style={{ padding: '8px 10px' }}>
          <div className="track-head">
            <span>{icon(a)}</span>
            <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
            <span className={`badge ${a.source === 'ai' ? 'dialog' : ''}`}>{a.source === 'ai' ? 'AI' : 'hand'}</span>
            <span className="dim" style={{ fontSize: 11 }}>{fmtSize(a.size)}</span>
            <button className="mini" onClick={() => toggle(a)}>{a.kind === 'note' ? (openId === a.id ? 'Hide' : 'View') : '⤓'}</button>
            <button className="mini danger" onClick={() => onDelete(a)}>🗑</button>
          </div>
          {openId === a.id && a.kind === 'note' && <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, background: 'var(--bg)', padding: 8, borderRadius: 6, marginTop: 6, maxHeight: 200, overflow: 'auto' }}>{openText}</pre>}
        </div>
      ))}
    </Dialog>
  );
}
