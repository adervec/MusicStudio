import { useEffect, useState } from 'react';
import { getClip } from '../state/db.js';
import { decodeBlob } from '../audio/wav.js';

const cache = new Map(); // clipId → Float32Array of peaks (decoded once per clip)

async function computePeaks(clipId, buckets = 160) {
  if (cache.has(clipId)) return cache.get(clipId);
  const blob = await getClip(clipId); if (!blob) return null;
  const ch = (await decodeBlob(blob)).getChannelData(0);
  const step = Math.floor(ch.length / buckets) || 1;
  const peaks = new Float32Array(buckets);
  for (let b = 0; b < buckets; b++) { let max = 0; const s = b * step; for (let i = 0; i < step; i++) { const v = Math.abs(ch[s + i] || 0); if (v > max) max = v; } peaks[b] = max; }
  cache.set(clipId, peaks);
  return peaks;
}

// Compact waveform for a clip. `progress` (0..1) fills the played portion; onSeek(frac) on click.
export default function Waveform({ clipId, progress = 0, onSeek }) {
  const [peaks, setPeaks] = useState(cache.get(clipId) || null);
  useEffect(() => {
    let cancelled = false;
    if (cache.has(clipId)) setPeaks(cache.get(clipId));
    else computePeaks(clipId).then((p) => { if (!cancelled) setPeaks(p); }).catch(() => {});
    return () => { cancelled = true; };
  }, [clipId]);

  const W = 300, H = 34, n = peaks?.length || 0, bw = n ? W / n : 0;
  const playedX = W * Math.max(0, Math.min(1, progress));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 34, cursor: onSeek ? 'pointer' : 'default', display: 'block', margin: '6px 0' }}
      onClick={onSeek ? (e) => { const r = e.currentTarget.getBoundingClientRect(); onSeek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))); } : undefined}>
      {peaks
        ? [...peaks].map((v, i) => { const h = Math.max(1, v * (H - 2)); const x = i * bw; return <rect key={i} x={x} y={(H - h) / 2} width={Math.max(0.6, bw - 0.5)} height={h} fill={x < playedX ? 'var(--accent)' : 'var(--line)'} />; })
        : <rect x="0" y={H / 2 - 1} width={W} height="2" fill="var(--line)" />}
    </svg>
  );
}
