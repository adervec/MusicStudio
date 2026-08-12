# Music Studio

An **ElevenLabs album builder** that runs entirely in your browser. Curate prompts, generate songs
with the ElevenLabs Music API, splice in dialog (TTS) and your own uploads, mix and reorder, export
tagged albums — and push finished albums to your phone.

**▶ [Open Music Studio](https://adervec.github.io/MusicStudio/)** — no install, no accounts, no server.

Your data stays on your device (IndexedDB) plus a local folder you choose. Your ElevenLabs API key
is stored on-device and sent only to ElevenLabs.

## Highlights

- **Albums in nested groups**, each with a description, full metadata, and per-group visual themes.
- **Generate** songs (`/v1/music`) and dialog (TTS); "Generate all gaps" fills a whole album, reusing
  duplicate prompts instead of paying twice, with a cost estimate before you commit.
- **Edit & preview** — waveforms with click-to-seek, trim/fade/gain, reorder, favorites, multi-select,
  shuffle/repeat, static and rule-based dynamic playlists.
- **Export** — tagged track files (+ cover art, + `.m3u`) or one crossfaded album mixdown.
- **Local backup folder** — every clip is mirrored to disk; if the browser database is cleared, the
  folder restores everything, audio included.
- **Agent workflow** — the backup folder holds an `AGENT.md` and one `album.json` per album, so a
  separate Claude Code session can design albums (tracks, prompts, metadata) that the app live-reloads.
- **Device sync + phone remote** — see below.
- **Spend dashboard** — estimated cost per day / model / call, monthly budget, CSV export, live credits.

## Getting your music onto your phone

Two folders, two different jobs:

| Folder | Holds | Purpose |
|---|---|---|
| **Backup folder** | everything: `album.json`, attachments, every generated clip | the master library + the agent hand-off surface |
| **Publish folder** | only the albums you pick, as numbered tagged tracks + `.m3u` | point it at a synced drive (Google Drive, Dropbox, …) and your phone plays it |

**📱 Sync** lists every album with a checkbox: tick what belongs on the device, and Apply reconciles
the publish folder — publishing what's missing or stale and removing what you unticked. Folders
without an `.m3u` are never touched, so anything else in that drive is safe.

### Phone remote (Google Drive)

Open the same URL on your phone and connect Google Drive to get a **read-only view of your desktop's
library** — every album with its description, metadata, and full tracklist (prompts included) — and
tick which albums you want on the device. The request is saved to Drive; **your desktop applies it
the next time Music Studio is running**, then republishes the catalog so the phone shows ✓ on device.

Only small JSON travels through the Drive API, into Drive's *private app folder* (`drive.appdata`),
which no other app can read. The audio never goes through it: your desktop writes the files to the
publish folder and your normal Drive sync client carries them to the phone.

## Run it locally

```
cd app
npm install
npm run dev        # http://localhost:5173
```

Then open **Settings** and paste your ElevenLabs API key (elevenlabs.io → Profile → API Keys).
Folder backup, publishing, and device sync need Chrome or Edge (File System Access API); elsewhere
export falls back to a browser download.

On Windows, `Launch Music Studio.cmd` installs dependencies on first run and opens the app.

## Install as an app (PWA)

Open the hosted URL (or `npm run build && npm run preview`) in Chrome/Edge and use the install icon
in the address bar. It works offline; your data is local anyway.

## Test

```
cd app
node src/audio/wav.test.mjs     # WAV/ID3/m3u, pricing, skeleton, import, sync + catalog planning
```

## Layout

- `src/state/db.js` — IndexedDB (projects, groups, playlists, clips, attachments, spend log, settings)
- `src/api/elevenlabs.js` — music compose / TTS / voices / credits (+ spend logging)
- `src/album/skeleton.js` — `album.json` + `AGENT.md` build/merge, import planning, prompt parsing
- `src/audio/wav.js` — decode, album mixdown, WAV/ID3/m3u encoding
- `src/backup/` — File System Access folders: `fs.js`, `publish.js` (device files), `sync.js` (planner)
- `src/cloud/` — Google Drive channel: `drive.js` (OAuth + appdata), `catalog.js` (catalog/requests)
- `src/components/` — the UI

## Privacy

See [PRIVACY.md](PRIVACY.md). Short version: there is no backend. Data goes to ElevenLabs (your
prompts, with your key) and optionally to your own Google Drive app folder. Nothing goes anywhere else.

## License

MIT — see [LICENSE](LICENSE).
