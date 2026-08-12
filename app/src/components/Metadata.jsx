import Dialog from './Dialog.jsx';
import { ALBUM_META_FIELDS } from '../album/skeleton.js';

// Edit the album's description (the creative brief the agent reads) + all album metadata fields.
// onChange is an updater: (prev) => next, persisted by the caller.
export default function Metadata({ project, onChange, onClose }) {
  const meta = project.meta || {};
  const setMeta = (k, v) => onChange((p) => ({ ...p, meta: { ...(p.meta || {}), [k]: v } }));

  return (
    <Dialog title="Album description & metadata" onClose={onClose} width={620}
      footer={<button className="primary" onClick={onClose}>Done</button>}>
      <label>Description — the creative brief a separate Claude Code session reads to build the skeleton</label>
      <textarea rows={6} value={project.description || ''} onChange={(e) => onChange((p) => ({ ...p, description: e.target.value }))}
        placeholder="e.g. A 6-track lo-fi concept album about a rainy night city. Melancholic, jazzy, 70–85 BPM. Open with a spoken intro, close with an instrumental." />
      <p className="note">This is written to <code>album.json</code> + <code>AGENT.md</code> in your backup folder.</p>

      <div className="section">Metadata</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
        {ALBUM_META_FIELDS.map((f) => (
          <div key={f.key} style={f.type === 'textarea' ? { gridColumn: '1 / -1' } : undefined}>
            <label>{f.label}</label>
            {f.type === 'textarea'
              ? <textarea value={meta[f.key] || ''} onChange={(e) => setMeta(f.key, e.target.value)} />
              : f.type === 'checkbox'
                ? <label style={{ margin: '4px 0' }}><input type="checkbox" checked={!!meta[f.key]} onChange={(e) => setMeta(f.key, e.target.checked)} style={{ width: 'auto', marginRight: 6 }} />Yes</label>
                : <input type={f.type || 'text'} value={meta[f.key] ?? ''} onChange={(e) => setMeta(f.key, f.type === 'number' ? (e.target.value === '' ? '' : +e.target.value) : e.target.value)} />}
          </div>
        ))}
      </div>
    </Dialog>
  );
}
