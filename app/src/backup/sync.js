// Device-sync planning (pure, node-testable): decide which albums to (re)publish to the device
// folder and which device folders to remove, so the folder mirrors the user's selection.
import { sanitizeFilename } from '../audio/wav.js';

// syncMap: { [projectId]: { on: bool, at: ms } } — `at` is when the album was last published.
// deviceDirs: [{ name, hasM3u }] — folders currently in the publish dir; the .m3u is the marker
// that a folder is app-published (foreign folders are never touched).
// ponytail: albums are keyed by sanitized title on the device — two albums with the same title collide.
export function planSync(projects, syncMap, deviceDirs) {
  const dirNames = new Set((deviceDirs || []).map((d) => d.name));
  const on = (projects || []).filter((p) => syncMap?.[p.id]?.on);
  const keep = new Set(on.map((p) => sanitizeFilename(p.title || 'Album')));
  const toWrite = on.filter((p) =>
    (p.tracks || []).some((t) => t.clipId) &&
    (!dirNames.has(sanitizeFilename(p.title || 'Album')) || (p.updatedAt || 0) > (syncMap[p.id].at || 0)));
  const toRemove = (deviceDirs || []).filter((d) => d.hasM3u && !keep.has(d.name)).map((d) => d.name);
  return { toWrite, toRemove };
}
