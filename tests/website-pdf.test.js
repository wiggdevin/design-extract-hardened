import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { PDFDocument } from 'pdf-lib';
import { POST } from '../website/app/api/pdf/route.js';
import { renderBrandPdf } from '../website/lib/pdf.js';

test('website PDF endpoint renders a valid downloadable PDF with the installed browser', async () => {
  const response = await POST(new Request('http://localhost/api/pdf', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ html: '<h1>Brand guidelines</h1>', host: 'example.com' }),
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/pdf');
  assert.match(response.headers.get('content-disposition'), /example.com-brand.pdf/);
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.equal(Buffer.from(bytes).subarray(0, 5).toString(), '%PDF-');
  assert.ok((await PDFDocument.load(bytes)).getPageCount() > 0);
});

test('PDF rendering blocks scripts and all subresources even with the former trusted flag', async () => {
  let requests = 0;
  const server = createServer((_req, res) => { requests++; res.end('blocked'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    const pdf = await renderBrandPdf(`<h1>Offline brand</h1>
      <link rel="stylesheet" href="${url}/style">
      <img src="${url}/image"><iframe src="${url}/frame"></iframe>
      <script>document.body.innerHTML='';fetch('${url}/script');while(true){}</script>`,
      '<img src="http://127.0.0.1/footer">', { trusted: true });
    assert.ok((await PDFDocument.load(pdf)).getPageCount() > 0);
    assert.equal(requests, 0, 'untrusted HTML must never reach the network');
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('PDF endpoint rejects malformed and oversized HTML before opening a browser', async () => {
  for (const [html, status] of [['no markup', 400], ['<' + 'a'.repeat(4 * 1024 * 1024), 413]]) {
    const result = await POST(new Request('http://localhost/api/pdf', {
      method: 'POST', body: JSON.stringify({ html }),
    }));
    assert.equal(result.status, status);
  }
});
