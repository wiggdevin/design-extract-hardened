// Reels remain local to the requesting stream; no persistence or public replay.
import { frameEvent } from './theatre.js';
export async function recordReel() { return { stored: false, reason: 'public exports disabled' }; }
export async function loadReel() { return null; }

// Evenly subsample frames down to a cap, always keeping the first and last so
// the reel still spans the full load.
export function capFrames(frames, cap) {
  if (frames.length <= cap) return frames;
  const step = frames.length / cap;
  const out = [];
  for (let i = 0; i < cap; i++) out.push(frames[Math.floor(i * step)]);
  out[out.length - 1] = frames[frames.length - 1];
  return out;
}

/**
 * Merge captured frames with the token paint into a single, sorted, delay-
 * annotated timeline a replayer can stream. Pure — no Blob, no clock.
 *
 * Frames keep their real `t`. Stages land in the first third, tokens spread
 * across most of the span so the system rail fills while the browser plays.
 * The whole thing is optionally compressed to `maxDurationMs` so a cached hit
 * doesn't tie the function up for the full original capture length.
 *
 * @returns {{steps:Array<{delayMs:number,event:object}>, durationMs:number}}
 */
export function buildReplayTimeline({
  frames = [],
  tokens = [],
  stages = [],
  summary,
  files,
  maxDurationMs = 12_000,
} = {}) {
  const rawSpan = frames.length
    ? Math.max(...frames.map((f) => f.t || 0))
    : Math.max(tokens.length * 40, 1);
  const factor = rawSpan > maxDurationMs ? maxDurationMs / rawSpan : 1;
  const at = (t) => Math.round(t * factor);

  const timed = [];
  for (const f of frames) {
    timed.push({ t: at(f.t || 0), event: frameEvent(f) });
  }
  stages.forEach((name, i) => {
    const frac = stages.length > 1 ? i / (stages.length - 1) : 0;
    timed.push({ t: Math.round(rawSpan * factor * 0.3 * frac), event: { type: 'stage', name } });
  });
  tokens.forEach((tok, i) => {
    const frac = tokens.length > 1 ? i / (tokens.length - 1) : 0;
    timed.push({ t: Math.round(rawSpan * factor * (0.15 + 0.8 * frac)), event: { type: 'token', ...tok } });
  });

  timed.sort((a, b) => a.t - b.t);

  const steps = [];
  let prev = 0;
  for (const { t, event } of timed) {
    steps.push({ delayMs: Math.max(0, t - prev), event });
    prev = t;
  }
  if (summary !== undefined) steps.push({ delayMs: 30, event: { type: 'summary', summary } });
  if (files !== undefined) steps.push({ delayMs: 30, event: { type: 'files', files } });

  return { steps, durationMs: prev };
}
