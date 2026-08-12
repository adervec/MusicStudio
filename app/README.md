# Music Studio

An ElevenLabs **album builder** — modeled on Tachyread's audiobook builder, but for making music.
React + Vite, all data on-device (IndexedDB), calls ElevenLabs directly with your own API key.

## What it does

- **Organize** — every album lives in a **group**; groups nest (groups within groups). Move albums/groups with the inline picker. Each group has a **visual theme** that skins the app whenever one of its albums is open.
- **Curate prompts** — each album is a list of tracks; a "Song" track holds a text prompt, length, model, and instrumental flag you can edit freely.
- **Describe + full metadata** — an album **description** (creative brief) plus every standard field (album artist, genre, year, composer, publisher, copyright, BPM, disc no., UPC, ISRC, comment, …), baked into export tags.
- **Generate** — one click calls the ElevenLabs **Music API** (`POST /v1/music`) and stores the returned audio. Regenerate any time.
- **Splice dialog** — "Dialog" tracks synthesize spoken lines via ElevenLabs TTS (pick any voice from your account).
- **Upload** — add your own audio files as tracks.
- **Attachments** — attach style guides, inspirations, and notes (typed, or AI-generated text you paste, or uploaded files) to an album. They're written to `<album>/attachments/` so the external agent reads them as reference.
- **Installable (PWA)** — install to your desktop / home screen; works offline (your data is local anyway).
- **Generate all gaps** — one click renders every track that has no audio yet.
- **Style presets** — append vetted style snippets to a song prompt from a dropdown.
- **Preview / edit / reorder** — a transport with play/**pause**, **prev/next**, **shuffle**, **repeat (off/all/one)**, track **N/total**, and a seek bar; play-all across an album; reorder with ▲▼; per-track **volume, trim, fade in/out**; duplicate track/album.
- **Group overview** — click a group to see all its songs (read-only, recursive) and **Play all** across the whole group.
- **Playlists** — **static** (hand-pick tracks, reorder) or **dynamic** (rule-based: all songs, a group, a track type, an album genre, or a title/prompt search). Play any playlist with full shuffle/repeat.
- **Cover art** — set an album cover; it's mirrored to the folder and embedded in MP3 exports.
- **Search** — filter albums by name in the sidebar.
- **Export as album** — separate tagged track files (+ cover, + `.m3u`; edited tracks rendered) **or** one mixed-down WAV with per-track edits and gaps **or a crossfade**.
- **Spend controls** — monthly budget with an over-budget warning, and CSV export of usage.
- **Local backup folder** — pick a folder once; every song, dialog clip, and upload is auto-written to `<folder>/<album>/`. Generation is **blocked until a folder is set, and the folder cannot be the running app** (fingerprint-checked).
- **Full recovery** — the folder is a true backup: if the browser database is cleared, re-adding the folder re-discovers every group/album **and re-attaches the audio** from the files on disk (no regeneration).
- **Spend dashboard** — estimated ElevenLabs cost (music ≈ $0.15/min, dialog by characters), per day / per model / per call, monthly budget, CSV export; **live credit balance** shown in Settings. "Generate all gaps" shows an **estimated cost** (dedup-aware) before you commit.
- **Playback shortcuts** — spacebar play/pause, ←/→ prev/next track.
- **Waveforms** — every ready track shows a waveform with playback progress; click to seek.
- **Favorites** — star tracks (★); a dynamic "Favorites" playlist collects them.
- **Multi-select** — tick tracks to bulk play, delete, or add to a playlist.
- **App backup / restore** — download a JSON of all albums/groups/playlists/attachments/settings and restore it (audio recovers from the folder).
- **Desktop notifications** — get notified when "Generate all gaps" finishes.
- **Device sync** — a second "publish" folder (point it at a drive your phone syncs, e.g. Google Drive + AutoSync): **📱 Sync** shows every album with a checkbox — tick what should live on the device, Apply reconciles the folder (publishes missing/stale albums as numbered tagged tracks + `.m3u`, removes deselected ones; folders without an `.m3u` are never touched). **⇪ Publish** pushes one album immediately.
- **Phone remote (Google Drive)** — **☁ Cloud** on your phone shows the desktop's whole library (descriptions, metadata, tracklists with prompts) and lets you tick which albums you want on the device. The request is saved to Drive's private app folder; the desktop applies it the next time it runs and republishes the catalog, so the phone shows ✓ on device. Text only — the audio still travels via the publish folder and your normal Drive sync client.
- **Paste prompts** — **📋 Paste prompts** turns a block of prompts written elsewhere (e.g. a Claude chat) into a new album: numbered "Title — prompt" lines, "Title: prompt", or headings + paragraphs.

## Hand off the skeleton to another Claude Code session

The backup folder mirrors the app's group tree, with one instruction file at its root:

- `AGENT.md` (at the **backup-folder root**) — general instructions for a Claude Code agent covering the whole folder.
- `<group>/<subgroup>/<album>/album.json` — each album's full, editable spec (description, metadata, ordered tracks + prompts). The description is the per-album brief; `attachments[]` point to that album's `attachments/` files.

An album's folder path reflects its groups (e.g. `Soundtracks/Chapter 1/Night City/album.json`); ungrouped albums sit at the root. Creating, renaming, moving, or deleting a group or album **updates the real folders on disk immediately** (rename/move relocate the folder; delete removes it). The connected backup folder is always shown as a chip in the top bar — click it to change.

Workflow: write a **description** in Music Studio → **⤓ Write skeleton** → open a *separate* Claude Code
session pointed at that folder → the agent reads `AGENT.md` and fills in `album.json` (tracks, prompts,
dialog, metadata) → back in Music Studio, **⤒ Load skeleton** re-imports it (already-generated audio is
preserved) → generate. The agent only designs; it never calls ElevenLabs.

**Live sync:** with **👁 Watching** on (default), Music Studio polls the open album's `album.json`
every 2.5s and auto-reloads it the moment the agent saves — no manual "Load skeleton" needed. The
app's own writes are ignored, so there's no reload loop. The sidebar/main split is drag-resizable.

**Backfill pre-existing audio:** to organize music made *before* this app, the agent drops the existing
audio files into an album folder and references each with `"importFile": "<filename>"` in `album.json`.
On import the app pulls those files in as ready tracks (not gaps) — no regeneration, no spend.

**Handoffs & reverse-engineering:** drop chat-written specs into `Inputs/Handoffs/` and the agent
turns each into a real album. To reverse-engineer from a finished song, analyze it in a chat (chat
agents can listen), save the breakdown as a handoff doc, and the agent writes prompts modeled on
it — pulling the source song in via `importFile` instead of regenerating it.

**Agent-created albums & groups:** the agent can also *create* new albums and groups by making folders
(a folder with an `album.json` is an album; its parent folders are groups). Music Studio discovers them
automatically (a background scan every ~7s, on connect, and on load) and via **⟳ Import**. In the Import
dialog you can mark root folders to **ignore** (e.g. an `Inputs` or `Music` folder that isn't an album);
ignored names are remembered. Matching is by album-id (or folder path), so re-scans never duplicate.

## Run

```
npm install
npm run dev      # http://localhost:5173
```

Open **Settings** and paste your ElevenLabs API key (Profile → API Keys at elevenlabs.io). It is
stored on your device only and sent solely to ElevenLabs. Folder backup + album export to a folder
need Chrome or Edge; elsewhere export falls back to a browser download.

## Install as an app (PWA)

```
npm run build && npm run preview
```

Open the previewed URL in Chrome/Edge and use the install icon in the address bar (or ⋮ → Install).
Icons are generated by `node scripts/gen-icons.mjs`; the offline service worker is `public/sw.js`.

## Test

```
node src/audio/wav.test.mjs     # WAV/ID3/m3u + pricing + skeleton self-check
```

## Layout

- `src/state/db.js` — IndexedDB (projects, groups, clip blobs, attachments, spend log, backup handle, settings)
- `src/state/pricing.js` — cost estimates + dashboard aggregation
- `src/api/elevenlabs.js` — music compose / TTS / voices (+ spend logging)
- `src/album/skeleton.js` — album.json + AGENT.md build/merge, metadata field set, export tags
- `src/audio/wav.js` — decode, album mixdown, WAV/ID3/m3u encoding
- `src/backup/fs.js` — File System Access backup folder + app-folder guard
- `src/components/` — `Editor`, `Sidebar` (group tree), `Metadata`, `Attachments`, `Dashboard`, `Settings`, `Export`, `Dialog`
