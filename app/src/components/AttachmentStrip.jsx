import { useState } from 'react';
import AttachmentPreview from './AttachmentPreview.jsx';

// A row of attachment chips (album or group); clicking one previews it inline below.
export default function AttachmentStrip({ list }) {
  const [open, setOpen] = useState(null);
  if (!list?.length) return null;
  return (
    <div style={{ marginBottom: 10 }}>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        <span className="dim" style={{ fontSize: 12 }}>Attachments:</span>
        {list.map((a) => (
          <button key={a.id} className={`mini${open === a.id ? ' primary' : ''}`} onClick={() => setOpen((x) => (x === a.id ? null : a.id))} title="Preview">{a.kind === 'note' ? '📝' : '📎'} {a.name}</button>
        ))}
      </div>
      {list.filter((a) => a.id === open).map((a) => <AttachmentPreview key={a.id} a={a} />)}
    </div>
  );
}
