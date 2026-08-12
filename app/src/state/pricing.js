// Rough cost estimates + aggregation for the spend dashboard. Prices are APPROXIMATE public list
// rates and vary by plan — the dashboard labels figures "estimated". Pure; see pricing.test.mjs.

// Eleven Music: $0.15 per minute of generated audio (billed on requested length).
export const MUSIC_USD_PER_MIN = 0.15;
export function musicCost(ms = 0) { return (ms / 60000) * MUSIC_USD_PER_MIN; }

// ElevenLabs TTS (dialog): bills ≈ 1 credit/char; a rough $/char just for a ballpark figure.
export const TTS_USD_PER_CHAR = 0.00018; // ≈ $0.18 / 1,000 chars
export function ttsCost(chars = 0) { return chars * TTS_USD_PER_CHAR; }

const dayOf = (ts) => new Date(ts).toISOString().slice(0, 10);

// Aggregate usage records → dashboard totals. Each entry: { ts, kind:'music'|'tts', model, source,
// ms?, chars?, costUsd }.
export function summarizeUsage(entries) {
  const s = {
    music: { calls: 0, ms: 0, cost: 0 },
    tts: { calls: 0, chars: 0, cost: 0 },
    byModel: {}, byDay: {}, total: 0, calls: 0,
  };
  for (const e of entries || []) {
    const cost = e.costUsd || 0;
    s.total += cost; s.calls++;
    const day = dayOf(e.ts || 0);
    const d = s.byDay[day] || { cost: 0, calls: 0 };
    d.cost += cost; d.calls++; s.byDay[day] = d;
    const m = s.byModel[e.model] || { kind: e.kind, calls: 0, ms: 0, chars: 0, cost: 0 };
    m.calls++; m.ms += e.ms || 0; m.chars += e.chars || 0; m.cost += cost; s.byModel[e.model] = m;
    if (e.kind === 'tts') { s.tts.calls++; s.tts.chars += e.chars || 0; s.tts.cost += cost; }
    else { s.music.calls++; s.music.ms += e.ms || 0; s.music.cost += cost; }
  }
  return s;
}

export const fmtUsd = (n) => (n >= 0.005 ? '$' + n.toFixed(2) : n > 0 ? '<$0.01' : '$0.00');
export function fmtDuration(ms) {
  const s = Math.round((ms || 0) / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}
