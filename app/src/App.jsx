import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { uid, listProjects, getProject, saveProject, deleteProject, listGroups, saveGroup, deleteGroup, listPlaylists, savePlaylist, deletePlaylist, putAttachment, getAttachment, deleteAttachment, getClip, putClip, deleteClip, getSetting, setSetting, getBackupDir, setBackupDir, clearBackupDir, getPublishDir, setPublishDir, clearPublishDir, exportAllData, importAllData } from './state/db.js';
import { listVoices, listTtsModels, TTS_MODELS, newTrackModel, getSubscription, tts, musicModelFor } from './api/elevenlabs.js';
import GenQueue from './components/GenQueue.jsx';
import ConfirmSpend from './components/ConfirmSpend.jsx';
import { composeBody, composeDetailed, lrcFromWords, toChunks, planMs, uploadSong, inpaintPlan, draftPlan, separateStems, soundEffect, videoToMusic, SFX_MODELS, listFinetunes, createFinetune } from './api/music.js';
import FromSong from './components/FromSong.jsx';
import FromVideo from './components/FromVideo.jsx';
import { qcMetrics, qcGrade } from './audio/qc.js';
import { decodeBlob } from './audio/wav.js';
import { takeToRep, repAsTake, estimateJobs } from './album/takes.js';
import { buildTaste } from './album/taste.js';
import PlayerBar from './components/PlayerBar.jsx';
import { pickBackupDir, ensureWritable, writeToDir, readTextFrom, readBlobFrom, listFiles, removeFromDir, ensureDir, moveDir, removeDir, listAlbumDirs, scanAlbums, looksLikeAppFolder, download, pickFile, canWriteQuietly, setPickerStart, dirAt } from './backup/fs.js';
import { publishAlbum, publishState, publishTargets, masterTargets, coverPicture, retagBlob, renderTrackFile } from './backup/publish.js';
import { planSync } from './backup/sync.js';
import { sanitizeFilename, clipDurationMs } from './audio/wav.js';
import { applyTheme } from './state/themes.js';
import { poolColor, poolTitle } from './state/pricing.js';
import { buildAlbumJson, rootAgentMarkdown, mergeSkeleton, albumFolderPath, groupFolderPath, planImport, planRefresh, trackKey } from './album/skeleton.js';
import Editor from './components/Editor.jsx';
import Sidebar from './components/Sidebar.jsx';
import Settings from './components/Settings.jsx';
import Dashboard from './components/Dashboard.jsx';
import Export from './components/Export.jsx';
import Metadata from './components/Metadata.jsx';
import Attachments from './components/Attachments.jsx';
import Import from './components/Import.jsx';
import Cowork from './components/Cowork.jsx';
import GroupView from './components/GroupView.jsx';
import PlaylistView from './components/PlaylistView.jsx';
import BuildAlbum from './components/BuildAlbum.jsx';
import Reorganize from './components/Reorganize.jsx';
import Library from './components/Library.jsx';
import { ensureGroupPath, pairItems } from './album/library.js';
import DeviceSync from './components/DeviceSync.jsx';
import CloudLibrary from './components/CloudLibrary.jsx';
import { driveConnect, driveDisconnect, driveConnected, driveProfile, driveUploadJson, driveDownloadJson, driveStat, driveClientId, CATALOG_FILE, REQUEST_FILE } from './cloud/drive.js';
import { buildCatalog, buildRequests, requestsPending } from './cloud/catalog.js';

const DEFAULT_PREFS = { confirmSpend: true, takes: 1, phoneticNames: false, c2pa: false, folderHelper: false, musicModel: 'latest', ttsModel: 'eleven_multilingual_v2', defaultVoiceId: '', defaultLengthSec: 60, gapMs: 800, backupPath: '', deviceName: '', driveClientId: '' };
const extOf = (mime, fileName) => (fileName?.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase()) || (mime === 'audio/wav' ? 'wav' : mime === 'audio/mpeg' ? 'mp3' : 'mp3');

export default function App() {
  const [projects, setProjects] = useState([]);
  const [groups, setGroups] = useState([]);
  const [active, setActive] = useState(null);
  const [groupViewId, setGroupViewId] = useState(null); // a group selected for its read-only overview
  const [playlists, setPlaylists] = useState([]);
  const [playlistId, setPlaylistId] = useState(null);
  const activeRef = useRef(null);
  const [expanded, setExpanded] = useState(new Set());
  const [apiKey, setApiKey] = useState('');
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const [voices, setVoices] = useState([]);
  const [ttsModels, setTtsModels] = useState(TTS_MODELS);
  // ElevenLabs credit pool for the 💲 Spend bar: on key change, shortly after every generation, and every 10 min.
  const [credits, setCredits] = useState(null);
  const [finetunes, setFinetunes] = useState([]); // the account's music finetunes (Settings → Finetunes)
  const loadFinetunes = useCallback(() => (apiKey ? listFinetunes(apiKey).then(setFinetunes).catch(() => {}) : null), [apiKey]);
  useEffect(() => { loadFinetunes(); }, [loadFinetunes]);
  useEffect(() => { // poll while one is training
    if (!finetunes.some((f) => f.status === 'pending' || f.status === 'in_progress')) return;
    const iv = setInterval(loadFinetunes, 60000); return () => clearInterval(iv);
  }, [finetunes, loadFinetunes]);
  async function makeFinetune({ name, genre, source }) {
    const pool = projects.flatMap((p) => (p.tracks || []).filter((t) => t.clipId && (source === 'rated4' ? (t.rating || 0) >= 4 : source === 'fav' ? t.fav : p.id === source)));
    if (!pool.length) return showToast('No songs with audio match that choice');
    const files = [];
    for (const t of pool.slice(0, 50)) { const b = await getClip(t.clipId); if (b) files.push({ blob: b, name: t.backupFile || `${sanitizeFilename(t.title || 'track')}.mp3` }); }
    try { await createFinetune({ name: name.trim(), genre: genre.trim(), files, model: musicModelFor({}) }, apiKey); showToast(`🎓 Finetune “${name}” started with ${files.length} songs`); loadFinetunes(); }
    catch (e) { showToast('Finetune failed: ' + (e.message || e)); }
  }
  useEffect(() => {
    if (!apiKey) { setCredits(null); return; }
    let t = null;
    const load = () => getSubscription(apiKey).then(setCredits).catch(() => {});
    const soon = () => { clearTimeout(t); t = setTimeout(load, 2000); };
    load();
    const iv = setInterval(load, 600000);
    window.addEventListener('musicstudio:spent', soon);
    return () => { clearTimeout(t); clearInterval(iv); window.removeEventListener('musicstudio:spent', soon); };
  }, [apiKey]);
  const [dir, setDir] = useState(null);
  const [pubDir, setPubDir] = useState(null); // publish destination (e.g. phone-synced drive)
  const [syncMap, setSyncMap] = useState({}); // projectId → { on, at } — what lives on the device
  const [syncBusy, setSyncBusy] = useState('');
  const [drive, setDrive] = useState(false);      // Drive channel connected this session
  const [catalog, setCatalog] = useState(null);   // library published by the desktop master
  const [requests, setRequests] = useState(null); // sync request published by a phone
  const [cloudBusy, setCloudBusy] = useState('');
  const [showCloud, setShowCloud] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [wizBusy, setWizBusy] = useState('');
  const [modal, setModal] = useState(null);
  // the corner avatar (font.js <app-account>) opens Settings, where Drive sync lives
  useEffect(() => { const open = () => setModal('settings'); document.addEventListener('app-account-click', open); return () => document.removeEventListener('app-account-click', open); }, []); // 'settings' | 'dashboard' | 'export' | 'metadata' | 'attachments' | 'cowork'
  const [sidebarW, setSidebarW] = useState(240);
  const [watch, setWatch] = useState(true);        // auto-reload album.json on external edits
  const [justSynced, setJustSynced] = useState(false);
  const [toast, setToast] = useState('');
  const toastTimer = useRef(null);
  const [ignored, setIgnored] = useState([]);       // root folder names to skip when discovering albums
  const lastJsonRef = useRef(null);                 // album.json text WE last wrote/loaded (self-write guard)
  const syncTimer = useRef(null);
  const importRef = useRef(null);                   // latest importFromFolder, for the periodic scan

  const groupsRef = useRef([]);
  const refreshProjects = useCallback(() => listProjects().then(setProjects), []);
  const refreshGroups = useCallback(() => listGroups().then(setGroups), []);
  const refreshPlaylists = useCallback(() => listPlaylists().then(setPlaylists), []);
  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => { groupsRef.current = groups; }, [groups]);

  // The on-disk path mirrors the group tree (see albumFolderPath); reads the live groups via ref.
  const albumPath = useCallback((p) => albumFolderPath(p, groupsRef.current), []);

  // Apply the active album's group theme (default when no album open). Set the group theme via a picker.
  useEffect(() => {
    const g = active ? groups.find((x) => x.id === active.parentId) : null;
    applyTheme(g?.theme);
  }, [active, groups]);
  async function setGroupTheme(themeKey) {
    const g = groups.find((x) => x.id === activeRef.current?.parentId); if (!g) return;
    await saveGroup({ ...g, theme: themeKey }); refreshGroups();
    applyTheme(themeKey);
  }

  // Every album must live in a group: move any orphan (legacy or discovered at the folder root) into
  // an "Ungrouped" group, on disk too. Reads the DB directly (called after loads/imports).
  async function ensureGrouped(dh) {
    const d = dh || dir;
    const [gs, ps] = await Promise.all([listGroups(), listProjects()]);
    const orphans = ps.filter((p) => !p.parentId);
    if (!orphans.length) return;
    const all = [...gs];
    let g = gs.find((x) => !x.parentId && x.name === 'Ungrouped');
    if (!g) { g = { id: uid('g_'), name: 'Ungrouped', parentId: null }; await saveGroup(g); all.push(g); if (d) { try { if (await ensureWritable(d)) await ensureDir(d, groupFolderPath(g, all)); } catch { /* */ } } }
    for (const p of orphans) {
      const next = { ...p, parentId: g.id };
      await saveProject(next);
      if (d) { try { if (await ensureWritable(d)) await moveDir(d, albumFolderPath(p, gs), albumFolderPath(next, all)); } catch { /* */ } }
    }
  }

  useEffect(() => {
    (async () => {
      const [gs, ps] = await Promise.all([listGroups(), listProjects()]);
      setGroups(gs); setProjects(ps); refreshPlaylists();
      const k = await getSetting('apiKey', '');
      setApiKey(k);
      const savedPrefs = { ...DEFAULT_PREFS, ...(await getSetting('prefs', {})) };
      if (!(await getSetting('musicLatestMigrated', false))) { // one-time: a saved v1/v2 default was never a real choice
        savedPrefs.musicModel = 'latest'; await setSetting('prefs', savedPrefs); await setSetting('musicLatestMigrated', true);
      }
      setPrefs(savedPrefs);
      setSidebarW(await getSetting('sidebarW', 240));
      const ign = await getSetting('ignoredFolders', []);
      setIgnored(ign);
      const h = await getBackupDir();
      setDir(h);
      setPubDir(await getPublishDir());
      setSyncMap(await getSetting('deviceSync', {}));
      if (k) { listVoices(k).then(setVoices).catch(() => {}); listTtsModels(k).then((m) => m.length && setTtsModels(m)).catch(() => {}); }
      // Discover albums created on disk — dedupe against the lists we just loaded (state isn't set yet).
      if (h) await importFromFolder(true, { dir: h, ignored: ign, groups: gs, projects: ps });
      await ensureGrouped(h); // migrate any legacy ungrouped albums
      for (const p of await listProjects()) { // a reload drops the in-memory queue: un-stick its tracks
        if ((p.tracks || []).some((t) => t.status === 'queued' || t.status === 'gen')) await saveProject({ ...p, tracks: p.tracks.map((t) => (t.status === 'queued' || t.status === 'gen' ? { ...t, status: t.clipId ? 'ready' : 'idle' } : t)) }, { keepTime: true });
      }
      await refreshGroups(); await refreshProjects();
      // Reconnect the Drive channel silently (an existing grant only — never a popup on boot).
      if (await getSetting('driveOn', false)) driveRef.current?.({ silent: true });
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll Drive for a phone's sync request. A metadata-only stat decides whether to pull, so the
  // steady state costs one tiny request a minute. The desktop (the one with a publish folder)
  // applies what it finds; a phone just refreshes the catalog it's showing.
  const driveRef = useRef(null); const cloudRef = useRef(null);
  useEffect(() => { driveRef.current = connectDrive; cloudRef.current = pullCloud; });
  useEffect(() => {
    if (!drive) return;
    let last = null, stop = false;
    const tick = async () => {
      try {
        const st = await driveStat(pubDir ? REQUEST_FILE : CATALOG_FILE);
        if (stop || st === last) return;
        const first = last === null; last = st;
        if (!first || pubDir) await cloudRef.current?.({ silent: true });
      } catch { /* offline / token expired — try again next tick */ }
    };
    tick();
    const iv = setInterval(tick, 60000);
    return () => { stop = true; clearInterval(iv); };
  }, [drive, pubDir]);

  const updateProject = useCallback((fn) => {
    const next = fn(activeRef.current);
    activeRef.current = next;
    setActive(next);
    saveProject(next).then(refreshProjects);
  }, [refreshProjects]);

  // Mirror a newly created clip to the backup folder; returns the written filename (or null).
  const backupClip = useCallback(async (track, blob) => {
    if (!dir) return null;
    try {
      if (!(await ensureWritable(dir))) return null;
      const p = activeRef.current;
      const name = `${sanitizeFilename(track.title)}_${(track.clipId || track.id).slice(-5)}.${extOf(blob.type, track.fileName)}`;
      await writeToDir(dir, `${albumPath(p)}/${name}`, blob);
      return name;
    } catch { return null; }
  }, [dir, albumPath]);

  // Expose the album contents (album.json) + agent instructions (AGENT.md) in the backup folder.
  const writeSkeleton = useCallback(async (proj, dh) => {
    const p = (proj && proj.id) ? proj : activeRef.current; // ignore an accidental event arg
    const d = dh || dir;
    if (!p || !d) return;
    try {
      if (!(await ensureWritable(d))) return;
      const jsonText = JSON.stringify(buildAlbumJson(p), null, 2);
      await writeToDir(d, `${albumPath(p)}/album.json`, new Blob([jsonText], { type: 'application/json' }));
      if (p.id === activeRef.current?.id) lastJsonRef.current = jsonText; // so the watcher doesn't treat our own write as an external change
      await writeToDir(d, `AGENT.md`, new Blob([rootAgentMarkdown()], { type: 'text/markdown' })); // one general file at the root
    } catch { /* best-effort */ }
  }, [dir, albumPath]);

  // Backfill: attach pre-existing audio to any track whose album.json carries an `importFile` (a file
  // already in the album folder — e.g. music made before this app). Reads it into the clip store so
  // the track is "ready", not a gap. Idempotent (skips tracks that already have a clip).
  async function backfillTracks(project, dh) {
    const d = dh || dir; if (!d || !project?.tracks?.some((t) => !t.clipId && (t.importFile || t.backupFile))) return project;
    const base = albumPath(project);
    const tracks = [];
    for (const t of project.tracks) {
      const src = t.importFile || t.backupFile; // pre-existing audio, or an app-written file to recover
      if (t.clipId || !src) { tracks.push(t); continue; }
      try {
        const blob = await readBlobFrom(d, `${base}/${src}`);
        const clipId = uid('clip_'); await putClip(clipId, blob);
        tracks.push({ ...t, clipId, durationMs: await clipDurationMs(blob), sizeBytes: blob.size, mime: blob.type, status: 'ready', backupFile: src });
      } catch { tracks.push(t); } // referenced file missing — leave as a gap
    }
    return { ...project, tracks };
  }

  // Scan the active album's folder: re-attach audio for any gap tracks whose file exists (recovery),
  // and import any loose audio files in the folder that aren't tracked yet (as upload tracks).
  const AUDIO_RE = /\.(mp3|wav|m4a|aac|ogg|oga|opus|flac|webm)$/i;
  async function scanAlbumFolder() {
    const p = activeRef.current; if (!p || !dir) return;
    try {
      if (!(await ensureWritable(dir))) return;
      const base = albumPath(p);
      const backfilled = await backfillTracks(p, dir); // attach referenced-but-missing audio
      const prevById = new Map((p.tracks || []).map((t) => [t.id, t]));
      const recovered = (backfilled.tracks || []).filter((t) => t.clipId && !prevById.get(t.id)?.clipId).length;
      const referenced = new Set();
      for (const t of backfilled.tracks || []) { if (t.backupFile) referenced.add(t.backupFile); if (t.importFile) referenced.add(t.importFile); for (const k of t.takes || []) if (k.backupFile) referenced.add(k.backupFile); for (const st of t.stems || []) if (st.file) referenced.add(st.file); }
      const loose = (await listFiles(dir, base)).filter((name) => AUDIO_RE.test(name) && !referenced.has(name) && name !== p.cover?.file);
      // A loose file named like a gap track (e.g. "03 Neon Rain.mp3" ↔ "Neon Rain") is that track's audio.
      const gaps = (backfilled.tracks || []).filter((t) => !t.clipId);
      const matched = new Map(); // trackId → filename
      pairItems(gaps.map((t) => ({ title: t.title, prompt: '-' })), loose.map((name) => ({ name }))).slice(0, gaps.length)
        .forEach((r, i) => { if (r.file) matched.set(gaps[i].id, r.file.name); });
      const linked = [];
      for (const t of backfilled.tracks || []) {
        const name = matched.get(t.id);
        if (!name) { linked.push(t); continue; }
        const blob = await readBlobFrom(dir, `${base}/${name}`);
        const clipId = uid('clip_'); await putClip(clipId, blob);
        linked.push({ ...t, clipId, durationMs: await clipDurationMs(blob), sizeBytes: blob.size, mime: blob.type, status: 'ready', error: '', backupFile: name });
      }
      const taken = new Set(matched.values());
      const newTracks = [];
      for (const name of loose) {
        if (taken.has(name)) continue;
        const blob = await readBlobFrom(dir, `${base}/${name}`);
        const clipId = uid('clip_'); await putClip(clipId, blob);
        newTracks.push({ id: uid('t_'), type: 'upload', title: name.replace(/\.[^.]+$/, ''), fileName: name, backupFile: name, clipId, durationMs: await clipDurationMs(blob), sizeBytes: blob.size, mime: blob.type, status: 'ready', gain: 1 });
      }
      const final = { ...backfilled, tracks: [...linked, ...newTracks] };
      updateProject(() => final);
      writeSkeleton(final);
      showToast(`🔎 Scan: ${recovered} recovered, ${matched.size} linked by title, ${newTracks.length} new file${newTracks.length === 1 ? '' : 's'}`);
    } catch (e) { showToast('Scan failed: ' + (e.message || e)); }
  }

  // Point a track at audio that already exists — a file in the album folder (used in place) or one
  // picked from disk (copied into the folder). Fixes a missing/wrong link without regenerating.
  async function listAlbumAudio() {
    const p = activeRef.current; if (!p || !dir || !(await ensureWritable(dir))) return [];
    const used = new Set((p.tracks || []).filter((t) => t.clipId).map((t) => t.backupFile).filter(Boolean));
    return (await listFiles(dir, albumPath(p))).filter((n) => AUDIO_RE.test(n)).map((name) => ({ name, used: used.has(name) }));
  }
  async function linkTrackFile(trackId, src) {
    const p = activeRef.current; const t = p?.tracks?.find((x) => x.id === trackId); if (!t) return;
    try {
      const inFolder = typeof src === 'string';
      const blob = inFolder ? await readBlobFrom(dir, `${albumPath(p)}/${src}`) : src;
      const clipId = uid('clip_'); await putClip(clipId, blob); // ponytail: the old clip (if any) is left in the store — it may be shared by a duplicate track
      const up = { clipId, durationMs: await clipDurationMs(blob), sizeBytes: blob.size, mime: blob.type, status: 'ready', error: '', backupFile: inFolder ? src : null, importFile: undefined };
      if (!inFolder) up.backupFile = await backupClip({ ...t, ...up }, blob);
      updateProject((pp) => ({ ...pp, tracks: pp.tracks.map((x) => (x.id === trackId ? { ...x, ...up } : x)) }));
      writeSkeleton();
      showToast(`📎 “${t.title || 'Track'}” → ${inFolder ? src : src.name}`);
    } catch (e) { showToast('Link failed: ' + (e.message || e)); }
  }

  const loadSkeleton = useCallback(async () => {
    const p = activeRef.current; if (!p || !dir) return;
    try {
      const text = await readTextFrom(dir, `${albumPath(p)}/album.json`);
      const merged = await backfillTracks(mergeSkeleton(p, JSON.parse(text)), dir);
      updateProject(() => merged);
      lastJsonRef.current = text;
    } catch (e) { alert('Could not load album.json from the folder: ' + (e.message || e)); }
  }, [dir, updateProject, albumPath]); // eslint-disable-line react-hooks/exhaustive-deps

  // Watch the active album's album.json and live-reload when an external editor (e.g. a Claude Code
  // session) changes it. File System Access has no change events, so we poll the file's text every
  // few seconds and diff it against what we last wrote/loaded (self-writes are ignored). ponytail:
  // poll, not a watcher — the API offers no push; 2.5s is plenty for a hand-off workflow.
  function flashSynced() { setJustSynced(true); if (syncTimer.current) clearTimeout(syncTimer.current); syncTimer.current = setTimeout(() => setJustSynced(false), 2500); }
  useEffect(() => {
    if (!dir || !active?.id || !watch) return;
    let cancelled = false, baseline = null;
    const tick = async () => {
      try {
        const text = await readTextFrom(dir, `${albumPath(activeRef.current)}/album.json`);
        if (cancelled) return;
        if (baseline === null) { baseline = text; if (lastJsonRef.current === null) lastJsonRef.current = text; return; } // silent baseline on open
        if (text !== baseline && text !== lastJsonRef.current) {
          let json; try { json = JSON.parse(text); } catch { return; } // partial write mid-save — retry next tick
          baseline = text; lastJsonRef.current = text;
          const merged = await backfillTracks(mergeSkeleton(activeRef.current, json), dir);
          updateProject(() => merged);
          flashSynced();
        } else if (text !== baseline) { baseline = text; }
      } catch { /* file missing / not written yet — ignore */ }
    };
    tick();
    const iv = setInterval(tick, 2500);
    return () => { cancelled = true; clearInterval(iv); };
  }, [dir, active?.id, watch, updateProject, albumPath]);

  // Discover groups/albums created ON DISK (e.g. by a separate Claude Code session) and reconcile them
  // into the app. Groups are matched/created by folder name + parent; albums by their album.json `id`
  // (or, lacking one, folder path) so re-scans don't duplicate. Idempotent — a no-op when nothing new.
  async function importFromFolder(silent = false, opts = {}) {
    const d = opts.dir || dir; const ign = opts.ignored || ignored;
    if (!d) return { groups: 0, albums: 0 };
    let scan;
    try { if (!(await ensureWritable(d))) return { groups: 0, albums: 0 }; scan = await scanAlbums(d, ign); }
    catch (e) { if (!silent) alert('Folder scan failed: ' + (e.message || e)); return { groups: 0, albums: 0 }; }
    const curGroups = opts.groups || groups, curProjects = opts.projects || projects;
    const { newGroups, newProjects } = planImport(scan.albums, curGroups, curProjects, () => uid('g_'), () => uid('p_'));
    // Pick up in-place edits to albums the app already knows (any album, open or not).
    let refreshed = 0;
    for (const { project, json } of planRefresh(scan.albums, curGroups, await listProjects())) {
      const merged = await backfillTracks(mergeSkeleton(project, json), d);
      if (activeRef.current?.id === project.id) { lastJsonRef.current = JSON.stringify(buildAlbumJson(merged), null, 2); updateProject(() => merged); }
      else await saveProject(merged);
      refreshed++;
    }
    if (refreshed) { await refreshProjects(); flashSynced(); }
    if (!newGroups.length && !newProjects.length) return { groups: 0, albums: 0, refreshed };
    for (const np of newProjects) np.proj = await backfillTracks(np.proj, d); // attach pre-existing audio
    for (const g of newGroups) await saveGroup(g);
    for (const np of newProjects) await saveProject(np.proj);
    // Stamp an id into agent-created album.json files that lacked one, so future scans dedupe by id.
    for (const np of newProjects) if (np.writeBack) { try { await writeToDir(d, `${np.path}/album.json`, new Blob([JSON.stringify(buildAlbumJson(np.proj), null, 2)], { type: 'application/json' })); } catch { /* best-effort */ } }
    await ensureGrouped(d); // discovered root-level albums must land in a group too
    await refreshGroups(); await refreshProjects();
    if (!silent) flashSynced();
    return { groups: newGroups.length, albums: newProjects.length, refreshed };
  }
  importRef.current = importFromFolder;

  // Periodic structure scan (slower than the album.json watcher) so on-disk additions appear on their own.
  useEffect(() => {
    if (!dir || !watch) return;
    const iv = setInterval(() => { importRef.current?.(true); }, 7000);
    return () => clearInterval(iv);
  }, [dir, watch]);

  // ── Attachments (style guides / inspirations / notes) ──────────────────────────────────────
  const attFilename = (name, kind, id) => {
    const base = sanitizeFilename((name || 'note').replace(/\.[^.]+$/, '')) || 'note';
    const ext = kind === 'note' ? 'md' : (name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || 'bin');
    return `attachments/${base}_${id.slice(-4)}.${ext}`;
  };
  // Attachments belong to the open album, or to a group (liner notes for a set of albums) when the
  // dialog was opened from a group. Files mirror to <that folder>/attachments/.
  const [attGroupId, setAttGroupId] = useState(null);
  function attOwner() {
    const g = attGroupId && groupsRef.current.find((x) => x.id === attGroupId);
    if (!g) return { path: albumPath(activeRef.current), set: async (fn) => { updateProject((p) => ({ ...p, attachments: fn(p.attachments || []) })); writeSkeleton(); } };
    return {
      path: groupFolderPath(g, groupsRef.current),
      set: async (fn) => { const cur = (await listGroups()).find((x) => x.id === g.id) || g; await saveGroup({ ...cur, attachments: fn(cur.attachments || []) }); await refreshGroups(); },
    };
  }
  async function writeAttachment(path, file, blob) {
    if (!dir) return;
    try { if (await ensureWritable(dir)) await writeToDir(dir, `${path}/${file}`, blob); } catch { /* best-effort */ }
  }
  async function addNote({ name, text, source }) {
    const o = attOwner(); const id = uid('a_'); const file = attFilename(name, 'note', id);
    await putAttachment(id, { kind: 'note', text });
    await o.set((l) => [...l, { id, name, kind: 'note', mime: 'text/markdown', size: text.length, source, createdAt: Date.now(), file }]);
    await writeAttachment(o.path, file, new Blob([text], { type: 'text/markdown' }));
  }
  async function addFiles(files, source) {
    const o = attOwner();
    for (const f of files) {
      const id = uid('a_'); const file = attFilename(f.name, 'file', id);
      await putAttachment(id, { kind: 'file', blob: f });
      await o.set((l) => [...l, { id, name: f.name, kind: 'file', mime: f.type, size: f.size, source, createdAt: Date.now(), file }]);
      await writeAttachment(o.path, file, f);
    }
  }
  async function removeAttachment(a) {
    const o = attOwner();
    await deleteAttachment(a.id);
    await o.set((l) => l.filter((x) => x.id !== a.id));
    if (dir) { try { await removeFromDir(dir, `${o.path}/${a.file}`); } catch { /* may already be gone */ } }
  }
  async function downloadAttachment(a) { const rec = await getAttachment(a.id); if (rec?.blob) download(rec.blob, a.name); }
  // Write every attachment file to a folder (used when a backup folder is first chosen).
  async function flushAttachments(list, path, d) {
    for (const a of list || []) {
      try {
        const rec = await getAttachment(a.id); if (!rec) continue;
        const blob = rec.kind === 'note' ? new Blob([rec.text || ''], { type: 'text/markdown' }) : rec.blob;
        await writeToDir(d, `${path}/${a.file}`, blob);
      } catch { /* best-effort */ }
    }
  }

  // ── Groups + albums ───────────────────────────────────────────────────────────────────────
  // Run a folder operation guarded by permission; failures are surfaced to the console, not fatal.
  async function fsOp(fn) { if (!dir) return; try { if (await ensureWritable(dir)) await fn(dir); } catch (e) { console.warn('folder sync failed:', e); } }

  async function newAlbum(parentId = null) {
    const p = await saveProject({ id: uid('p_'), title: 'New Album', artist: '', description: '', meta: {}, parentId: parentId || null, tracks: [], createdAt: Date.now() });
    await refreshProjects();
    if (parentId) setExpanded((s) => new Set(s).add(parentId));
    setActive(p);
    writeSkeleton(p); // create the album's folder + album.json on disk immediately
  }
  async function newGroup(parentId = null) {
    const name = prompt('Group name:', 'New group'); if (name == null) return;
    const g = { id: uid('g_'), name: name || 'Group', parentId: parentId || null };
    await saveGroup(g);
    if (parentId) setExpanded((s) => new Set(s).add(parentId));
    await refreshGroups();
    fsOp((d) => ensureDir(d, groupFolderPath(g, [...groups, g]))); // create the group folder now
  }
  async function renameGroup(g) {
    const name = prompt('Rename group:', g.name); if (name == null || name === g.name) return;
    const oldPath = groupFolderPath(g, groups);
    const updated = { ...g, name: name || g.name };
    await saveGroup(updated); await refreshGroups();
    const newPath = groupFolderPath(updated, groups.map((x) => (x.id === g.id ? updated : x)));
    fsOp((d) => moveDir(d, oldPath, newPath)); // rename the folder on disk
  }
  async function removeGroup(g) {
    if (!confirm(`Delete group “${g.name}”? Its albums and sub-groups move up a level${g.attachments?.length ? `; its ${g.attachments.length} attachment(s) are deleted` : ''}.`)) return;
    const parent = g.parentId || null;
    const gPath = groupFolderPath(g, groups);
    const childGroups = groups.filter((x) => x.parentId === g.id);
    const childAlbums = projects.filter((x) => x.parentId === g.id);
    const newGroups = groups.filter((x) => x.id !== g.id).map((x) => (x.parentId === g.id ? { ...x, parentId: parent } : x));
    await fsOp(async (d) => { // move direct children up a level, then drop the now-empty group folder
      for (const cg of childGroups) await moveDir(d, groupFolderPath(cg, groups), groupFolderPath({ ...cg, parentId: parent }, newGroups));
      for (const a of childAlbums) await moveDir(d, albumFolderPath(a, groups), albumFolderPath({ ...a, parentId: parent }, newGroups));
      if (g.attachments?.length) { try { await removeDir(d, `${gPath}/attachments`); } catch { /* */ } }
      try { await removeFromDir(d, gPath); } catch { /* not empty / already gone */ }
    });
    for (const a of g.attachments || []) await deleteAttachment(a.id);
    for (const cg of childGroups) await saveGroup({ ...cg, parentId: parent });
    for (const pr of childAlbums) await saveProject({ ...pr, parentId: parent });
    await deleteGroup(g.id); if (groupViewId === g.id) setGroupViewId(null); refreshGroups(); refreshProjects();
  }
  async function moveItem(kind, id, parentId) {
    if (kind === 'group') {
      const g = groups.find((x) => x.id === id); if (!g) return;
      const oldPath = groupFolderPath(g, groups);
      const updated = { ...g, parentId };
      await saveGroup(updated); await refreshGroups();
      fsOp((d) => moveDir(d, oldPath, groupFolderPath(updated, groups.map((x) => (x.id === id ? updated : x)))));
    } else {
      const p = projects.find((x) => x.id === id) || (activeRef.current?.id === id ? activeRef.current : null);
      if (!p) return;
      const oldPath = albumFolderPath(p, groups);
      const next = { ...p, parentId };
      await saveProject(next, { keepTime: true }); await refreshProjects();
      if (activeRef.current?.id === id) { activeRef.current = next; setActive(next); }
      fsOp((d) => moveDir(d, oldPath, albumFolderPath(next, groups)));
    }
    if (parentId) setExpanded((s) => new Set(s).add(parentId));
  }
  // 📂 Open a folder in File Explorer. A web page can't launch programs, so: under the local launcher
  // the dev server opens it; otherwise the one-time folder helper (tools/folder-helper) handles a
  // musicstudio-open: link. Both need the backup folder's absolute path (Settings) — the browser
  // never reveals it. Without them, the path is copied.
  function showToast(msg) { setToast(msg); if (toastTimer.current) clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 3000); }
  async function copyPath(rel) {
    const back = rel.replace(/\//g, '\\');
    const abs = prefs.backupPath ? `${prefs.backupPath.replace(/[\\/]+$/, '')}${back ? '\\' + back : ''}` : '';
    if (!abs) {
      setModal('settings');
      return showToast('📂 Set the backup folder’s full path in Settings once — then 📂 opens Explorer');
    }
    if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) {
      try {
        const r = await fetch('/__open-folder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: abs }) });
        if (r.ok) return showToast('📂 Opened in Explorer');
      } catch { /* not the dev server — try the helper */ }
    }
    if (prefs.folderHelper) { location.href = 'musicstudio-open:' + encodeURIComponent(abs); return showToast('📂 Opening in Explorer…'); }
    try { await navigator.clipboard.writeText(abs); } catch { /* */ }
    showToast('📋 Path copied — install the folder helper (Settings) so 📂 opens Explorer');
  }
  // File pickers open in the folder of what's on screen: the attachments' owner, the open album, the
  // selected group — else the backup root.
  useEffect(() => {
    setPickerStart(async () => {
      if (!dir || !(await canWriteQuietly(dir))) return null;
      const g = (attGroupId && modal === 'attachments' ? groups.find((x) => x.id === attGroupId) : null) || (!active && groupViewId ? groups.find((x) => x.id === groupViewId) : null);
      const rel = g ? groupFolderPath(g, groups) : active ? albumPath(active) : '';
      return (await dirAt(dir, rel)) || dir;
    });
  });
  const copyAlbumPath = (p) => copyPath(albumPath(p));
  const copyGroupPath = (g) => copyPath(groupFolderPath(g, groups));

  async function open(id) { setGroupViewId(null); setPlaylistId(null); lastJsonRef.current = null; setActive(await getProject(id)); }
  function selectGroup(g) { setActive(null); setPlaylistId(null); setGroupViewId(g.id); }
  function selectPlaylist(pl) { setActive(null); setGroupViewId(null); setPlaylistId(pl.id); }
  async function newPlaylist() {
    const name = prompt('Playlist name:', 'New playlist'); if (name == null) return;
    const pl = await savePlaylist({ id: uid('pl_'), name: name || 'Playlist', kind: 'static', items: [], rule: { field: 'all' }, createdAt: Date.now() });
    await refreshPlaylists(); selectPlaylist(pl);
  }
  async function changePlaylist(pl) { const rec = await savePlaylist(pl); setPlaylists((ls) => ls.map((x) => (x.id === rec.id ? rec : x))); }
  async function renamePlaylist(pl) { const name = prompt('Rename playlist:', pl.name); if (name == null) return; await changePlaylist({ ...pl, name: name || pl.name }); }
  async function removePlaylist(pl) { if (!confirm(`Delete playlist “${pl.name}”?`)) return; await deletePlaylist(pl.id); if (playlistId === pl.id) setPlaylistId(null); refreshPlaylists(); }
  async function addTracksToPlaylist(items, plId) {
    const pl = playlists.find((p) => p.id === plId); if (!pl) return;
    await changePlaylist({ ...pl, items: [...(pl.items || []), ...items] });
    showToast(`＋ Added ${items.length} to “${pl.name}”`);
  }

  // Album cover: store the image blob, mirror it to the folder as cover.<ext>, embed in exports.
  const [coverUrl, setCoverUrl] = useState(null);
  useEffect(() => {
    let url = null; const id = active?.cover?.id;
    if (id) getClip(id).then((b) => { if (b) { url = URL.createObjectURL(b); setCoverUrl(url); } }); else setCoverUrl(null);
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [active?.cover?.id]);
  async function setCover(file) {
    const ext = file.name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || (file.type === 'image/png' ? 'png' : 'jpg');
    const id = uid('cover_'); await putClip(id, file);
    const old = activeRef.current?.cover?.id;
    updateProject((p) => ({ ...p, cover: { id, mime: file.type || 'image/jpeg', file: `cover.${ext}` } }));
    if (old) deleteClip(old);
    if (dir) { try { if (await ensureWritable(dir)) await writeToDir(dir, `${albumPath(activeRef.current)}/cover.${ext}`, file); } catch { /* */ } }
    writeSkeleton();
  }
  async function clearCover() {
    const old = activeRef.current?.cover?.id;
    updateProject((p) => ({ ...p, cover: null }));
    if (old) deleteClip(old);
    writeSkeleton();
  }

  async function duplicateAlbum(a) {
    const src = a && (await getProject(a.id)); if (!src) return;
    const tracks = [];
    for (const t of src.tracks || []) {
      const nt = { ...t, id: uid('t_'), backupFile: null };
      if (t.clipId) { const b = await getClip(t.clipId); if (b) { const nid = uid('clip_'); await putClip(nid, b); nt.clipId = nid; } }
      tracks.push(nt);
    }
    const copy = { ...src, id: uid('p_'), title: `${src.title || 'Album'} (copy)`, tracks, cover: null, createdAt: Date.now() };
    if (src.cover?.id) { const cb = await getClip(src.cover.id); if (cb) { const cid = uid('cover_'); await putClip(cid, cb); copy.cover = { ...src.cover, id: cid }; } }
    await saveProject(copy); await refreshProjects(); setActive(copy); writeSkeleton(copy);
  }

  // Drag the sidebar/main divider; persist the width.
  function startResize(e) {
    e.preventDefault();
    let latest = sidebarW;
    const move = (ev) => { latest = Math.min(560, Math.max(180, ev.clientX)); setSidebarW(latest); };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); document.body.style.userSelect = ''; setSetting('sidebarW', latest); };
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }
  async function removeAlbum(a) {
    if (!confirm(`Delete “${a.title}” and its audio?`)) return;
    const path = albumFolderPath(a, groups);
    await deleteProject(a.id);
    if (activeRef.current?.id === a.id) setActive(null);
    refreshProjects();
    fsOp((d) => removeDir(d, path)); // remove the album's folder (audio, album.json, attachments)
  }

  async function pickBackup() {
    try {
      const h = await pickBackupDir();
      if (await looksLikeAppFolder(h)) { alert('That folder is (or contains) the Music Studio app. Choose a folder OUTSIDE the app so generated audio and album skeletons never mix with the running code.'); return; }
      await ensureWritable(h); await setBackupDir(h); setDir(h);
      try { await writeToDir(h, 'AGENT.md', new Blob([rootAgentMarkdown()], { type: 'text/markdown' })); } catch { /* best-effort */ }
      if (activeRef.current) { writeSkeleton(activeRef.current, h); flushAttachments(activeRef.current.attachments, albumPath(activeRef.current), h); }
      for (const g of groups) if (g.attachments?.length) flushAttachments(g.attachments, groupFolderPath(g, groups), h);
      importFromFolder(true, { dir: h }); // discover any groups/albums already on disk
    } catch (e) { if (e?.name !== 'AbortError') alert(e.message); }
  }
  async function dropBackup() { await clearBackupDir(); setDir(null); }

  // ── Publish (device sync) — a second folder finished albums are written to as tagged tracks ──
  async function pickPublish() {
    try { const h = await pickBackupDir(); await ensureWritable(h); await setPublishDir(h); setPubDir(h); showToast(`⇪ Publishing to ${h.name}`); }
    catch (e) { if (e?.name !== 'AbortError') alert(e.message); }
  }
  async function dropPublish() { await clearPublishDir(); setPubDir(null); }
  async function saveSyncMap(m) { setSyncMap(m); await setSetting('deviceSync', m); }
  async function publishOne(p) {
    if (!pubDir) { showToast('Set a publish folder in Settings first'); setModal('settings'); return; }
    try {
      showToast(`⇪ Publishing “${p.title}”…`);
      const n = await publishAlbum(p, pubDir);
      if (n) { await saveSyncMap({ ...syncMap, [p.id]: { on: true, at: Date.now() } }); await notePublished([p]); } // published = synced
      showToast(n ? `⇪ “${p.title}” → ${pubDir.name} (${n} track${n === 1 ? '' : 's'})` : 'No ready tracks to publish yet');
    } catch (e) { showToast('Publish failed: ' + (e.message || e)); }
  }
  // Reconcile the device folder with the chosen album set: publish missing/stale, remove deselected.
  // Returns the new sync map (or null on failure) so the Drive channel can publish the result.
  async function applySync(selIds, { quiet = false } = {}) {
    if (!pubDir) return null;
    setSyncBusy('Scanning…');
    try {
      if (!(await ensureWritable(pubDir))) throw new Error('Publish folder permission denied.');
      const m = {};
      for (const p of projects) if (selIds.has(p.id)) m[p.id] = { on: true, at: syncMap[p.id]?.at || 0 };
      const dirs = await listAlbumDirs(pubDir);
      const plan = planSync(projects, m, dirs);
      let wrote = 0;
      for (const p of plan.toWrite) {
        setSyncBusy(`Publishing ${++wrote}/${plan.toWrite.length}…`);
        if (await publishAlbum(p, pubDir)) m[p.id] = { on: true, at: Date.now() };
      }
      for (const name of plan.toRemove) { setSyncBusy(`Removing ${name}…`); await removeDir(pubDir, name); }
      await saveSyncMap(m);
      await notePublished(plan.toWrite, m);
      setSyncBusy('');
      if (!quiet) setModal(null);
      showToast(`📱 Synced — ${plan.toWrite.length} published, ${plan.toRemove.length} removed, ${selIds.size} on device`);
      return m;
    } catch (e) { setSyncBusy(''); showToast('Sync failed: ' + (e.message || e)); return null; }
  }

  // ── File tags follow the app ──────────────────────────────────────────────────────────────
  // What Explorer and players show for a file (title, album, artist, track no., genre, year, cover…)
  // is kept equal to the app. ~5s after edits settle, every master file (backup folder) and published
  // copy whose tags are stale is rewritten — tags only, audio untouched; a published track that was
  // renamed, renumbered or re-edited is re-rendered instead. Per-file fingerprints (setting
  // 'fileTagSigs') remember what was written, so unchanged files are never touched. One pass at a time;
  // never prompts for folder permission (waits until the folder is unlocked by a click).
  const tagRun = useRef({ busy: false, again: false });
  const tagSyncRef = useRef(null);
  async function notePublished(list, onMap = null) { // after a full publish: those folders are current
    const sigs = await getSetting('fileTagSigs', {});
    for (const p of list) sigs['p:' + p.id] = publishState(p);
    if (onMap) for (const k of Object.keys(sigs)) if (k.startsWith('p:') && !onMap[k.slice(2)]) delete sigs[k];
    await setSetting('fileTagSigs', sigs);
  }
  async function runTagSync() {
    const run = tagRun.current;
    if (run.busy) { run.again = true; return; }
    run.busy = true;
    let n = 0; const republished = [];
    try {
      const canM = await canWriteQuietly(dir), canP = await canWriteQuietly(pubDir);
      if (!canM && !canP) return;
      const sigs = await getSetting('fileTagSigs', {});
      const tick = () => { if (++n % 10 === 0) showToast(`🏷 Updating file tags… ${n}`); };
      for (const p of projects) {
        let pic; const picture = async () => (pic === undefined ? (pic = await coverPicture(p)) : pic);
        if (canM) for (const m of masterTargets(p)) {
          if (sigs['m:' + m.trackId] === m.sig) continue;
          const path = `${albumFolderPath(p, groups)}/${m.file}`;
          try { await writeToDir(dir, path, await retagBlob(await readBlobFrom(dir, path), m.ext, { ...m.tags, picture: await picture() })); sigs['m:' + m.trackId] = m.sig; tick(); }
          catch { /* missing or locked (e.g. open in a player) — retried next pass */ }
        }
        if (!canP || !syncMap[p.id]?.on) continue;
        const st = publishTargets(p); if (!st.files.length) continue;
        const prev = sigs['p:' + p.id];
        try {
          if (!prev || prev.folder !== st.folder || prev.names.join('\n') !== st.files.map((f) => f.name).join('\n')) {
            if (prev && prev.folder !== st.folder) await removeDir(pubDir, prev.folder).catch(() => {}); // album renamed
            n += await publishAlbum(p, pubDir); republished.push(p.id);
          } else {
            const ready = (p.tracks || []).filter((t) => t.clipId);
            for (const [i, f] of st.files.entries()) {
              const was = prev.sigs[f.trackId] || '';
              if (was === f.sig + f.audio) continue;
              const path = `${st.folder}/${f.name}`;
              const out = was.endsWith(f.audio) // same audio → just the tags
                ? await retagBlob(await readBlobFrom(pubDir, path), f.ext, { ...f.tags, picture: await picture() })
                : (await renderTrackFile(p, ready[i], i, ready.length, await picture())).out;
              await writeToDir(pubDir, path, out); tick();
            }
          }
          sigs['p:' + p.id] = publishState(p);
        } catch { /* retried next pass */ }
      }
      await setSetting('fileTagSigs', sigs);
      if (republished.length) { const at = Date.now(); await saveSyncMap({ ...syncMap, ...Object.fromEntries(republished.map((id) => [id, { on: true, at }])) }); }
      if (n) showToast(`🏷 File tags up to date (${n} file${n === 1 ? '' : 's'} updated)`);
    } finally {
      run.busy = false;
      if (run.again) { run.again = false; tagSyncRef.current?.(); }
    }
  }
  useEffect(() => { tagSyncRef.current = runTagSync; });
  // Taste profile for agents (TASTE.md + taste.json at the backup root) — rewritten only when it changes.
  const tasteRef = useRef('');
  useEffect(() => {
    if (!dir) return;
    const t = setTimeout(async () => {
      if (!(await canWriteQuietly(dir))) return;
      const { json, markdown } = buildTaste(projects, groups);
      if (markdown === tasteRef.current) return;
      try { await writeToDir(dir, 'TASTE.md', new Blob([markdown], { type: 'text/markdown' })); await writeToDir(dir, 'taste.json', new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' })); tasteRef.current = markdown; } catch { /* retried on the next change */ }
    }, 6000);
    return () => clearTimeout(t);
  }, [projects, groups, dir]);
  useEffect(() => { // debounce: every edit restarts the clock, so typing never triggers a write
    if (!dir && !pubDir) return;
    const t = setTimeout(() => tagSyncRef.current?.(), 5000);
    return () => clearTimeout(t);
  }, [projects, groups, dir, pubDir, syncMap]);

  // ── Google Drive channel — the desktop publishes a catalog; a phone publishes sync requests ──
  async function pushCatalog(map = syncMap, appliedAt = null) {
    const at = appliedAt ?? (await getSetting('driveAppliedAt', 0));
    const cat = buildCatalog(projects, groups, map, { device: prefs.deviceName || 'Desktop', appliedAt: at, publishName: pubDir?.name || '' });
    await driveUploadJson(CATALOG_FILE, cat);
    setCatalog(cat);
    return cat;
  }
  // Pull both files. On the desktop, a request set newer than what we last applied is applied now.
  async function pullCloud({ silent = false, apply = true } = {}) {
    const [cat, req] = await Promise.all([driveDownloadJson(CATALOG_FILE), driveDownloadJson(REQUEST_FILE)]);
    setRequests(req);
    let appliedAt = await getSetting('driveAppliedAt', 0);
    if (apply && pubDir && requestsPending(req, appliedAt)) {
      const m = await applySync(new Set(req.want), { quiet: true });
      if (m) { appliedAt = req.updatedAt; await setSetting('driveAppliedAt', appliedAt); await pushCatalog(m, appliedAt); return { applied: true }; }
    }
    // Only overwrite what we show if we're NOT the master (the master's own state is fresher).
    if (cat && (!pubDir || !projects.length)) setCatalog(cat);
    else if (cat && !catalog) setCatalog(cat);
    if (!silent && !cat) showToast('No library published to Drive yet');
    return { applied: false };
  }
  async function connectDrive({ silent = false } = {}) {
    setCloudBusy('Connecting…');
    try {
      await driveConnect(prefs, { silent });
      setDrive(true);
      await pullCloud({ silent });
      if (pubDir && projects.length) await pushCatalog(); // we're the master — publish the library
      setCloudBusy('');
      if (!silent) showToast(`☁ Drive connected${driveProfile()?.email ? ` — ${driveProfile().email}` : ''}`);
    } catch (e) { setCloudBusy(''); if (!silent) showToast('Drive: ' + (e.message || e)); }
  }
  function disconnectDrive() { driveDisconnect(); setDrive(false); setCatalog(null); setRequests(null); }
  // Phone side: publish the full desired album set; the desktop applies it when it next runs.
  async function saveCloudRequest(wantIds) {
    setCloudBusy('Saving…');
    try {
      const req = buildRequests(wantIds, { from: prefs.deviceName || 'Phone' });
      await driveUploadJson(REQUEST_FILE, req);
      setRequests(req);
      setCloudBusy('');
      if (pubDir) { await pullCloud({ silent: true }); showToast('☁ Request saved and applied'); }
      else showToast('☁ Saved — your desktop will sync these next time it runs');
    } catch (e) { setCloudBusy(''); showToast('Save failed: ' + (e.message || e)); }
  }

  // Reorganize wizard: create the new groups, then apply each move in order — every from/to path
  // is computed against the tree as it stands at that step, so batch moves compose. Optionally drop
  // groups the moves left empty (walking up, since a parent may empty out in turn).
  async function applyRearrange(plan, prune) {
    let gs = [...groups, ...plan.created]; const ps = new Map(projects.map((p) => [p.id, p]));
    const sources = new Set();
    try {
      for (const g of plan.created) { await saveGroup(g); await fsOp((d) => ensureDir(d, groupFolderPath(g, gs))); }
      let i = 0;
      for (const m of plan.moves) {
        setWizBusy(`Moving ${++i}/${plan.moves.length}…`);
        if (m.kind === 'group') {
          const g = gs.find((x) => x.id === m.id); if (!g) continue;
          const from = groupFolderPath(g, gs); const next = { ...g, parentId: m.parentId };
          if (g.parentId) sources.add(g.parentId);
          gs = gs.map((x) => (x.id === m.id ? next : x)); await saveGroup(next);
          await fsOp((d) => moveDir(d, from, groupFolderPath(next, gs)));
        } else {
          const p = ps.get(m.id); if (!p) continue;
          const from = albumFolderPath(p, gs); const next = { ...p, parentId: m.parentId };
          if (p.parentId) sources.add(p.parentId);
          ps.set(m.id, next); await saveProject(next, { keepTime: true });
          if (activeRef.current?.id === m.id) { activeRef.current = next; setActive(next); }
          await fsOp((d) => moveDir(d, from, albumFolderPath(next, gs)));
        }
      }
      let pruned = 0;
      for (let id of prune ? sources : []) {
        while (id) {
          const g = gs.find((x) => x.id === id);
          if (!g || g.attachments?.length || gs.some((x) => x.parentId === id) || [...ps.values()].some((p) => p.parentId === id)) break;
          await fsOp((d) => removeFromDir(d, groupFolderPath(g, gs)));
          await deleteGroup(id); gs = gs.filter((x) => x.id !== id); pruned++;
          if (groupViewId === id) setGroupViewId(null);
          id = g.parentId;
        }
      }
      groupsRef.current = gs;
      showToast(`🗂 ${plan.moves.length} moved${plan.created.length ? `, ${plan.created.length} group(s) created` : ''}${pruned ? `, ${pruned} empty removed` : ''}`);
      setModal(null);
    } catch (e) { showToast('Reorganize failed: ' + (e.message || e)); }
    setWizBusy(''); await ensureGrouped(); await refreshGroups(); await refreshProjects();
    const a = activeRef.current && (await getProject(activeRef.current.id)); // may have landed in "Ungrouped"
    if (a) { groupsRef.current = await listGroups(); activeRef.current = a; setActive(a); }
  }

  // Build-album wizard: rows are { title, prompt, file } with either side optional. Audio is stored
  // as the track's clip and written to the album folder, so it's ready (no spend); prompt-only rows
  // are gaps to generate; audio-only rows are uploads.
  async function buildAlbum({ title, group, description, rows }) {
    setWizBusy('Creating…');
    try {
      const { parentId, created } = ensureGroupPath(group, groups, () => uid('g_'));
      for (const g of created) await saveGroup(g);
      const all = [...groups, ...created]; groupsRef.current = all;
      const base = { id: uid('p_'), title: title.trim() || 'New album', artist: '', description: description || '', meta: {}, parentId, createdAt: Date.now() };
      const path = albumFolderPath(base, all);
      const canWrite = !!dir && (await ensureWritable(dir).catch(() => false));
      const keep = rows.filter((x) => x.file || x.prompt.trim());
      const tracks = [];
      for (const [i, r] of keep.entries()) {
        setWizBusy(`Adding ${i + 1}/${keep.length}…`);
        const t = { id: uid('t_'), type: r.prompt.trim() ? 'music' : 'upload', title: r.title.trim() || `Track ${i + 1}`, prompt: r.prompt.trim(), sourceUrl: r.url || '', lengthMs: (prefs.defaultLengthSec || 60) * 1000, ...newTrackModel(prefs), instrumental: false, status: 'idle', gain: 1 };
        if (r.file) {
          const clipId = uid('clip_'); await putClip(clipId, r.file);
          Object.assign(t, { clipId, fileName: r.file.name, durationMs: await clipDurationMs(r.file), sizeBytes: r.file.size, mime: r.file.type, status: 'ready' });
          if (canWrite) {
            const name = `${sanitizeFilename(t.title)}_${clipId.slice(-5)}.${extOf(r.file.type, r.file.name)}`;
            try { await writeToDir(dir, `${path}/${name}`, r.file); t.backupFile = name; } catch { /* stays in the browser store */ }
          }
        }
        tracks.push(t);
      }
      for (const g of created) await fsOp((d) => ensureDir(d, groupFolderPath(g, all)));
      await saveProject({ ...base, tracks });
      await ensureGrouped(); await refreshGroups(); await refreshProjects(); // ungrouped → "Ungrouped"
      const p = await getProject(base.id); groupsRef.current = await listGroups();
      if (parentId) setExpanded((x) => new Set(x).add(parentId));
      setShowLibrary(false); setGroupViewId(null); setPlaylistId(null);
      lastJsonRef.current = null; setActive(p); writeSkeleton(p);
      setModal(null);
      showToast(`🧩 “${p.title}” — ${tracks.filter((t) => t.clipId).length} with audio, ${tracks.filter((t) => !t.clipId).length} to generate`);
    } catch (e) { showToast('Build failed: ' + (e.message || e)); }
    setWizBusy('');
  }

  // ── Generation queue ──────────────────────────────────────────────────────────────────────
  // Every job names its album + track, so a result always lands in THAT album and THAT album's
  // folder — whatever is open when it finishes (the old per-editor loop wrote into whichever album
  // was open). One job at a time; identical content already in the album is reused, not re-bought.
  // ponytail: in memory — a reload drops pending jobs (their tracks go back to plain gaps).
  const [jobs, setJobs] = useState([]); // { id, projectId, trackId, album, title, state: queued|running|done|reused|error|cancelled, error }
  const jobsRef = useRef([]);
  const runningRef = useRef(false);
  const setJobsBoth = (fn) => { jobsRef.current = fn(jobsRef.current); setJobs(jobsRef.current); };
  const setJob = (id, up) => setJobsBoth((js) => js.map((j) => (j.id === id ? { ...j, ...up } : j)));

  // Patch one track of any album: the open one through the editor state, others in the DB. If that
  // album gets opened mid-write, the patch is applied to the open copy too (idempotent).
  async function updateProjectById(projectId, fn) {
    if (activeRef.current?.id === projectId) { updateProject(fn); return; }
    const p = await getProject(projectId); if (!p) return;
    await saveProject(fn(p));
    if (activeRef.current?.id === projectId) updateProject(fn);
    refreshProjects();
  }
  const patchTrack = (projectId, trackId, up) => updateProjectById(projectId, (p) => ({ ...p, tracks: (p.tracks || []).map((t) => (t.id === trackId ? { ...t, ...up } : t)) }));
  // Uploads are pinned to the album they were started in, like generation.
  async function uploadTracks(projectId, files) {
    const canWrite = !!dir && (await ensureWritable(dir).catch(() => false));
    for (const f of files) {
      const clipId = uid('clip_'); await putClip(clipId, f);
      const t = { id: uid('t_'), type: 'upload', title: f.name.replace(/\.[^.]+$/, ''), fileName: f.name, clipId, durationMs: await clipDurationMs(f), sizeBytes: f.size, mime: f.type, status: 'ready', gain: 1 };
      const now = await freshProject(projectId); if (!now) return;
      if (canWrite) {
        const name = `${sanitizeFilename(t.title)}_${clipId.slice(-5)}.${extOf(f.type, f.name)}`;
        try { await writeToDir(dir, `${albumFolderPath(now, groupsRef.current)}/${name}`, f); t.backupFile = name; } catch { /* stays in the browser store */ }
      }
      await updateProjectById(projectId, (p) => ({ ...p, tracks: [...(p.tracks || []), t] }));
    }
    const saved = await freshProject(projectId); if (saved) writeSkeleton(saved);
  }
  const freshProject = async (id) => (activeRef.current?.id === id ? activeRef.current : await getProject(id));

  const [spendAsk, setSpendAsk] = useState(null); // pending confirmation before credits are spent
  // Several albums' tracks through ONE spend confirmation (e.g. bulk generate from the Library).
  async function enqueueBatches(batches, opts = {}) {
    if (prefs.confirmSpend !== false && !opts.confirmed) {
      const items = []; const names = [];
      for (const b of batches) { const p = await freshProject(b.projectId); if (!p) continue; names.push(p.title || 'Album'); items.push(...b.trackIds.map((id) => p.tracks.find((t) => t.id === id)).filter(Boolean)); }
      setSpendAsk({ batches, opts, album: names.length > 1 ? `${names.length} albums` : names[0] || 'Album', ...estimateJobs(items.map((t) => ({ ...t, videoCount: opts.videos?.length })), { takes: prefs.takes || 1, model: musicModelFor, kind: opts.kind || '' }) });
      return;
    }
    for (const b of batches) await enqueue(b.projectId, b.trackIds, { ...opts, confirmed: true });
  }
  async function rateTracks(batches, rating) {
    for (const b of batches) { const ids = new Set(b.trackIds); await updateProjectById(b.projectId, (p) => ({ ...p, tracks: (p.tracks || []).map((t) => (ids.has(t.id) ? { ...t, rating } : t)) })); }
  }
  async function enqueue(projectId, trackIds, opts = {}) {
    if (!apiKey) { showToast('Set your ElevenLabs API key in Settings first'); setModal('settings'); return; }
    if (!dir || !(await ensureWritable(dir))) { showToast('Connect the backup folder (outside the app) before generating'); setModal('settings'); return; }
    const p = await freshProject(projectId); if (!p) return;
    if (prefs.confirmSpend !== false && !opts.confirmed) return enqueueBatches([{ projectId, trackIds }], opts);
    const busy = new Set(jobsRef.current.filter((j) => (j.state === 'queued' || j.state === 'running') && (j.kind || '') === (opts.kind || '')).map((j) => j.trackId));
    const add = trackIds.filter((id) => !busy.has(id)).map((id) => ({ id: uid('j_'), projectId, trackId: id, album: p.title || 'Album', title: p.tracks.find((t) => t.id === id)?.title || 'Track', state: 'queued', plan: opts.plan || null, kind: opts.kind || '', videos: opts.videos || null, video: opts.video || null, variation: opts.variation || '' }));
    if (!add.length) return;
    if (typeof Notification !== 'undefined' && Notification.permission === 'default' && add.length > 1) { try { Notification.requestPermission(); } catch { /* */ } }
    if (opts.kind !== 'stems') for (const j of add) await patchTrack(projectId, j.trackId, { status: 'queued', error: '' });
    setJobsBoth((js) => [...js.filter((j) => j.state === 'queued' || j.state === 'running' || Date.now() - (j.at || 0) < 600000), ...add]);
    runQueue();
  }
  async function cancelJob(job) {
    if (job.state !== 'queued') return;
    setJob(job.id, { state: 'cancelled', at: Date.now() });
    await patchTrack(job.projectId, job.trackId, { status: 'idle' });
  }
  async function runQueue() {
    if (runningRef.current) return;
    runningRef.current = true;
    let ok = 0, fail = 0;
    try {
      for (;;) {
        const job = jobsRef.current.find((j) => j.state === 'queued'); if (!job) break;
        setJob(job.id, { state: 'running' });
        const p = await freshProject(job.projectId);
        const t = p?.tracks?.find((x) => x.id === job.trackId);
        if (!t) { setJob(job.id, { state: 'error', error: 'track or album was deleted', at: Date.now() }); fail++; continue; }
        try {
          if (!(await canWriteQuietly(dir))) throw new Error('Backup folder is locked — click the folder chip to unlock, then retry.');
          const folder = async () => { const now = await freshProject(p.id); if (!now) throw new Error('album was deleted'); return albumFolderPath(now, groupsRef.current); };
          const save = async (title, clipId, blob, ext = extOf(blob.type, t.fileName)) => { const name = `${sanitizeFilename(title || 'Track')}_${clipId.slice(-5)}.${ext}`; await writeToDir(dir, `${await folder()}/${name}`, blob); return name; };
          const portal = () => { try { const key = 'portal-activity', a = JSON.parse(localStorage.getItem(key) || '[]'); a.push([Math.round(Date.now() / 1000), 'MusicStudio', 'compose', 1]); localStorage.setItem(key, JSON.stringify(a.slice(-2000))); } catch { /* quota */ } };
          let twin = null;
          const qcOf = async (blob, expectSec) => { try { const ab = await decodeBlob(blob); const ch = [ab.getChannelData(0), ...(ab.numberOfChannels > 1 ? [ab.getChannelData(1)] : [])]; const m = qcMetrics(ch, ab.sampleRate); return { ...qcGrade(m, expectSec), ...m }; } catch { return null; } };
          // A new take becomes the track's audio; whatever was there is kept as a take.
          const adopt = (take) => updateProjectById(p.id, (pp) => ({ ...pp, tracks: (pp.tracks || []).map((x) => (x.id !== t.id ? x : { ...x, ...takeToRep(take), status: 'ready', error: '', takes: [...(x.takes || []), ...(x.clipId ? [repAsTake(x)] : [])] })) }));
          if (job.kind === 'stems') {
            setJob(job.id, { note: 'separating stems…' });
            const src = await getClip(t.clipId); if (!src) throw new Error('audio not found');
            const files = await separateStems(src, job.variation || 'six_stems_v1', apiKey, t.backupFile || 'song.mp3');
            const sub = `stems/${sanitizeFilename(t.title || 'Track')}_${(t.clipId || '').slice(-5)}`;
            const stems = [];
            for (const f of files) {
              const clipId = uid('clip_'); await putClip(clipId, f.blob);
              const file = `${sub}/${sanitizeFilename(f.name.replace(/\.[^.]+$/, ''))}.${extOf(f.blob.type, f.name)}`;
              await writeToDir(dir, `${await folder()}/${file}`, f.blob);
              stems.push({ name: f.name.replace(/\.[^.]+$/, ''), clipId, file, durationMs: await clipDurationMs(f.blob), mime: f.blob.type, sizeBytes: f.blob.size });
            }
            for (const old of t.stems || []) if (old.clipId) await deleteClip(old.clipId);
            await patchTrack(p.id, t.id, { stems });
          } else if (job.kind === 'video') {
            await patchTrack(p.id, t.id, { status: 'gen' });
            const v = job.video || {};
            const { blob, songId } = await videoToMusic({ videos: job.videos || [], description: t.prompt || '', tags: v.tags || [], model: musicModelFor(t), addSfx: !!v.addSfx, useAudioRef: !!v.useAudioRef }, apiKey);
            portal();
            const clipId = uid('clip_'); await putClip(clipId, blob);
            const durationMs = await clipDurationMs(blob);
            await adopt({ id: uid('k_'), clipId, durationMs, sizeBytes: blob.size, mime: blob.type, backupFile: await save(t.title, clipId, blob), songId, qc: await qcOf(blob, 0), at: Date.now(), model: musicModelFor(t), meta: { title: '', description: `scored from ${(job.videos || []).map((x) => x.name).join(', ')}`, genres: [], languages: [] } });
          } else if (t.type === 'sfx') {
            await patchTrack(p.id, t.id, { status: 'gen' });
            const blob = await soundEffect({ text: t.text, durationSec: t.sfxDuration || null, loop: !!t.loop, promptInfluence: t.promptInfluence ?? 0.3, model: t.sfxModel || SFX_MODELS[0].id }, apiKey);
            portal();
            const clipId = uid('clip_'); await putClip(clipId, blob);
            await adopt({ id: uid('k_'), clipId, durationMs: await clipDurationMs(blob), sizeBytes: blob.size, mime: blob.type, backupFile: await save(t.title, clipId, blob), qc: await qcOf(blob, 0), at: Date.now(), model: t.sfxModel || SFX_MODELS[0].id });
          } else if (t.type === 'music') {
            // Takes: N generations (each its own seed), quality-checked; the best becomes the track,
            // the rest — and the previous audio, if any — stack under it. Nothing is overwritten.
            const n = job.plan ? 1 : Math.max(1, Math.min(4, t.takesN || prefs.takes || 1));
            const model = musicModelFor(t), takes = [];
            for (let i = 0; i < n; i++) {
              setJob(job.id, { note: n > 1 ? `take ${i + 1}/${n}` : '' });
              await patchTrack(p.id, t.id, { status: 'gen' });
              const seed = t.lockSeed && Number.isInteger(t.seed) && i === 0 ? t.seed : Math.floor(Math.random() * 2147483647);
              const body = composeBody(t, { model, seed, phonetic: t.phonetic ?? !!prefs.phoneticNames, c2pa: !!prefs.c2pa, finetuneId: t.finetuneId || '', finetuneStrength: t.finetuneStrength ?? 1, plan: job.plan || null });
              const { blob, songId, meta } = await composeDetailed(body, apiKey);
              portal();
              const clipId = uid('clip_'); await putClip(clipId, blob);
              const durationMs = await clipDurationMs(blob);
              const qc = await qcOf(blob, (body.music_length_ms || planMs(body.composition_plan)) / 1000);
              const sm = meta.song_metadata || {};
              const title = (!t.title || /^Track \d+$/.test(t.title)) && sm.title ? sm.title : t.title;
              const backupFile = await save(title, clipId, blob);
              const lrc = meta.words_timestamps?.length ? lrcFromWords(meta.words_timestamps, { title, artist: p.artist || '', album: p.title || '' }) : '';
              if (lrc) await writeToDir(dir, `${await folder()}/${backupFile.replace(/\.[^.]+$/, '')}.lrc`, new Blob([lrc], { type: 'text/plain' })).catch(() => {});
              takes.push({ id: uid('k_'), clipId, durationMs, sizeBytes: blob.size, mime: blob.type, backupFile, seed: body.seed, songId, qc, at: Date.now(), lrc, plan: toChunks(meta.composition_plan), meta: { title: sm.title || '', description: sm.description || '', genres: sm.genres || [], languages: sm.languages || [], explicit: !!sm.is_explicit }, model });
            }
            const best = job.plan ? takes[0] : takes.reduce((x, y) => ((y.qc?.score ?? -1) > (x.qc?.score ?? -1) ? y : x));
            await updateProjectById(p.id, (pp) => ({ ...pp, tracks: (pp.tracks || []).map((x) => {
              if (x.id !== t.id) return x;
              const prev = x.clipId ? [repAsTake(x)] : [];
              const title = (!x.title || /^Track \d+$/.test(x.title)) && best.meta.title ? best.meta.title : x.title;
              return { ...x, ...takeToRep(best), title, status: 'ready', error: '', takes: [...(x.takes || []), ...prev, ...takes.filter((k) => k !== best)] };
            }) }));
          } else {
            const k = trackKey(t);
            twin = k && p.tracks.find((x) => x.id !== t.id && x.clipId && trackKey(x) === k);
            let blob = twin ? await getClip(twin.clipId) : null;
            if (!blob) { await patchTrack(p.id, t.id, { status: 'gen' }); blob = await tts({ text: t.text, voiceId: t.voiceId, model: t.ttsModel, apiKey }); portal(); }
            const clipId = t.clipId || uid('clip_'); // a regenerated line overwrites its own clip + file (same name)
            await putClip(clipId, blob);
            const durationMs = await clipDurationMs(blob);
            const backupFile = await save(t.title, clipId, blob);
            await patchTrack(p.id, t.id, { status: 'ready', clipId, durationMs, sizeBytes: blob.size, mime: blob.type, error: '', backupFile });
          }
          const saved = await freshProject(p.id); if (saved) writeSkeleton(saved);
          setJob(job.id, { state: twin ? 'reused' : 'done', at: Date.now(), note: '' }); ok++;
        } catch (e) {
          if (job.kind !== 'stems') await patchTrack(p.id, t.id, { status: 'error', error: e.message || String(e) });
          setJob(job.id, { state: 'error', error: e.message || String(e), at: Date.now() }); fail++;
        }
      }
    } finally {
      runningRef.current = false;
      if (ok + fail > 1) {
        showToast(`✦ Generation queue done — ${ok} ready${fail ? `, ${fail} failed` : ''}`);
        try { if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification('Music Studio', { body: `Generation queue done — ${ok} ready${fail ? `, ${fail} failed` : ''}` }); } catch { /* */ }
      }
    }
  }
  // Takes: delete some (clip + file + synced lyrics); the take in use is never among them.
  async function deleteTakes(t, ids) {
    const kill = (t.takes || []).filter((k) => ids.includes(k.id));
    for (const k of kill) {
      if (k.clipId) await deleteClip(k.clipId);
      if (dir && k.backupFile) for (const f of [k.backupFile, k.backupFile.replace(/\.[^.]+$/, '.lrc')]) await fsOp((d) => removeFromDir(d, `${albumPath(activeRef.current)}/${f}`));
    }
    await patchTrack(activeRef.current.id, t.id, { takes: (t.takes || []).filter((k) => !ids.includes(k.id)) });
    showToast(`🗑 ${kill.length} take${kill.length === 1 ? '' : 's'} deleted`);
  }
  // Redo one section: keep the song outside the range (ElevenLabs reuses the stored audio) and
  // regenerate only the middle. Needs the song stored at ElevenLabs — older audio is uploaded first.
  async function inpaintTrack(t, { from, to, text, styles }) {
    const projectId = activeRef.current?.id; if (!projectId) return;
    try {
      let songId = t.songId;
      if (!songId) {
        showToast('⇪ Uploading the current audio to ElevenLabs…');
        const blob = await getClip(t.clipId); if (!blob) throw new Error('audio not found');
        songId = (await uploadSong(blob, { withTimestamps: false, name: t.backupFile || 'song.mp3' }, apiKey)).songId;
        await patchTrack(projectId, t.id, { songId });
      }
      const plan = inpaintPlan(songId, t.durationMs, from * 1000, to * 1000, { text: text || '', positive_styles: String(styles || '').split(',').map((x) => x.trim()).filter(Boolean), negative_styles: [], context_adherence: 'high' });
      enqueue(projectId, [t.id], { plan });
    } catch (e) { showToast('Redo failed: ' + (e.message || e)); }
  }
  // 🎧 New tracks from an existing song's reverse-engineered plan (see FromSong).
  async function createFromSong(o) {
    const projectId = activeRef.current?.id; if (!projectId) return;
    setWizBusy('Adding…');
    try {
      const base = o.analysis.plan || { chunks: [] };
      const srcMs = await clipDurationMs(o.file);
      const cond = (plan) => (o.soundAlike && plan.chunks.length ? { chunks: plan.chunks.map((c, i) => (i === 0 && !c.song_id ? { ...c, conditioning_ref: { song_id: o.analysis.songId, range: { start_ms: 0, end_ms: Math.min(srcMs || 60000, 60000) } }, condition_strength: o.strength } : c)) } : plan);
      const name = o.file.name.replace(/\.[^.]+$/, '');
      const mk = (title, plan) => ({ id: uid('t_'), type: 'music', title, prompt: [...new Set(plan.chunks.flatMap((c) => c.positive_styles || []))].slice(0, 12).join(', '), lyrics: o.lyrics || '', usePlan: true, plan: cond(plan), respectDurations: true, lengthMs: Math.max(3000, planMs(plan)) || 60000, ...newTrackModel(prefs), instrumental: !o.lyrics, status: 'idle', gain: 1, sourceRef: { file: o.file.name, songId: o.analysis.songId } });
      const add = [];
      if (o.recreate) add.push(mk(`${name} (recreated)`, base));
      for (let k = 1; k <= (o.siblings || 0); k++) {
        setWizBusy(`Planning sibling ${k}/${o.siblings}…`);
        const prompt = `A new original song in the same style, instrumentation, tempo, structure and mood as the source plan, with a different melody${o.lyrics ? ' and new lyrics on a related theme' : ''}. ${o.direction || ''} Variation ${k} of ${o.siblings}: make it distinct from the others.`;
        let plan = base;
        try { plan = (await draftPlan({ prompt, lengthMs: planMs(base) || null, model: musicModelFor({}), source: { chunks: base.chunks.filter((c) => !c.song_id) } }, apiKey)) || base; } catch (e) { showToast('Sibling plan failed, using the source plan: ' + (e.message || e)); }
        add.push({ ...mk(`${name} — sibling ${k}`, plan), lyrics: '' });
      }
      await updateProjectById(projectId, (pp) => ({ ...pp, tracks: [...(pp.tracks || []), ...add] }));
      if (o.addOriginal) { await uploadTracks(projectId, [o.file]); }
      const saved = await freshProject(projectId); if (saved) writeSkeleton(saved);
      setModal(null);
      showToast(`🎧 Added ${add.length + (o.addOriginal ? 1 : 0)} track(s) from “${name}”`);
      if (o.generate && add.length) enqueue(projectId, add.map((t) => t.id));
    } catch (e) { showToast('From song failed: ' + (e.message || e)); }
    setWizBusy('');
  }
  // 🎬 A music track scored from video clips (videos live only in the queue job).
  async function createFromVideo(o) {
    const projectId = activeRef.current?.id; if (!projectId) return;
    const t = { id: uid('t_'), type: 'music', title: o.videos[0].name.replace(/\.[^.]+$/, '') + ' (score)', prompt: [o.description, o.tags.join(', ')].filter(Boolean).join(' — '), lengthMs: 60000, ...newTrackModel(prefs), instrumental: true, status: 'idle', gain: 1 };
    await updateProjectById(projectId, (pp) => ({ ...pp, tracks: [...(pp.tracks || []), t] }));
    setModal(null);
    enqueue(projectId, [t.id], { kind: 'video', videos: o.videos, video: { tags: o.tags, addSfx: o.addSfx, useAudioRef: o.useAudioRef } });
  }
  const activeJobs = jobs.filter((j) => j.state === 'queued' || j.state === 'running');

  async function exportData() {
    try { const bundle = await exportAllData(); download(new Blob([JSON.stringify(bundle)], { type: 'application/json' }), `musicstudio-backup-${new Date().toISOString().slice(0, 10)}.json`); showToast('💾 Backup downloaded'); }
    catch (e) { showToast('Backup failed: ' + (e.message || e)); }
  }
  async function importData() {
    const [f] = await pickFile('application/json,.json'); if (!f) return;
    if (!confirm('Restore REPLACES current albums, groups, playlists, attachments and settings. Audio recovers from your backup folder (🔎 Scan folder). Continue?')) return;
    try { await importAllData(JSON.parse(await f.text())); location.reload(); }
    catch (e) { alert('Restore failed: ' + (e.message || e)); }
  }

  const trackInfo = useMemo(() => { const m = new Map(); for (const p of projects) for (const t of p.tracks || []) m.set(t.id, { title: t.title, album: p.title || 'Album', albumId: p.id }); return m; }, [projects]);
  const groupView = groupViewId ? groups.find((g) => g.id === groupViewId) : null;
  const playlist = playlistId ? playlists.find((p) => p.id === playlistId) : null;

  return (
    <>
      <div className="topbar">
        <h1><span className="logo">◈</span> Music Studio</h1>
        <span className="dim" style={{ fontSize: 12 }}>ElevenLabs album builder</span>
        <div className="spacer" />
        {toast && <span style={{ fontSize: 12, color: 'var(--good)' }}>{toast}</span>}
        {justSynced && <span style={{ fontSize: 12, color: 'var(--good)' }}>↻ Synced from folder</span>}
        {!apiKey && <span className="dim" style={{ fontSize: 12 }}>⚠ No API key</span>}
        {dir
          ? <button className="folder-chip" onClick={() => setModal('settings')} title="Connected backup folder — click to change">📁 {dir.name}</button>
          : <button className="folder-chip warn" onClick={() => setModal('settings')} title="No backup folder — click to connect">⚠ Connect folder</button>}
        <button onClick={() => { setShowLibrary((v) => !v); setShowCloud(false); }} className={showLibrary ? 'primary' : ''} title="Every song in one searchable, sortable table, with library stats">📊 Library</button>
        <button onClick={() => setModal('build')} title="Build an album from pasted prompts, prompt files and/or audio files — paired up by title">🧩 Build album</button>
        <button onClick={() => setModal('reorg')} title="Move many groups/albums at once, or sort albums into groups by genre/year/artist">🗂 Reorganize</button>
        <button onClick={() => setModal('import')} disabled={!dir} title="Scan the folder for groups/albums created on disk (e.g. by a Claude Code session)">⟳ Import</button>
        <button onClick={() => setWatch((w) => !w)} disabled={!dir} title="Auto-reload album.json when an external editor (e.g. a Claude Code session) changes it">{watch ? '👁 Watching' : '👁 Watch off'}</button>
        <button onClick={() => setModal('cowork')} title="Hand your albums and prompts to an AI agent through a folder, and read its notes back">🤝 Cowork</button>
        <button onClick={() => { setShowCloud((v) => !v); setShowLibrary(false); if (!drive) connectDrive(); }} className={showCloud ? 'primary' : ''} title="Browse the desktop library published to Google Drive and choose what syncs to your phone">☁ Cloud{requests && pubDir && requestsPending(requests, 0) ? ' •' : ''}</button>
        <button onClick={() => setModal('sync')} disabled={!pubDir} title={pubDir ? `Choose which albums are synced to ${pubDir.name} (your device folder)` : 'Set a publish folder in Settings first'}>📱 Sync</button>
        {jobs.length > 0 && <button onClick={() => setModal('queue')} className={activeJobs.length ? 'primary' : ''} title="Generation queue — runs in the background while you browse">{activeJobs.length ? `✦ Generating ${jobs.filter((j) => j.state !== 'queued' && j.state !== 'running' && j.state !== 'cancelled').length + 1}/${jobs.filter((j) => j.state !== 'cancelled').length}` : '✦ Queue'}</button>}
        <button onClick={() => setModal('dashboard')} className="spend-btn" title={poolTitle(credits)}>💲 Spend
          {credits?.limit > 0 && <span className="pool" style={{ '--pct': `${Math.min(100, (credits.used / credits.limit) * 100)}%`, '--c': poolColor(credits) }} />}
        </button>
        {/* house standard: the signed-in Google picture, always visible; click opens Settings */}
        {createElement('app-account')}
        <button onClick={() => setModal('settings')}>⚙ Settings</button>
      </div>

      <div className={`app${showCloud || showLibrary ? ' solo' : ''}`} style={{ gridTemplateColumns: `${sidebarW}px 6px 1fr` }}>
        <div className="sidebar">
          <Sidebar groups={groups} projects={projects} playlists={playlists} activeId={active?.id} activeGroupId={groupViewId} activePlaylistId={playlistId} expanded={expanded}
            onToggle={(id) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; })}
            onOpen={open} onSelectGroup={selectGroup} onSelectPlaylist={selectPlaylist} onNewPlaylist={newPlaylist} onNewAlbum={newAlbum} onNewGroup={newGroup}
            onDeleteAlbum={removeAlbum} onDeleteGroup={removeGroup} onMove={moveItem} onRenameGroup={renameGroup}
            onCopyAlbumPath={copyAlbumPath} onCopyGroupPath={copyGroupPath} />
        </div>

        <div className="divider" onMouseDown={startResize} title="Drag to resize" />

        <div className="main">
          {showCloud
            ? <CloudLibrary catalog={catalog} requests={requests} busy={cloudBusy} isDesktop={!!pubDir}
                onSave={saveCloudRequest} onRefresh={() => (drive ? pullCloud() : connectDrive())} />
            : showLibrary
            ? <Library projects={projects} groups={groups} onOpenAlbum={(id) => { setShowLibrary(false); open(id); }} onRate={rateTracks} onGenerate={(b) => enqueueBatches(b)} playlists={playlists} onAddToPlaylist={addTracksToPlaylist} />
            : playlist
            ? <PlaylistView playlist={playlist} projects={projects} groups={groups} onChange={changePlaylist} onRename={() => renamePlaylist(playlist)} onDelete={() => removePlaylist(playlist)} onOpenAlbum={open} />
            : groupView
            ? <GroupView group={groupView} groups={groups} projects={projects} onOpenAlbum={open} onCopyPath={() => copyGroupPath(groupView)} onChangeGroup={async (up) => { await saveGroup({ ...groupView, ...up }); refreshGroups(); }} onAttachments={() => { setAttGroupId(groupView.id); setModal('attachments'); }} />
            : active
            ? <Editor project={active} apiKey={apiKey} prefs={prefs} voices={voices} ttsModels={ttsModels} backupReady={!!dir}
                group={groups.find((g) => g.id === active.parentId)} onTheme={setGroupTheme} coverUrl={coverUrl}
                updateProject={updateProject} backupClip={backupClip} writeSkeleton={writeSkeleton}
                onSetCover={setCover} onClearCover={clearCover} onDuplicateAlbum={() => duplicateAlbum(active)} onCopyPath={() => copyAlbumPath(active)}
                onExport={() => setModal('export')} onMetadata={() => setModal('metadata')} onAttachments={() => { setAttGroupId(null); setModal('attachments'); }} onLoadSkeleton={loadSkeleton} onScanFolder={scanAlbumFolder} onListAlbumAudio={listAlbumAudio} onLinkFile={linkTrackFile} onGenerate={(ids) => enqueue(active.id, ids)} onUpload={(files) => uploadTracks(active.id, files)} onDeleteTakes={deleteTakes} onInpaint={inpaintTrack} finetunes={finetunes} onFromSong={() => setModal('fromSong')} onFromVideo={() => setModal('fromVideo')} onStems={(t, variation) => enqueue(active.id, [t.id], { kind: 'stems', variation })} queued={activeJobs.filter((j) => j.projectId === active.id).length}
                playlists={playlists} onAddToPlaylist={addTracksToPlaylist} onPublish={() => publishOne(active)} publishName={pubDir?.name} />
            : <div className="empty" style={{ marginTop: 40 }}>Select an album on the left, or create one.<br />{!apiKey && 'Add your ElevenLabs API key in Settings, and '}set a backup folder (outside the app) before generating.</div>}
        </div>
      </div>

      {modal === 'settings' && (
        <Settings finetunes={finetunes} projects={projects} onRefreshFinetunes={loadFinetunes} onCreateFinetune={makeFinetune} apiKey={apiKey} prefs={prefs} voices={voices} ttsModels={ttsModels} backupName={dir?.name} publishName={pubDir?.name}
          onClose={() => setModal(null)} onVoices={setVoices}
          onSave={async (k, p) => { await setSetting('apiKey', k); await setSetting('prefs', p); setApiKey(k); setPrefs(p); setModal(null); if (k && !voices.length) listVoices(k).then(setVoices).catch(() => {}); if (k) listTtsModels(k).then((m) => m.length && setTtsModels(m)).catch(() => {}); }}
          onPickBackup={pickBackup} onClearBackup={dropBackup} onPickPublish={pickPublish} onClearPublish={dropPublish} onManageSync={() => setModal('sync')} onExportData={exportData} onImportData={importData}
          driveOn={drive} driveEmail={driveProfile()?.email} drivePicture={driveProfile()?.picture} driveAvailable={!!driveClientId(prefs)} cloudBusy={cloudBusy}
          onConnectDrive={async () => { await setSetting('driveOn', true); connectDrive(); }}
          onDisconnectDrive={async () => { await setSetting('driveOn', false); disconnectDrive(); }}
          onPushCatalog={async () => { setCloudBusy('Pushing…'); try { const c = await pushCatalog(); showToast(`☁ Published ${c.albums.length} albums to Drive`); } catch (e) { showToast('Push failed: ' + (e.message || e)); } setCloudBusy(''); }} />
      )}
      <PlayerBar info={(id) => trackInfo.get(id)} onOpenAlbum={(id) => { setShowLibrary(false); setShowCloud(false); open(id); }} />
      {spendAsk && <ConfirmSpend ask={spendAsk} onCancel={() => setSpendAsk(null)}
        onConfirm={async (dontAsk) => { const a = spendAsk; setSpendAsk(null); if (dontAsk) { const np = { ...prefs, confirmSpend: false }; setPrefs(np); await setSetting('prefs', np); } enqueueBatches(a.batches, { ...a.opts, confirmed: true }); }} />}
      {modal === 'fromSong' && active && <FromSong apiKey={apiKey} busy={wizBusy} onCreate={createFromSong} onClose={() => setModal(null)} />}
      {modal === 'fromVideo' && active && <FromVideo onCreate={createFromVideo} onClose={() => setModal(null)} />}
      {modal === 'queue' && <GenQueue jobs={jobs} onCancel={cancelJob} onRetry={(j) => enqueue(j.projectId, [j.trackId])} onClear={() => setJobsBoth((js) => js.filter((j) => j.state === 'queued' || j.state === 'running'))} onOpenAlbum={(id) => { setModal(null); setShowLibrary(false); setShowCloud(false); open(id); }} onClose={() => setModal(null)} />}
      {modal === 'dashboard' && <Dashboard credits={credits} onClose={() => setModal(null)} />}
      {modal === 'cowork' && <Cowork projects={projects} groups={groups} onClose={() => setModal(null)} />}
      {modal === 'build' && <BuildAlbum groups={groups} busy={wizBusy} onCreate={buildAlbum} onClose={() => setModal(null)} />}
      {modal === 'reorg' && <Reorganize groups={groups} projects={projects} busy={wizBusy} onApply={applyRearrange} onClose={() => setModal(null)} />}
      {modal === 'sync' && pubDir && <DeviceSync projects={projects} groups={groups} syncMap={syncMap} deviceName={pubDir.name} busy={syncBusy} onApply={applySync} onClose={() => setModal(null)} />}
      {modal === 'export' && active && <Export project={active} backupDir={dir} backupName={dir?.name} albumDir={albumPath(active)} gapMs={prefs.gapMs} onClose={() => setModal(null)} />}
      {modal === 'metadata' && active && <Metadata project={active} onChange={updateProject} onClose={() => { setModal(null); writeSkeleton(); }} />}
      {modal === 'attachments' && (attGroupId ? groups.some((g) => g.id === attGroupId) : active) && <Attachments project={attGroupId ? groups.find((g) => g.id === attGroupId) : active} title={attGroupId ? `Group attachments — ${groups.find((g) => g.id === attGroupId)?.name}` : 'Album attachments'} where={attGroupId ? 'group' : 'album'} onAddNote={addNote} onAddFiles={addFiles} onDelete={removeAttachment} onDownload={downloadAttachment} onClose={() => setModal(null)} />}
      {modal === 'import' && dir && (
        <Import ignored={ignored} onClose={() => setModal(null)}
          onScan={() => scanAlbums(dir, [])}
          onApply={async (ignoreArr) => { setIgnored(ignoreArr); await setSetting('ignoredFolders', ignoreArr); const r = await importFromFolder(false, { ignored: ignoreArr }); alert(`Imported ${r.groups} group(s) and ${r.albums} album(s); updated ${r.refreshed || 0} album(s) edited on disk.`); }} />
      )}
    </>
  );
}
