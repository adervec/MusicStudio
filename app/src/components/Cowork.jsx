import { musicModelFor } from '../api/elevenlabs.js';
import { useEffect, useRef, useState } from 'react';
import Dialog from './Dialog.jsx';

// The maker's shared cowork panel: the same component every app in the stable shows, so the
// AI hand-off looks and behaves identically here, in GymTracker, in the portal and in
// CoworkSyncHub. It runs in "fs mode" — it owns a folder you pick, writes the request into it
// and reads the reply back. Injected at runtime the way drive.js loads Google's client, so the
// app still starts if it cannot be fetched.
//
// This is deliberately NOT the album.json channel. That one is a design hand-off an agent
// *writes* (see AGENT.md); this one is read-only advice about the albums you already have, so
// the two can never race on the same file. Point it at any scratch folder, or at the backup
// folder — it only ever touches cowork.json and coach/.
const COWORK_JS = 'https://adervec.github.io/cowork.js';

function loadCowork() {
  if (window.cowork) return Promise.resolve(window.cowork);
  const head = document.head || document.documentElement;
  if (!head || typeof head.appendChild !== 'function') return Promise.resolve(null);
  return new Promise((res) => {
    try {
      const s = document.createElement('script');
      s.src = COWORK_JS;
      s.async = true;
      s.onload = () => res(window.cowork || null);
      s.onerror = () => res(null);
      head.appendChild(s);
    } catch { res(null); }
  });
}

function coachHash(t) {
  let h = 5381;
  for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

const INSTRUCTIONS = `# Music Studio — coach channel

Read \`coach/request.json\`. \`payload.albums\` is every album in the studio: title, artist,
description (the creative brief), group, and each track's type, title, prompt or dialog text,
length, model, and whether the audio has been generated yet. \`payload.totals\` counts albums,
tracks, generated tracks and unfilled gaps.

Write \`coach/reply.json\`:

\`\`\`json
{ "requestHash": "<copy the request's requestHash verbatim>",
  "reply": "<short markdown: which album is closest to finished and what it still needs, the
  one prompt that is vaguest and a sharper rewrite of it, and whether the running order does
  what the description says it should. Concrete and specific to these albums.>" }
\`\`\`

Judge prompts on what a music model can actually use: genre, instrumentation, tempo, mood,
production, arc. Do not write any file except \`coach/reply.json\` — album.json is a separate
channel with its own rules in AGENT.md, and editing it from here would collide with the app's
live watcher.`;

export default function Cowork({ projects, groups, onClose }) {
  const host = useRef(null);
  const dataRef = useRef({ projects, groups });
  dataRef.current = { projects, groups };
  const [reply, setReply] = useState(() => {
    try { return localStorage.getItem('ms-coach-reply') || ''; } catch { return ''; }
  });

  useEffect(() => {
    let dead = false;
    loadCowork().then((cw) => {
      if (dead || !cw || !host.current || host.current.childElementCount) return;
      cw.mount(host.current, {
        app: 'musicstudio',
        manifest: {
          protocol: 'cowork-manifest', protocolVersion: 1, app: 'musicstudio',
          channels: [{
            name: 'coach', request: ['coach/request.json'],
            instructions: 'coach/INSTRUCTIONS.md', replyPath: 'coach/reply.json',
          }],
        },
        files: () => {
          const { projects: ps, groups: gs } = dataRef.current;
          const groupName = (id) => gs.find((g) => g.id === id)?.name || null;
          const albums = (ps || []).map((p) => ({
            title: p.title || '', artist: p.artist || '', group: groupName(p.groupId),
            description: p.description || '',
            tracks: (p.tracks || []).map((t) => ({
              title: t.title || '', type: t.type,
              prompt: t.type === 'music' ? (t.prompt || '') : (t.text || ''),
              lengthSec: Math.round((t.lengthMs || 0) / 1000),
              model: t.type === 'music' ? musicModelFor(t) : null, instrumental: !!t.instrumental,
              generated: !!t.clipId,
            })),
          }));
          const tracks = albums.reduce((n, a) => n + a.tracks.length, 0);
          const generated = albums.reduce((n, a) => n + a.tracks.filter((t) => t.generated).length, 0);
          const payload = {
            totals: { albums: albums.length, tracks, generated, gaps: tracks - generated },
            albums,
          };
          return {
            'coach/request.json': {
              protocol: 'musicstudio-coach', protocolVersion: 1, kind: 'coach-request',
              generatedAt: new Date().toISOString(),
              requestHash: coachHash(JSON.stringify(payload)), payload,
            },
            'coach/INSTRUCTIONS.md': INSTRUCTIONS,
          };
        },
        apply: (ch, r) => {
          const text = typeof r === 'string' ? r
            : (r && (r.reply || (r.payload && r.payload.reply))) || JSON.stringify(r, null, 2);
          try { localStorage.setItem('ms-coach-reply', text); } catch { /* quota */ }
          setReply(text);
        },
      });
    });
    return () => { dead = true; };
  }, []);

  return (
    <Dialog title="AI cowork sync" onClose={onClose} width={640}>
      <p className="note">
        Hand your albums, briefs and prompts to an agent through a folder on this device —
        CoworkSyncHub, Claude Desktop, or a person — and its notes come back here. Nothing is
        uploaded, and only <code>cowork.json</code> and <code>coach/</code> are written, so this
        never collides with the <code>album.json</code> hand-off.
      </p>
      <div ref={host} />
      {reply && <pre className="note" style={{ whiteSpace: 'pre-wrap', marginTop: 12 }}>{reply}</pre>}
    </Dialog>
  );
}
