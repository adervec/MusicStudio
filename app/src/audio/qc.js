// Quality check for a generated take: cheap signal metrics that catch broken generations (silent,
// clipped, very quiet, long dead air) and rank takes for best-of-N. Pure — channels are
// Float32Arrays (see ./wav.js decode). ponytail: signal health only, not musical quality; a model-based
// judge would be the upgrade.
const db = (x) => (x > 0 ? 20 * Math.log10(x) : -120);

export function qcMetrics(channels, sampleRate) {
  const n = channels[0]?.length || 0;
  if (!n) return { peakDb: -120, rmsDb: -120, clipPct: 0, silencePct: 100, leadSec: 0, tailSec: 0, maxGapSec: 0, durSec: 0 };
  let peak = 0, sum = 0, clipped = 0;
  const win = Math.max(1, Math.round(sampleRate * 0.05)), wins = Math.ceil(n / win);
  const loud = new Uint8Array(wins);
  for (let w = 0; w < wins; w++) {
    let ws = 0; const end = Math.min(n, (w + 1) * win);
    for (let i = w * win; i < end; i++) {
      let s = 0;
      for (const ch of channels) { const v = ch[i]; const a = v < 0 ? -v : v; if (a > peak) peak = a; if (a >= 0.999) clipped++; s += v * v; }
      s /= channels.length; ws += s; sum += s;
    }
    loud[w] = db(Math.sqrt(ws / (end - w * win))) > -50 ? 1 : 0;
  }
  let silent = 0, gap = 0, maxGap = 0;
  for (let w = 0; w < wins; w++) { if (!loud[w]) { silent++; gap++; if (gap > maxGap) maxGap = gap; } else gap = 0; }
  let lead = 0; while (lead < wins && !loud[lead]) lead++;
  let tail = 0; while (tail < wins - lead && !loud[wins - 1 - tail]) tail++;
  const secs = (w) => +(w * win / sampleRate).toFixed(2);
  return {
    peakDb: +db(peak).toFixed(1), rmsDb: +db(Math.sqrt(sum / n)).toFixed(1),
    clipPct: +((clipped / (n * channels.length)) * 100).toFixed(3), silencePct: +((silent / wins) * 100).toFixed(1),
    leadSec: secs(lead), tailSec: secs(tail), maxGapSec: secs(maxGap), durSec: +(n / sampleRate).toFixed(2),
  };
}

// Metrics → { score 0–100, grade, flags[] }. Penalties for the failure modes that matter in practice.
export function qcGrade(m, expectedSec = 0) {
  const flags = []; let score = 100;
  if (m.silencePct >= 95) { flags.push('silent'); score -= 90; }
  else {
    if (m.rmsDb < -35) { flags.push('very quiet'); score -= 25; }
    if (m.clipPct > 0.5) { flags.push('clipping'); score -= Math.min(40, m.clipPct * 10); }
    if (m.maxGapSec > 4 && m.maxGapSec < m.durSec - 1) { flags.push(`${m.maxGapSec.toFixed(0)}s gap`); score -= 15; }
    if (m.leadSec > 3) { flags.push('slow start'); score -= 10; }
    if (m.tailSec > 6) { flags.push('long silent tail'); score -= 10; }
    if (expectedSec && m.durSec < expectedSec * 0.6) { flags.push('too short'); score -= 20; }
  }
  score = Math.max(0, Math.round(score));
  return { score, grade: score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F', flags };
}
