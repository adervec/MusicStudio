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
