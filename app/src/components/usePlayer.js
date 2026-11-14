import { createContext, createElement, useContext, useEffect, useRef, useState } from 'react';
import { getClip } from '../state/db.js';

// ONE app-wide player (like a streaming site's mini-player): a queue of tracks that keeps playing
// across navigation, editable (play any item, remove, reorder, add next / add to end, clear upcoming),
// with shuffle and repeat (off / all / one). Every view calls usePlayer() and gets the same instance;
// <PlayerBar> shows it. The queue is the play order itself — shuffle reorders what's upcoming and
// un-shuffle restores the original order.
const Ctx = createContext(null);
export const usePlayer = () => useContext(Ctx);

const shuffled = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const ready = (list) => (list || []).filter((tk) => tk?.clipId);

export function PlayerProvider({ children }) {
  const audioRef = useRef(null), urlRef = useRef(null);
  const [queue, setQueueS] = useState([]); const queueRef = useRef([]);
  const [index, setIndexS] = useState(-1); const indexRef = useRef(-1);
  const origRef = useRef(null); // queue before shuffling (null = not shuffled / edited since)
  const [playing, setPlaying] = useState(null);
  const [paused, setPaused] = useState(false);
  const [cur, setCur] = useState(0), [dur, setDur] = useState(0);
  const [shuffle, setShuffle] = useState(false); const shuffleRef = useRef(false);
  const [repeat, setRepeat] = useState('off'); const repeatRef = useRef('off');
  useEffect(() => { repeatRef.current = repeat; }, [repeat]);
  if (!audioRef.current) audioRef.current = typeof Audio !== 'undefined' ? new Audio() : null;
  const setQ = (q) => { queueRef.current = q; setQueueS(q); };
  const setI = (i) => { indexRef.current = i; setIndexS(i); };

  useEffect(() => {
    const a = audioRef.current; if (!a) return;
    a.ontimeupdate = () => setCur(a.currentTime || 0);
    a.onloadedmetadata = () => setDur(a.duration || 0);
    a.onended = () => { if (repeatRef.current === 'one') load(indexRef.current); else next(true); };
    return () => { a.pause(); a.onended = a.ontimeupdate = a.onloadedmetadata = null; if (urlRef.current) URL.revokeObjectURL(urlRef.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard: Space = play/pause, →/← = next/prev (unless typing in a field).
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

  async function load(i) {
    const q = queueRef.current, tk = q[i], a = audioRef.current;
    if (!tk || !a) return;
    setI(i); setPlaying(tk.id); setCur(0);
    const blob = await getClip(tk.clipId);
    if (indexRef.current !== i) return; // another load won the race
    if (!blob) { next(true); return; } // clip gone — skip it
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = URL.createObjectURL(blob);
    a.src = urlRef.current; a.volume = Math.max(0, Math.min(1, tk.gain ?? 1));
    try { await a.play(); setPaused(false); } catch { setPaused(true); }
  }
  function stop() { const a = audioRef.current; if (a) a.pause(); setQ([]); setI(-1); setPlaying(null); setPaused(false); origRef.current = null; }
  function togglePause() {
    const a = audioRef.current; if (!a || indexRef.current < 0) return;
    if (a.ended || (a.paused && a.currentTime >= (a.duration || Infinity) - 0.05)) return load(indexRef.current);
    if (a.paused) { a.play().catch(() => {}); setPaused(false); } else { a.pause(); setPaused(true); }
  }
  // Replace the queue with `list`, starting at its item `start`.
  function playQueue(list, start = 0) {
    const r = ready(list); if (!r.length) return;
    const s = Math.max(0, Math.min(start, r.length - 1));
    if (shuffleRef.current) { origRef.current = r; setQ([r[s], ...shuffled(r.filter((_, i) => i !== s))]); load(0); }
    else { origRef.current = null; setQ(r); load(s); }
  }
  function play(tk, list) {
    if (playing === tk.id) return togglePause();
    const r = ready(list?.length ? list : [tk]);
    playQueue(r, Math.max(0, r.findIndex((x) => x.id === tk.id)));
  }
  function next(auto = false) {
    let i = indexRef.current + 1;
    if (i >= queueRef.current.length) {
      if (repeatRef.current === 'all' && queueRef.current.length) i = 0;
      else { if (auto) { setPaused(true); } return; } // end of queue: stay on the last track, paused
    }
    load(i);
  }
  function prev() {
    const a = audioRef.current; if (a && a.currentTime > 3) { a.currentTime = 0; return; }
    let i = indexRef.current - 1;
    if (i < 0) i = repeatRef.current === 'all' ? queueRef.current.length - 1 : 0;
    load(i);
  }
  const seek = (s) => { const a = audioRef.current; if (a) { a.currentTime = s; setCur(s); } };
  function toggleShuffle() {
    const nv = !shuffleRef.current; shuffleRef.current = nv; setShuffle(nv);
    const q = queueRef.current, i = indexRef.current; if (!q.length) return;
    const curT = q[i];
    if (nv) { origRef.current = q; setQ([...q.slice(0, i + 1), ...shuffled(q.slice(i + 1))]); }
    else if (origRef.current) { const o = origRef.current; origRef.current = null; setQ(o); setI(Math.max(0, o.findIndex((x) => x.id === curT?.id))); }
  }
  const cycleRepeat = () => setRepeat((r) => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off'));

  // ── Queue editing ──
  const edited = () => { origRef.current = null; };
  function enqueue(list, { next: asNext = false } = {}) {
    const r = ready(list); if (!r.length) return;
    if (!queueRef.current.length) return playQueue(r, 0);
    const q = [...queueRef.current], at = asNext ? indexRef.current + 1 : q.length;
    q.splice(at, 0, ...r); setQ(q); edited();
  }
  function removeAt(i) {
    const q = [...queueRef.current]; if (i < 0 || i >= q.length) return;
    q.splice(i, 1); edited();
    if (!q.length) return stop();
    setQ(q);
    if (i < indexRef.current) setI(indexRef.current - 1);
    else if (i === indexRef.current) load(Math.min(i, q.length - 1));
  }
  function moveItem(i, d) {
    const q = [...queueRef.current], j = i + d; if (j < 0 || j >= q.length) return;
    [q[i], q[j]] = [q[j], q[i]]; setQ(q); edited();
    if (indexRef.current === i) setI(j); else if (indexRef.current === j) setI(i);
  }
  function clearUpcoming() { setQ(queueRef.current.slice(0, indexRef.current + 1)); edited(); }

  const value = {
    queue, index, playing, paused, cur, dur, shuffle, repeat,
    pos: { idx: index, total: queue.length },
    playQueue, play, togglePause, stop, next: () => next(false), prev, seek, toggleShuffle, cycleRepeat,
    enqueue, removeAt, moveItem, playIndex: load, clearUpcoming,
  };
  return createElement(Ctx.Provider, { value }, children);
}
