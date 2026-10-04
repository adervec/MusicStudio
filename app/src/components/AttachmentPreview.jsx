import { useEffect, useRef, useState } from 'react';
import { getAttachment } from '../state/db.js';
import { download } from '../backup/fs.js';
import { renderMarkdown, parseCsv } from '../album/markdown.js';

const fmtSize = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : n >= 1e3 ? Math.round(n / 1e3) + ' KB' : (n || 0) + ' B');
const TEXT_RE = /\.(md|markdown|txt|json|csv|tsv|log|lrc|srt|vtt|html?|xml|css|js|yaml|yml|ini)$/i;

// What a file is, for picking its view. Notes are markdown.
function kindOf(name, mime) {
  if (/\.html?$/i.test(name) || mime === 'text/html') return 'html';
  if (/\.(md|markdown)$/i.test(name) || mime === 'text/markdown') return 'md';
  if (/\.json$/i.test(name) || mime === 'application/json') return 'json';
  if (/\.(csv|tsv)$/i.test(name) || mime === 'text/csv') return 'csv';
  if (/\.svg$/i.test(name) || mime === 'image/svg+xml') return 'svg';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (mime === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
  if (mime.startsWith('text/') || TEXT_RE.test(name)) return 'text';
  return 'other';
}
const HAS_SOURCE = new Set(['html', 'md', 'json', 'csv', 'svg']);

// Inline preview of one album attachment, styled the way the file means to look: HTML renders as a
// page (sandboxed: its scripts run, but with no access to this app, its storage or your API key),
// Markdown/JSON/CSV get rich views with a Source toggle, media plays natively. Toolbar: fullscreen,
// download.
export default function AttachmentPreview({ a }) {
  const [st, setSt] = useState({ loading: true });
  const [source, setSource] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    let url = null, live = true;
    (async () => {
      const rec = await getAttachment(a.id);
      if (!live) return;
      if (!rec) return setSt({ missing: true });
      const blob = rec.kind === 'note' ? new Blob([rec.text || ''], { type: 'text/markdown' }) : rec.blob;
      const kind = rec.kind === 'note' ? 'md' : kindOf(a.name || '', blob?.type || a.mime || '');
      const text = ['html', 'md', 'json', 'csv', 'svg', 'text'].includes(kind) ? await blob.text() : null;
      if (['image', 'svg', 'audio', 'video', 'pdf'].includes(kind)) url = URL.createObjectURL(blob);
      if (live) setSt({ kind, text, url, blob });
    })();
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [a.id, a.name, a.mime]);

  if (st.loading) return <div className="att-card"><div className="att-body dim">Loading…</div></div>;
  if (st.missing) return <div className="att-card"><div className="att-body dim">This attachment's content isn't in the browser store.</div></div>;
  const { kind, text, url, blob } = st;
  const showSource = source && HAS_SOURCE.has(kind);

  let body;
  if (showSource) body = <pre className="att-body att-code">{text}</pre>;
  else if (kind === 'html') body = <iframe className="att-body att-frame" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms" srcDoc={text} title={a.name} />;
  else if (kind === 'md') body = <div className="att-body att-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />; // escaped by renderMarkdown
  else if (kind === 'json') {
    let pretty = text; try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { /* show as-is */ }
    body = <pre className="att-body att-code">{pretty}</pre>;
  } else if (kind === 'csv') {
    const rows = parseCsv(text, /\.tsv$/i.test(a.name) ? '\t' : ',');
    body = (
      <div className="att-body att-table">
        <table><thead><tr>{(rows[0] || []).map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
          <tbody>{rows.slice(1, 1001).map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table>
        {rows.length > 1001 && <p className="note">First 1,000 rows of {rows.length - 1}.</p>}
      </div>
    );
  } else if (kind === 'image' || kind === 'svg') body = <div className="att-body att-media"><img src={url} alt={a.name} /></div>; // <img> never runs SVG scripts
  else if (kind === 'audio') body = <div className="att-body"><audio src={url} controls style={{ width: '100%' }} /></div>;
  else if (kind === 'video') body = <div className="att-body att-media"><video src={url} controls /></div>;
  else if (kind === 'pdf') body = <iframe className="att-body att-frame" src={url} title={a.name} />;
  else if (kind === 'text') body = <pre className="att-body att-code">{text}</pre>;
  else body = <div className="att-body dim">No preview for this file type — download it to open.</div>;

  return (
    <div className="att-card" ref={box}>
      <div className="att-bar">
        <span className="att-name">{a.kind === 'note' ? '📝' : '📎'} {a.name}</span>
        <span className="badge">{kind}</span>
        <span className="dim" style={{ fontSize: 11 }}>{fmtSize(blob?.size || a.size)}</span>
        <div className="grow" />
        {HAS_SOURCE.has(kind) && (
          <span className="att-seg">
            <button className={`mini${!source ? ' primary' : ''}`} onClick={() => setSource(false)}>Rendered</button>
            <button className={`mini${source ? ' primary' : ''}`} onClick={() => setSource(true)}>Source</button>
          </span>
        )}
        <button className="mini" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : box.current?.requestFullscreen?.())} title="Fullscreen (Esc to exit)">⤢</button>
        <button className="mini" onClick={() => download(blob, a.kind === 'note' ? `${a.name || 'note'}.md` : a.name)} title="Download">⤓</button>
      </div>
      {body}
    </div>
  );
}
