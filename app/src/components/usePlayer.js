import { useEffect, useRef, useState } from 'react';
import { getClip } from '../state/db.js';

// Shared audio transport for a queue of tracks: play/pause, prev/next, seek, shuffle, and repeat
// (off / all / one). Order is a permutation of the queue so shuffle can be toggled mid-play. Used by
// the editor, group view, and playlists.
function makeOrder(n, shuffled, first = 0) {
  const idx = [...Array(n).keys()];
  if (shuffled) {
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    const p = idx.indexOf(first); if (p > 0) { [idx[0], idx[p]] = [idx[p], idx[0]]; } // keep the chosen track first
  }
  return idx;
}

export function usePlayer() {
  const audioRef = useRef(null);
  const urlRef = useRef(null);
  const queueRef = useRef([]); // base tracks
  const orderRef = useRef([]); // indices into queue, in play order
  const posRef = useRef(0);    // index into orderRef
  const [playing, setPlaying] = useState(null);
  const [paused, setPaused] = useState(false);
  const [pos, setPos] = useState({ idx: 0, total: 0 });
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState('off'); // 'off' | 'all' | 'one'
  const shuffleRef = useRef(false); const repeatRef = useRef('off');
  useEffect(() => { shuffleRef.current = shuffle; }, [shuffle]);
  useEffect(() => { repeatRef.current = repeat; }, [repeat]);
  if (!audioRef.current) audioRef.current = typeof Audio !== 'undefined' ? new Audio() : null;

  useEffect(() => {
    const a = audioRef.current; if (!a) return;
    a.ontimeupdate = () => setCur(a.currentTime || 0);
    a.onloadedmetadata = () => setDur(a.duration || 0);
    return () => { a.pause(); a.onended = a.ontimeupdate = a.onloadedmetadata = null; if (urlRef.current) URL.revokeObjectURL(urlRef.current); };
  }, []);

  // Keyboard: Space = play/pause, →/← = next/prev track (unless typing in a field).
  useEffect(() => {
    const onKey = (e) => {
      if (!playing || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) return;
      if (e.code === 'Space') { e.preventDefault(); togglePause(); }
      else if (e.code === 'ArrowRight') { e.preventDefault(); next(); }
      else if (e.code === 'ArrowLeft') { e.preventDefault(); prev(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playing]); // eslint-disable-line react-hooks/exhaustive-deps

  function stop() { const a = audioRef.current; if (a) { a.pause(); a.onended = null; } setPlaying(null); setPaused(false); queueRef.current = []; orderRef.current = []; }
  function togglePause() { const a = audioRef.current; if (!a) return; if (a.paused) { a.play().catch(() => {}); setPaused(false); } else { a.pause(); setPaused(true); } }

  async function playAt(op) {
    const order = orderRef.current, q = queueRef.current;
    if (op < 0 || op >= order.length) return stop();
    posRef.current = op;
    const t = q[order[op]]; const a = audioRef.current; if (!a || !t) return;
    const blob = await getClip(t.clipId); if (!blob) return;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = URL.createObjectURL(blob);
    a.src = urlRef.current; a.volume = Math.max(0, Math.min(1, t.gain ?? 1));
    a.onended = () => { if (repeatRef.current === 'one') playAt(posRef.current); else next(); };
    try { await a.play(); } catch { /* autoplay/interrupt */ }
    setPlaying(t.id); setPaused(false); setPos({ idx: op, total: order.length });
  }

  function playQueue(list, startBase = 0) {
    const ready = (list || []).filter((t) => t.clipId);
    queueRef.current = ready;
    orderRef.current = makeOrder(ready.length, shuffleRef.current, startBase);
    if (ready.length) playAt(0);
  }
  function play(t, list) {
    if (playing === t.id) return togglePause();
    if (list && list.length) { const ready = list.filter((x) => x.clipId); playQueue(ready, Math.max(0, ready.findIndex((x) => x.id === t.id))); }
    else playQueue([t], 0);
  }
  function next() {
    const order = orderRef.current; let op = posRef.current + 1;
    if (op >= order.length) { if (repeatRef.current === 'all') op = 0; else return stop(); }
    playAt(op);
  }
  function prev() {
    const a = audioRef.current; if (a && a.currentTime > 3) return playAt(posRef.current);
    let op = posRef.current - 1;
    if (op < 0) op = repeatRef.current === 'all' ? orderRef.current.length - 1 : 0;
    playAt(op);
  }
  const seek = (s) => { const a = audioRef.current; if (a) { a.currentTime = s; setCur(s); } };
  function toggleShuffle() {
    const nv = !shuffleRef.current; setShuffle(nv);
    const q = queueRef.current; if (!q.length) return;
    const curBase = orderRef.current[posRef.current] ?? 0;
    orderRef.current = makeOrder(q.length, nv, curBase); posRef.current = 0; setPos({ idx: 0, total: q.length });
  }
  const cycleRepeat = () => setRepeat((r) => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off'));

  return { playing, paused, pos, cur, dur, shuffle, repeat, playQueue, play, togglePause, stop, next, prev, seek, toggleShuffle, cycleRepeat };
}
