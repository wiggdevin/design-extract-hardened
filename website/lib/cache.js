// Public persistence and discovery are disabled in the hardened foundation.
// Re-enable only with authenticated ownership, private storage and deletion policy.
import { createHash } from 'node:crypto';
export function cacheKey(url) { return createHash('sha256').update(String(url)).digest('hex'); }
export async function getCached() { return null; }
export async function putCached() { return { stored: false, reason: 'public exports disabled' }; }
export async function getCachedByHash() { return null; }
export async function listRecent() { return []; }
