# Music Studio — TODO

## Ratings, notes and taste profile (exposed to AI agents)

_Requested 2026-10-09._

**Goal:** rate and annotate what I've made, so that when I tell an agent (Claude Cowork / Claude Code)
"make more stuff like what I liked", it knows what I liked and why.

### Rate
- Rate **songs, albums and groups** (e.g. 1–5 stars, half steps allowed?).
- Every level shows **two numbers side by side**:
  - **My rating**: what I set directly (may be empty).
  - **Calculated rating**: rolled up from its sub-parts (album ← its songs, group ← its albums and
    sub-groups, recursively). Ignore unrated children; show how many children it's based on
    ("4.2 from 7 songs").
  - Open question: plain mean, or weight songs by length / give my direct child ratings priority?
- Rating should be quick: inline stars in the editor track header, album header, group view, and a
  sortable/filterable column in 📊 Library (e.g. "★ ≥ 4", "unrated").

### Notes, likes, dislikes
- On songs, albums and groups: free-text **notes**, plus quick **👍 likes / 👎 dislikes** as short
  tags or phrases ("the arp at 1:10", "vocals too thin", "love the tape hiss").
- Searchable in 📊 Library.

### Expose to agents
- Carry rating, notes, likes and dislikes in each album's `album.json` (album-level + per track),
  marked human-owned: agents read them, never edit them.
- Write a library-wide **taste profile** at the backup-folder root (e.g. `TASTE.md` + `taste.json`)
  that agents read first. It should cover:
  - top-rated songs and albums, with their prompts, genre and metadata;
  - recurring likes and dislikes;
  - what the low-rated material has in common.
  It should be regenerated (debounced, like the file-tag sync) whenever ratings or notes change.
- `AGENT.md` and the 🤝 Cowork handoff point at it: "when asked for more of what the human liked, start
  from TASTE.md and the prompts of the highest-rated tracks; avoid what they disliked".
- Optional: include ratings in the phone ☁ Cloud catalog so ratings can be set from the phone (would
  need the phone → desktop request channel to carry them).

## Feature ideas from similar projects (GitHub scan, 2026-11-07)

Ranked by value for this workflow. Sources at the end.

### From the ElevenLabs API itself (endpoints the app doesn't use yet)
1. **Reverse-engineer an existing song → composition plan.** `POST /v1/music/upload` with
   `extract_composition_plan` returns the song's section plan (+ word timestamps). Turns the
   chat-based "reverse-engineer an album from a song" workflow into one click: drop a song in →
   get an editable plan → generate siblings from it.
2. **Composition plans.** `composition_plan` (sections with durations, per-section styles, lyrics)
   instead of one flat prompt; `POST /v1/music/plan` drafts one from a prompt. Editable section list
   per track; `respect_sections_durations`. (The ElevenLabs desktop generator saves/reopens
   `.plan.json` files.)
3. **Takes / variations, curated.** Generate N takes per track, keep the best as the track's
   "representative", stack the rest underneath, "delete all but the favourite" (Suno Library
   Organizer). The user's library already has an `Inputs/Duplicate takes` folder — this would replace it.
4. **Seed.** Store the `seed` per generation so a good result can be re-made or nudged.
5. **Lyrics.** `lyrics_text` field per track; `/v1/music/detailed` `with_timestamps` → write synced
   `.lrc` next to the audio (foobar2000 shows synced lyrics).
6. **Auto-title from the detailed response.** `/v1/music/detailed` returns the song's own metadata —
   name untitled tracks from it (ElevenLabs desktop generator does this).
7. **Finetunes from liked songs.** `POST /v1/music/finetunes` trains on audio files; pairs with the
   ratings TODO: "train a finetune on my 5★ songs", then generate with `finetune_id` / `finetune_strength`.
8. **Stem separation** (`/v1/music/stem-separation`) per track → stems in `<album>/stems/`.
9. **Inpainting** (`store_for_inpainting`): regenerate one section of a song without redoing the rest.
10. **Sound effects tracks** (`/v1/sound-generation`, Sound Effects v3, loopable 0.5–30 s) for
    interludes/transitions, alongside Song / Dialog / Upload.
11. **Video → music** (`/v1/music/video-to-music`): score a clip.
12. `use_phonetic_names` toggle (better pronunciation of proper names — relevant for Croatian titles),
    `sign_with_c2pa` toggle.

### From other apps
- **Confirm before spending**: one dialog with model, length, takes and estimated credits for every
  generate, not just bulk (ElevenLabs desktop generator).
- **Best-of-N with automatic quality scoring** (The Muser: 9-metric analysis, letter grades) — at
  least loudness/clipping/silence checks to flag broken generations.
- **Notes on takes feed the next generation** ("great vocals on take 2") — same idea as the ratings
  TODO above (Suno Library Organizer's "annotation-driven learning").
- **Library logbook export**: full CSV/JSON index with prompts, models, seeds, file paths (Suno Backup).
- **Multi-select with Shift/Ctrl** in the Library table + bulk actions (move, tag, queue, delete).

Sources: ElevenLabs OpenAPI spec (api.elevenlabs.io/openapi.json);
[OnjLouis/ElevenLabsMusicGenerator](https://github.com/OnjLouis/ElevenLabsMusicGenerator);
[alexiltabaccaio/suno-library-organizer](https://github.com/alexiltabaccaio/suno-library-organizer);
[noah-chelednik/the-muser](https://github.com/noah-chelednik/the-muser);
[amourification/Suno-Backup](https://github.com/amourification/Suno-Backup);
[chahero/suno-manager](https://github.com/chahero/suno-manager).
