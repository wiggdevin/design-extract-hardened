// POST /api/pdf — render a brand-book PDF straight from the brand HTML the
// client already holds after an extraction.
//
// Unlike the permalink GET (/api/pdf/[hash]), this never touches the Blob
// cache, so a fresh extraction can always download its PDF — even with no
// BLOB_READ_WRITE_TOKEN configured (local dev) or before the cache write
// lands. This is the fix for downloads failing with "extraction not found".

import { renderBrandPdf } from '../../../lib/pdf.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_HTML_BYTES = 4 * 1024 * 1024; // brand books are ~50–200KB; cap abuse.

function err(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// `host` arrives as a bare hostname (e.g. "stripe.com") or a full URL.
function safeHost(raw) {
  if (typeof raw !== 'string') return 'site';
  try { return new URL(raw).hostname.replace(/^www\./, '') || 'site'; }
  catch { return raw.replace(/[^a-z0-9.-]/gi, '').slice(0, 60) || 'site'; }
}

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return err(400, 'invalid JSON body'); }

  const html = body?.html;
  if (typeof html !== 'string' || !html.includes('<')) return err(400, 'missing brand HTML');
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) return err(413, 'brand HTML too large');

  const host = safeHost(body?.host || body?.url);

  try {
    const pdfBuf = await renderBrandPdf(html, host, { trusted: false });
    return new Response(pdfBuf, {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${host}-brand.pdf"`,
        'cache-control': 'no-store',
      },
    });
  } catch {
    return err(500, 'PDF could not be rendered. Please retry or download the brand HTML.');
  }
}
