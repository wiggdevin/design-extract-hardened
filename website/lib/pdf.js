// Shared HTML→PDF rendering for brand books.
//
// Used by the permalink GET (/api/pdf/[hash]) and the cache-free POST
// (/api/pdf). Centralising the Playwright browser path means a fresh
// extraction can render its PDF straight from the brand HTML the client
// already holds — no Blob round-trip — so a just-finished extraction
// can never fail with "extraction not found".

import { chromium } from 'playwright';
import { getBrowserOptions, openBrowser } from './browser.js';

function footerTemplate(host) {
  return `<div style="font-family: -apple-system, sans-serif; font-size: 9px; color: #888; width: 100%; padding: 0 18mm; display: flex; justify-content: space-between;"><span>designlang · ${String(host).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))} brand guidelines</span><span><span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;
}

// Render all HTML offline with page scripts disabled, including cached content.
export async function renderBrandPdf(html, host) {
  const opts = await getBrowserOptions();
  const browser = await openBrowser(chromium, opts);

  try {
    const page = await browser.newPage({ javaScriptEnabled: false, serviceWorkers: 'block' });
    await page.context().setOffline(true);
    await page.route('**/*', route => route.abort());
    // Bound rendering operations; errors propagate to the endpoint.
    page.setDefaultTimeout(20000);
    page.setDefaultNavigationTimeout(20000);
    // Inline styles and data images still render; remote fonts use local fallbacks.
    await page.setContent(html, { waitUntil: 'load' });
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
