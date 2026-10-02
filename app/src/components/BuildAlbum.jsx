import { useMemo, useState } from 'react';
import Dialog from './Dialog.jsx';
import { parsePromptBlob, groupFolderPath } from '../album/skeleton.js';
import { pairItems, promptsFromText } from '../album/library.js';

const AUDIO_RE = /\.(mp3|wav|m4a|aac|ogg|oga|opus|flac|webm)$/i;
const TEXT_RE = /\.(txt|md)$/i;
function pickFiles(folder) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.multiple = true;
    if (folder) input.webkitdirectory = true; else input.accept = 'audio/*,.txt,.md';
    input.onchange = () => resolve([...(input.files || [])]);
    input.oncancel = () => resolve([]);
    input.click();
  });
}

// Build an album from a loose pile: pasted prompts, prompt text files, and audio files. Step 1
// gathers sources; step 2 pairs each prompt with its audio by title (either side may be missing),
// lets you fix the pairing/order/titles, and creates the album. Prompt + audio → a song that's
// already generated; prompt only → a gap to generate; audio only → an upload.
export default function BuildAlbum({ groups, busy, onCreate, onClose }) {
  const [step, setStep] = useState(1);
  const [paste, setPaste] = useState('');
  const [texts, setTexts] = useState([]); // [{ name, text }]
  const [audio, setAudio] = useState([]); // File[]
  const [rows, setRows] = useState([]);
  const [album, setAlbum] = useState({ title: '', group: '', description: '' });
  const paths = useMemo(() => groups.map((g) => groupFolderPath(g, groups)).sort(), [groups]);
  const prompts = useMemo(() => [...parsePromptBlob(paste), ...texts.flatMap((t) => promptsFromText(t.name, t.text, parsePromptBlob))], [paste, texts]);

  async function add(folder) {
    const files = await pickFiles(folder); if (!files.length) return;
    const t = await Promise.all(files.filter((f) => TEXT_RE.test(f.name)).map(async (f) => ({ name: f.name, text: await f.text() })));
    setTexts((x) => [...x, ...t]);
    setAudio((x) => [...x, ...files.filter((f) => AUDIO_RE.test(f.name) && !x.some((y) => y.name === f.name && y.size === f.size))]);
    const dirName = folder && files[0]?.webkitRelativePath?.split('/')[0];
    if (dirName) setAlbum((a) => (a.title ? a : { ...a, title: dirName }));
  }
  function next() { setRows(pairItems(prompts, audio)); setStep(2); }

  const patch = (i, p) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const assign = (i, v) => {
    const file = v === '' ? null : audio[+v];
    // The row the file is taken from keeps its prompt; if it had only that audio, it goes away.
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, file } : file && r.file === file ? (r.prompt ? { ...r, file: null } : null) : r)).filter(Boolean));
  };
  const swap = (i, d) => setRows((rs) => { const n = [...rs]; if (n[i + d]) [n[i], n[i + d]] = [n[i + d], n[i]]; return n; });
  const used = new Set(rows.map((r) => r.file).filter(Boolean));
  const unused = audio.filter((f) => !used.has(f));
  const counts = { both: rows.filter((r) => r.file && r.prompt).length, prompt: rows.filter((r) => !r.file && r.prompt).length, audio: rows.filter((r) => r.file && !r.prompt).length };

  return (
    <Dialog title={`🧩 Build album — ${step === 1 ? '1. Sources' : '2. Pair & create'}`} onClose={onClose} width={step === 1 ? 640 : 900}
      footer={step === 1
        ? <><button onClick={onClose}>Cancel</button><button className="primary" disabled={!prompts.length && !audio.length} onClick={next}>Next: pair ({prompts.length} prompt{prompts.length === 1 ? '' : 's'}, {audio.length} audio) ›</button></>
        : <><button onClick={() => setStep(1)}>‹ Back</button>
          <span className="dim" style={{ fontSize: 12, marginRight: 'auto' }}>{counts.both} paired · {counts.prompt} prompt-only (gaps) · {counts.audio} audio-only</span>
          <button className="primary" disabled={!!busy || !rows.length} onClick={() => onCreate({ ...album, rows })}>{busy || `Create album (${rows.length} track${rows.length === 1 ? '' : 's'})`}</button></>}>
      {step === 1 ? (
        <>
          <label>Paste prompts — numbered “Title — prompt” lines, “Title: prompt”, or headings + paragraphs (e.g. from a Claude chat)</label>
          <textarea rows={9} value={paste} onChange={(e) => setPaste(e.target.value)} spellCheck={false}
            placeholder={'1. Neon Rain — darksynth, heavy arps, 120 BPM\n2. Steel Sky: ambient drone, distant choirs'} />
          <div className="row" style={{ marginTop: 10 }}>
            <button onClick={() => add(false)}>＋ Add files…</button>
            <button onClick={() => add(true)}>＋ Add a folder…</button>
            <span className="dim" style={{ fontSize: 12 }}>Audio, plus .txt/.md prompt files — a text file named like a song is that song’s prompt</span>
          </div>
          {(audio.length > 0 || texts.length > 0) && (
            <div className="wiz-list" style={{ maxHeight: 160, fontSize: 12, marginTop: 8 }}>
              {texts.map((t, i) => <div key={'t' + i}>📝 {t.name} <button className="mini" onClick={() => setTexts((x) => x.filter((_, j) => j !== i))}>✕</button></div>)}
              {audio.map((f, i) => <div key={'a' + i}>🎵 {f.name} <span className="dim">{(f.size / 1048576).toFixed(1)} MB</span> <button className="mini" onClick={() => setAudio((x) => x.filter((_, j) => j !== i))}>✕</button></div>)}
            </div>
          )}
          {!!prompts.length && <p className="note">Parsed {prompts.length} prompt{prompts.length === 1 ? '' : 's'}: {prompts.slice(0, 8).map((p, i) => p.title || `#${i + 1}`).join(' · ')}{prompts.length > 8 ? ' · …' : ''}</p>}
        </>
      ) : (
        <>
          <datalist id="build-paths">{paths.map((p) => <option key={p} value={p} />)}</datalist>
          <div className="row">
            <div className="grow"><label>Album title</label><input value={album.title} onChange={(e) => setAlbum({ ...album, title: e.target.value })} placeholder="e.g. Neon Rain" /></div>
            <div className="grow"><label>Group (pick or type a new path)</label><input list="build-paths" value={album.group} onChange={(e) => setAlbum({ ...album, group: e.target.value })} placeholder="e.g. Imports" /></div>
          </div>
          <label>Description / brief (optional)</label>
          <textarea rows={2} value={album.description} onChange={(e) => setAlbum({ ...album, description: e.target.value })} placeholder="Where these came from, the sound you were going for…" />
          <div className="wiz-list" style={{ maxHeight: 360, marginTop: 10 }}>
            <table>
              <thead><tr><th>#</th><th>Title</th><th>Prompt</th><th>Audio</th><th /></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td className="dim">{i + 1}</td>
                    <td style={{ width: '22%' }}><input value={r.title} onChange={(e) => patch(i, { title: e.target.value })} placeholder={`Track ${i + 1}`} /></td>
                    <td><textarea rows={2} style={{ minHeight: 0 }} value={r.prompt} onChange={(e) => patch(i, { prompt: e.target.value })} placeholder="(no prompt — kept as an upload)" /></td>
                    <td style={{ width: '26%' }}>
                      <select value={r.file ? audio.indexOf(r.file) : ''} onChange={(e) => assign(i, e.target.value)} style={{ borderColor: r.file ? 'var(--good)' : undefined }}>
                        <option value="">— no audio (gap) —</option>
                        {audio.map((f, k) => <option key={k} value={k}>{used.has(f) && f !== r.file ? '↔ ' : ''}{f.name}</option>)}
                      </select>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="mini" onClick={() => swap(i, -1)} disabled={!i}>▲</button>
                      <button className="mini" onClick={() => swap(i, 1)} disabled={i === rows.length - 1}>▼</button>
                      <button className="mini" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="mini" onClick={() => setRows((rs) => [...rs, { title: '', prompt: '', file: null }])}>＋ Row</button>
            {!!unused.length && <button className="mini" onClick={() => setRows((rs) => [...rs, ...unused.map((f) => ({ title: f.name.replace(/\.[^.]+$/, ''), prompt: '', file: f }))])}>＋ Add {unused.length} unused audio file{unused.length === 1 ? '' : 's'}</button>}
            <span className="dim" style={{ fontSize: 12 }}>↔ = already used by another row (picking it moves it here)</span>
          </div>
        </>
      )}
    </Dialog>
  );
}
