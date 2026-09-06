// Anonymous localhost browser regression. Run against an already running dev server.
// Extraction is stubbed to avoid consuming quota or contacting a remote site.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ acceptDownloads: true });
  const html = readFileSync(new URL('../../website/public/gallery/linear-app/linear-app.brand.html', import.meta.url), 'utf8');
  await page.route('**/api/extract*', route => route.fulfill({
    contentType: 'application/x-ndjson',
    body: [{ type: 'permalink', hash: 'pdf-regression' }, { type: 'files', files: { 'example.brand.html': html } }].map(JSON.stringify).join('\n') + '\n',
  }));
  await page.goto('http://127.0.0.1:3210/watch?u=https%3A%2F%2Fexample.com');
  const button = page.getByRole('button', { name: 'Download brand PDF', exact: true });
  await button.waitFor();
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
  assert.equal(await download.failure(), null);
  assert.equal(download.suggestedFilename(), 'example.com-brand.pdf');
  const pdf = await PDFDocument.load(readFileSync(await download.path()));
  assert.ok(pdf.getPageCount() > 1);
  console.log(`PASS real PDF download: ${pdf.getPageCount()} pages, ${download.suggestedFilename()}`);
  await page.route('**/api/pdf', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'PRIVATE_SERVER_PATH '.repeat(500) }) }));
  await button.click();
  await page.getByRole('alert').filter({ hasText: 'PDF unavailable.' }).waitFor();
  assert.equal(await button.innerText(), 'Download brand PDF');
  assert.equal(await button.isEnabled(), true);
  assert.equal(await page.getByText('PRIVATE_SERVER_PATH', { exact: false }).count(), 0);
  assert.ok(await page.getByText('Everything it extracted from example.com').isVisible());
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  console.log('PASS forced PDF failure: stable button, bounded alert, results retained, no overflow at 375/1280px');
} finally { await browser.close(); }
