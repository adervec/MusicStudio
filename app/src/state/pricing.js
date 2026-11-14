import { t, fmtNum, fmtDate } from '../i18n.js';
// Rough cost estimates + aggregation for the spend dashboard. Prices are APPROXIMATE public list
// rates and vary by plan — the dashboard labels figures "estimated". Pure; see pricing.test.mjs.

// Eleven Music: $0.15 per minute of generated audio (billed on requested length).
export const MUSIC_USD_PER_MIN = 0.15;
export function musicCost(ms = 0) { return (ms / 60000) * MUSIC_USD_PER_MIN; }

// ElevenLabs TTS (dialog): bills ≈ 1 credit/char; a rough $/char just for a ballpark figure.
export const TTS_USD_PER_CHAR = 0.00018; // ≈ $0.18 / 1,000 chars
export function ttsCost(chars = 0) { return chars * TTS_USD_PER_CHAR; }

// the LOCAL calendar day of a spend (toISOString is UTC, which would file a 22:00 spend at UTC-3 under tomorrow)
const dayOf = (ts) => { const d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

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

// Money and counts in the reader's shared locale (font.js); plain English formatting in tests.
const loc = () => (typeof window !== 'undefined' && window.appFont?.locale?.()) || 'en';
const usd = (n) => { try { return new Intl.NumberFormat(loc(), { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n); } catch { return '$' + n.toFixed(2); } };
export const fmtUsd = (n) => (n >= 0.005 ? usd(n) : n > 0 ? '<' + usd(0.01) : usd(0));
export function fmtDuration(ms) {
  const s = Math.round((ms || 0) / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

// Credit-pool bar helpers (topbar 💲 Spend + dashboard).
export const poolFrac = (c) => (c?.limit ? Math.min(1, c.used / c.limit) : 0);
export const poolColor = (c) => { const f = c.used / c.limit; return f >= 0.9 ? 'var(--bad)' : f >= 0.75 ? 'var(--warn)' : 'var(--accent)'; };
export const poolTitle = (c) => (c?.limit ? t('ElevenLabs credits: {used} of {limit} used ({pct}%) · {left} left{reset}{tier}', {
  used: fmtNum(c.used, 0), limit: fmtNum(c.limit, 0), pct: Math.round((c.used / c.limit) * 100), left: fmtNum(c.remaining, 0),
  reset: c.resetAt ? t(' · resets {date}', { date: fmtDate(c.resetAt) }) : '', tier: c.tier ? ` · ${c.tier}` : '' }) : t('Spend dashboard'));
