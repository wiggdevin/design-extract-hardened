import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateClone } from '../src/clone.js';

function minimalDesign({ url, title, heading }) {
  return {
    meta: { url, title },
    colors: {
      primary: { hex: '#3366ff' },
      secondary: null,
      accent: null,
      backgrounds: ['#ffffff'],
      text: ['#111111'],
      neutrals: [],
    },
    typography: {
      families: [{ name: 'Safe Sans' }],
      headings: [],
      body: { size: 16 },
    },
    spacing: {},
    borders: { radii: [] },
    shadows: { values: [] },
    voice: {
      sampleHeadings: [heading],
      ctaVerbs: [{ value: heading }],
    },
    sectionRoles: { readingOrder: ['hero', 'footer'] },
    materialLanguage: { label: 'flat' },
    pageIntent: { type: 'landing' },
  };
}

test('generated clone keeps malicious URL and page copy as inert values', () => {
  const url = "https://example.com/x',[globalThis.DESIGNLANG_URL_POC=1]:'";
  const heading = '{globalThis.DESIGNLANG_COPY_POC=1}';
  const outDir = mkdtempSync(join(tmpdir(), 'designlang-clone-security-'));

  try {
    generateClone(minimalDesign({ url, title: "title';globalThis.PWNED=1;//", heading }), outDir);

    const layout = readFileSync(join(outDir, 'src/app/layout.js'), 'utf8');
    const metadataSource = layout
      .split('\n\nexport default function')[0]
      .replace('export const metadata', 'metadata');
    const context = { metadata: undefined };
    runInNewContext(metadataSource, context);

    assert.equal(context.DESIGNLANG_URL_POC, undefined);
    assert.equal(context.PWNED, undefined);
    assert.equal(context.metadata.description, `Design cloned from ${url} with designlang.`);
    assert.equal(context.metadata.title, "title';globalThis.PWNED=1;// · cloned");

    const page = readFileSync(join(outDir, 'src/app/page.js'), 'utf8');
    assert.ok(page.includes(`{${JSON.stringify(heading)}}`));
    assert.equal(page.includes(`>${heading}<`), false);
    assert.equal(page.includes('${globalThis.'), false);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});
