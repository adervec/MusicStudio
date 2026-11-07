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
export function repAsTake(t) {
  const o = {}; for (const f of AUDIO) o[f] = t[f] ?? null;
  return { ...o, id: t.repId || `k_${(t.clipId || '').slice(-8)}`, at: t.genAt || 0, meta: t.genMeta || null, plan: t.genPlan || null, model: t.genModel || null, note: t.takeNote || '' };
}
// Make take `takeId` the track's audio; the old audio becomes a take in its place.
export function chooseTake(t, takeId) {
  const k = (t.takes || []).find((x) => x.id === takeId); if (!k) return t;
  return { ...t, ...takeToRep(k), takes: (t.takes || []).map((x) => (x.id === takeId ? repAsTake(t) : x)).filter((x) => x.clipId) };
}
// Spend estimate for a set of tracks about to be queued.
export function estimateJobs(tracks, { takes = 1, model = () => '' } = {}) {
  let usd = 0, ms = 0, n = 0; const lines = [];
  for (const t of tracks) {
    if (t.type === 'music') {
      const k = Math.max(1, Math.min(4, t.takesN || takes)), len = t.usePlan && t.plan?.chunks?.length ? planMs(t.plan) : (t.lengthMs || 60000);
      usd += musicCost(len) * k; ms += len * k; n += k;
      lines.push({ title: t.title, detail: `${k} take${k > 1 ? 's' : ''} × ${Math.round(len / 1000)}s · ${model(t)}${t.usePlan ? ' · plan' : ''}` });
    } else if (t.type === 'dialog') { const c = (t.text || '').trim().length; usd += ttsCost(c); n++; lines.push({ title: t.title, detail: `${c} chars · ${t.ttsModel || 'tts'}` }); }
    else { n++; lines.push({ title: t.title, detail: t.type }); }
  }
  return { usd, ms, count: n, lines };
}
