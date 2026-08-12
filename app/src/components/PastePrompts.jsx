import { useMemo, useState } from 'react';
import Dialog from './Dialog.jsx';
import { parsePromptBlob } from '../album/skeleton.js';

// Turn a pasted block of prompts (e.g. from a Claude chat) into a new album full of song tracks.
export default function PastePrompts({ onClose, onCreate }) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const items = useMemo(() => parsePromptBlob(text), [text]);
  return (
    <Dialog title="New album from pasted prompts" onClose={onClose} width={640}
      footer={<><button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!items.length} onClick={() => onCreate(title.trim(), items)}>Create album ({items.length} track{items.length === 1 ? '' : 's'})</button></>}>
      <label>Album title</label>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Neon Rain" />
      <label>Prompts — numbered lines (“Title — prompt” / “Title: prompt”), or headings/blocks separated by blank lines</label>
      <textarea rows={12} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false}
        placeholder={'1. Neon Rain — darksynth, heavy arps, 120 BPM\n2. Steel Sky: ambient drone, distant choirs\n\nOr paste headings + paragraphs straight from a chat.'} />
      {!!items.length && (
        <p className="note">Parsed {items.length} track{items.length === 1 ? '' : 's'}: {items.slice(0, 8).map((it, i) => it.title || `Track ${i + 1}`).join(' · ')}{items.length > 8 ? ' · …' : ''}</p>
      )}
    </Dialog>
  );
}
