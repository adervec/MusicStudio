// ElevenLabs client — called directly from the browser with the user's own API key (key stays
// on-device, never leaves except to ElevenLabs). Music generation (compose) + dialog (TTS) + voices.
// Each successful call logs to the spend dashboard. Pattern from Tachyread's elevenLabs.js.
import { recordUsage } from '../state/db.js';
import { musicCost, ttsCost } from '../state/pricing.js';

const BASE = 'https://api.elevenlabs.io/v1';

export function configured(key) { return !!(key && key.trim()); }

export const MUSIC_MODELS = [
  { id: 'music_v2_5', label: 'Music v2.5 — newest / best quality' },
  { id: 'music_v2', label: 'Music v2' },
  { id: 'music_v1', label: 'Music v1 — deprecated' },
];
// Tracks follow the newest model unless the human pinned one in the app (t.modelPinned). The stored
// t.model of an unpinned track is history (whatever was current when it was made), never a choice —
// so a new model release upgrades every gap automatically. Put new models FIRST in MUSIC_MODELS.
export const LATEST_MUSIC_MODEL = MUSIC_MODELS[0].id;
export const musicModelFor = (t) => (t?.modelPinned && MUSIC_MODELS.some((m) => m.id === t.model) ? t.model : LATEST_MUSIC_MODEL);
// Model fields for a new track from the Settings default ('latest' = follow the newest).
export const newTrackModel = (prefs) => (prefs?.musicModel && prefs.musicModel !== 'latest' && MUSIC_MODELS.some((m) => m.id === prefs.musicModel)
  ? { model: prefs.musicModel, modelPinned: true } : { model: LATEST_MUSIC_MODEL, modelPinned: false });
// Compose prompt limit, from ElevenLabs' OpenAPI spec (verified 2026-10-04).
export const MUSIC_PROMPT_MAX = 4100;
export const TTS_MODELS = [
  { id: 'eleven_v3', label: 'Eleven v3 — most expressive' },
  { id: 'eleven_multilingual_v2', label: 'Multilingual v2 — best quality' },
  { id: 'eleven_turbo_v2_5', label: 'Turbo v2.5 — faster / cheaper' },
  { id: 'eleven_flash_v2_5', label: 'Flash v2.5 — fastest / cheapest' },
];

async function errorFrom(r) {
  if (r.status === 401) return 'Invalid ElevenLabs API key.';
  if (r.status === 429) return 'ElevenLabs rate limit / quota reached.';
  try { const e = await r.json(); return (e?.detail?.message || (typeof e?.detail === 'string' ? e.detail : null) || `ElevenLabs error ${r.status}`); }
  catch { return `ElevenLabs error ${r.status}`; }
}

// Generate a song from a text prompt → audio/mpeg Blob. lengthMs 3000–600000. Logs music spend.
export async function composeMusic({ prompt, lengthMs = 60000, model = LATEST_MUSIC_MODEL, instrumental = false, apiKey }) {
  const body = {
    prompt: (prompt || '').trim(),
    music_length_ms: Math.max(3000, Math.min(600000, Math.round(lengthMs))),
    model_id: model,
    force_instrumental: !!instrumental,
  };
  const r = await fetch(`${BASE}/music?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': (apiKey || '').trim(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await errorFrom(r));
  await recordUsage({ kind: 'music', model, source: 'compose', ms: body.music_length_ms, costUsd: musicCost(body.music_length_ms) });
  return new Blob([await r.arrayBuffer()], { type: 'audio/mpeg' });
}

// Synthesize dialog/narration → audio/mpeg Blob. Logs tts spend.
export async function tts({ text, voiceId, model = 'eleven_multilingual_v2', apiKey }) {
  const r = await fetch(`${BASE}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': (apiKey || '').trim(), 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text: (text || '').trim(), model_id: model }),
  });
  if (!r.ok) throw new Error(await errorFrom(r));
  const chars = (text || '').trim().length;
  await recordUsage({ kind: 'tts', model, source: 'dialog', chars, costUsd: ttsCost(chars) });
  return new Blob([await r.arrayBuffer()], { type: 'audio/mpeg' });
}

// The account's credit balance → { used, limit, remaining, tier }. Character-credit based. Throws on a bad key.
export async function getSubscription(apiKey) {
  const r = await fetch(`${BASE}/user/subscription`, { headers: { 'xi-api-key': (apiKey || '').trim() } });
  if (!r.ok) throw new Error(await errorFrom(r));
  const j = await r.json();
  const used = j.character_count || 0, limit = j.character_limit || 0;
  return { used, limit, remaining: Math.max(0, limit - used), tier: j.tier || '' };
}

// TTS models live from the account (new ones appear without an app update) → [{ id, label }].
// The static TTS_MODELS above is only the offline fallback. Music has no list endpoint.
export async function listTtsModels(apiKey) {
  const r = await fetch(`${BASE}/models`, { headers: { 'xi-api-key': (apiKey || '').trim() } });
  if (!r.ok) throw new Error(await errorFrom(r));
  return (await r.json()).filter((m) => m.can_do_text_to_speech).map((m) => ({ id: m.model_id, label: m.name || m.model_id }));
}

// The account's voices → [{ id, name, category }]. Throws on a bad key / network error.
export async function listVoices(apiKey) {
  const r = await fetch(`${BASE}/voices`, { headers: { 'xi-api-key': (apiKey || '').trim() } });
  if (!r.ok) throw new Error(await errorFrom(r));
  const j = await r.json();
  return (j.voices || []).map((v) => ({ id: v.voice_id, name: v.name, category: v.category }));
}
