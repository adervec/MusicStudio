import { useEffect, useState } from 'react';
import { getAttachment } from '../state/db.js';
import { download } from '../backup/fs.js';
import { renderMarkdown } from '../album/markdown.js';

const TEXT_RE = /\.(md|markdown|txt|json|csv|log|lrc|srt)$/i;

// Inline preview of one album attachment: notes and .md render as Markdown, other text as-is,
// images/audio/PDF natively; anything else offers a download.
export default function AttachmentPreview({ a }) {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let url = null, live = true;
    (async () => {
      const rec = await getAttachment(a.id);
      if (!live) return;
      if (!rec) return setState({ missing: true });
      if (rec.kind === 'note') return setState({ md: rec.text || '' });
      const blob = rec.blob, mime = blob?.type || a.mime || '';
      if (mime.startsWith('text/') || TEXT_RE.test(a.name)) {
        const text = await blob.text();
        return live && setState(/\.(md|markdown)$/i.test(a.name) || mime === 'text/markdown' ? { md: text } : { text });
      }
      url = URL.createObjectURL(blob);
      setState({ url, mime, blob });
    })();
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [a.id, a.name, a.mime]);

  if (state.loading) return <div className="dim att-preview">Loading…</div>;
  if (state.missing) return <div className="dim att-preview">This attachment's content isn't in the browser store.</div>;
  if (state.md != null) return <div className="att-preview md" dangerouslySetInnerHTML={{ __html: renderMarkdown(state.md) }} />; // escaped by renderMarkdown
  if (state.text != null) return <pre className="att-preview">{state.text}</pre>;
  const { url, mime, blob } = state;
  if (mime.startsWith('image/')) return <div className="att-preview"><img src={url} alt={a.name} style={{ maxWidth: '100%', maxHeight: 420 }} /></div>;
  if (mime.startsWith('audio/')) return <div className="att-preview"><audio src={url} controls style={{ width: '100%' }} /></div>;
  if (mime === 'application/pdf') return <iframe className="att-preview" src={url} title={a.name} style={{ width: '100%', height: 480, border: 0 }} />;
  return <div className="att-preview dim">No preview for this file type. <button className="mini" onClick={() => download(blob, a.name)}>⤓ Download</button></div>;
}
