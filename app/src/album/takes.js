// Takes: every generation of a track is kept. The track's own audio fields are its chosen take (the
// "representative"); the others sit in t.takes. Swapping just moves fields between the two shapes.
// Pure — see ../audio/wav.test.mjs.
import { musicCost, ttsCost } from '../state/pricing.js';
import { planMs } from '../api/music.js';

const AUDIO = ['clipId', 'durationMs', 'sizeBytes', 'mime', 'backupFile', 'seed', 'songId', 'qc', 'lrc'];

// take → the fields it sets on the track when chosen.
export function takeToRep(k) {
  const o = {}; for (const f of AUDIO) o[f] = k[f] ?? null;
  return { ...o, repId: k.id, genAt: k.at || 0, genMeta: k.meta || null, genPlan: k.plan || null, genModel: k.model || null, takeNote: k.note || '' };
}
// the track's current audio → a take (so choosing another take never loses it).
export function repAsTake(tk) {
  const o = {}; for (const f of AUDIO) o[f] = tk[f] ?? null;
  return { ...o, id: tk.repId || `k_${(tk.clipId || '').slice(-8)}`, at: tk.genAt || 0, meta: tk.genMeta || null, plan: tk.genPlan || null, model: tk.genModel || null, note: tk.takeNote || '' };
}
// Make take `takeId` the track's audio; the old audio becomes a take in its place.
export function chooseTake(tk, takeId) {
  const k = (tk.takes || []).find((x) => x.id === takeId); if (!k) return tk;
  return { ...tk, ...takeToRep(k), takes: (tk.takes || []).map((x) => (x.id === takeId ? repAsTake(tk) : x)).filter((x) => x.clipId) };
}
// Spend estimate for a set of tracks about to be queued.
export function estimateJobs(tracks, { takes = 1, model = () => '', kind = '' } = {}) {
  let usd = 0, ms = 0, n = 0; const lines = [];
  for (const tk of tracks) {
    if (kind === 'stems') { n++; lines.push({ title: tk.title, detail: 'stem separation · credits (price unpublished)' }); continue; }
    if (kind === 'video') { n++; lines.push({ title: tk.title, detail: `score ${tk.videoCount || 1} video clip(s) · credits by length` }); continue; }
    if (tk.type === 'sfx') { n++; lines.push({ title: tk.title, detail: `sound effect${tk.sfxDuration ? ` · ${tk.sfxDuration}s` : ''} · credits` }); continue; }
    if (tk.type === 'music') {
      const k = Math.max(1, Math.min(4, tk.takesN || takes)), len = tk.usePlan && tk.plan?.chunks?.length ? planMs(tk.plan) : (tk.lengthMs || 60000);
      usd += musicCost(len) * k; ms += len * k; n += k;
      lines.push({ title: tk.title, detail: `${k} take${k > 1 ? 's' : ''} × ${Math.round(len / 1000)}s · ${model(tk)}${tk.usePlan ? ' · plan' : ''}` });
    } else if (tk.type === 'dialog') { const c = (tk.text || '').trim().length; usd += ttsCost(c); n++; lines.push({ title: tk.title, detail: `${c} chars · ${tk.ttsModel || 'tts'}` }); }
    else { n++; lines.push({ title: tk.title, detail: tk.type }); }
  }
  return { usd, ms, count: n, lines };
}
