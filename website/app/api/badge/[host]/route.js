// GET /api/badge/[host]
//
// Returns a shields.io-style SVG badge with the live design grade for `host`.
// Reads from the same blob cache the /api/extract route writes to, so the
// first visitor to a URL warms the cache (paying the ~5s extraction cost),
// and every subsequent badge fetch is served from edge cache in ~50ms.
//
// Edge cache headers ensure GitHub's image proxy and any CDN respect the
// 24h TTL — same as the cache itself.

import { extractDesignLanguage } from '../../../../../src/index.js';
import { formatScoreBadge } from '../../../../../src/formatters/badge.js';
import { validateResolvedTargetUrl } from '../../../../lib/url-safety.js';
import { cacheKey, getCached, putCached } from '../../../../lib/cache.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CACHE_HEADERS = {
  // Edge: 6h fresh, 24h stale-while-revalidate. Browser: 1h.
  'cache-control': 'public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400',
  'content-type': 'image/svg+xml; charset=utf-8',
};

const ERROR_HEADERS = {
  // Don't cache errors — bad host should get a fresh chance after rotation.
  'cache-control': 'public, max-age=60, s-maxage=60',
  'content-type': 'image/svg+xml; charset=utf-8',
};

async function getBrowserOptions() {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const chromium = (await import('@sparticuz/chromium')).default;
    return {
      executablePath: await chromium.executablePath(),
      browserArgs: chromium.args,
    };
  }
  return {};
}

function svgResponse(svg, headers) {
  return new Response(svg, { status: 200, headers });
}

export async function GET(_request, { params }) {
  const resolvedParams = await params;
  const rawHost = String(resolvedParams?.host || '').trim();

  // Strip leading scheme if someone double-encoded it; allow path suffixes.
  const cleanHost = rawHost.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!cleanHost) {
    return svgResponse(formatScoreBadge(null, { label: 'design' }), ERROR_HEADERS);
  }

  const targetUrl = `https://${cleanHost}`;
  const validation = await validateResolvedTargetUrl(targetUrl);
  if (!validation.ok) {
    return svgResponse(
      formatScoreBadge(null, { label: 'design' }),
      ERROR_HEADERS,
    );
  }

  const key = cacheKey(validation.url);

  // Cache hit — fast path.
  try {
    const cached = await getCached(key);
    if (cached?.design?.score) {
      return svgResponse(formatScoreBadge(cached.design.score), CACHE_HEADERS);
    }
  } catch (err) {
    console.error('[badge] cache read failed', err?.message);
  }

  // Cache miss — run extraction. Worth it: this also warms the cache for
  // every other downstream surface (the gallery, /api/extract, etc.).
  try {
    const browserOpts = await getBrowserOptions();
    const design = await extractDesignLanguage(validation.url, browserOpts);
    if (!design?.score) {
      return svgResponse(formatScoreBadge(null, { label: 'design' }), ERROR_HEADERS);
    }
    // Best-effort cache write.
    putCached(key, { design }).catch(() => {});
    return svgResponse(formatScoreBadge(design.score), CACHE_HEADERS);
  } catch (err) {
    console.error('[badge] extraction failed', err?.message);
    return svgResponse(formatScoreBadge(null, { label: 'design' }), ERROR_HEADERS);
  }
}
