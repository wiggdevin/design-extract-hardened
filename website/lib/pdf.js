// Shared HTML→PDF rendering for brand books.
//
// Used by the permalink GET (/api/pdf/[hash]) and the cache-free POST
// (/api/pdf). Centralising the Playwright browser path means a fresh
// extraction can render its PDF straight from the brand HTML the client
// already holds — no Blob round-trip — so a just-finished extraction
// can never fail with "extraction not found".

import { getBrowserOptions, openBrowser } from './browser.js';

// Subresource allowlist for the untrusted POST path. The brand book is
// self-contained inline CSS plus Google Fonts, so we allow only data:
// URIs and the two font hosts and abort everything else — client-supplied
// HTML can't be used to fetch internal or arbitrary URLs (SSRF).
const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);
function isAllowedSubresource(url) {
  if (url.startsWith('data:')) return true;
  try { return FONT_HOSTS.has(new URL(url).hostname); } catch { return false; }
}

function footerTemplate(host) {
  return `<div style="font-family: -apple-system, sans-serif; font-size: 9px; color: #888; width: 100%; padding: 0 18mm; display: flex; justify-content: space-between;"><span>designlang · ${host} brand guidelines</span><span><span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;
}

// Render brand-book HTML to a PDF Buffer. `trusted` (server-generated
// HTML from the cache) renders as-is; untrusted client HTML gets the
// subresource allowlist above.
export async function renderBrandPdf(html, host, { trusted = false } = {}) {
  const { chromium } = await import('playwright-core');
  const opts = await getBrowserOptions();
  const browser = await openBrowser(chromium, opts);

  try {
    const page = await browser.newPage();
    // Bound every operation so a slow font CDN or remote browser can never
    // hang the function into a platform 504 — we'd rather render unstyled
    // than time out.
    page.setDefaultTimeout(20000);
    page.setDefaultNavigationTimeout(20000);
    if (!trusted) {
      await page.route('**', (route) => {
        const url = route.request().url();
        return isAllowedSubresource(url) ? route.continue() : route.abort();
      });
    }
    // 'networkidle' waits for the network to fall quiet, which stalls on a
    // slow Google Fonts response (and behaves badly with request
    // interception). 'load' fires once the document + its resources have
    // loaded; we then give web fonts a *bounded* chance to settle so the
    // PDF still looks right without ever blocking on a slow CDN.
    await page.setContent(html, { waitUntil: 'load' }).catch(() => {});
    await page
      .evaluate(() => Promise.race([
        (document.fonts && document.fonts.ready) || Promise.resolve(),
        new Promise((r) => setTimeout(r, 2500)),
      ]))
      .catch(() => {});
    return await page.pdf({
      format: 'a4',
      printBackground: true,
      margin: { top: '24mm', right: '18mm', bottom: '20mm', left: '18mm' },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: footerTemplate(host),
    });
  } finally {
    try { await browser.close(); } catch { /* ignore */ }
  }
}
