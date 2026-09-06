// Per-key in-memory rate limiter.
//
// Vercel Fluid Compute reuses function instances across concurrent requests
// within a region, so this Map is *per-instance*, not global. An attacker can
// spread requests across regions to bypass it — that's acceptable for Wave 2
// because we pair this at the middleware layer with Vercel BotID (out of scope
// for PR B). The per-instance bound still blunts accidental hammering.

const hits = new Map();

export function checkRate(key, { limit = 3, windowMs = 24 * 60 * 60 * 1000 } = {}) {
  const now = Date.now();
  const entry = hits.get(key);

  if (!entry || now - entry.firstAt >= windowMs) {
    hits.set(key, { count: 1, firstAt: now });
    return { allowed: true, remaining: Math.max(0, limit - 1), resetAt: now + windowMs };
  }

  entry.count += 1;
  const resetAt = entry.firstAt + windowMs;
  const allowed = entry.count <= limit;
  const remaining = Math.max(0, limit - entry.count);
  return { allowed, remaining, resetAt };
}

// Test-only: wipe state. Safe to call from production code — no-op effect.
export function _resetRateLimit() {
  hits.clear();
}

// Public Blob counters were neither private nor atomic. Hosted requests fail
// closed until an authenticated, atomic quota store is implemented.
export async function checkRateBlob(key, options = {}) {
  if (process.env.NODE_ENV === 'production') {
    return { allowed: false, remaining: 0, resetAt: Date.now() + 60000, persistent: false };
  }
  return { ...checkRate(key, options), persistent: false };
}
