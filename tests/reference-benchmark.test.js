import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  compareReferenceToExtraction,
  normalizeReferenceManifest,
  parseBenchmarkConcurrency,
  runReferenceBenchmark,
} from '../src/reference-benchmark.js';

const reference = {
  id: 'style-1',
  title: 'Quiet Luxury',
  url: 'https://example.com',
  previewUrl: 'https://images.example.com/preview.jpg',
  description: 'Dark editorial layout with serif headlines, pill buttons, and cinematic photography.',
};

const design = {
  _raw: { html: '<main>source content must not be persisted</main>' },
  meta: { url: 'https://example.com', title: 'Example' },
  colors: { all: [{ hex: '#050505' }, { hex: '#ffffff' }] },
  typography: { families: [{ name: 'Canela' }], scale: [{ size: 64 }] },
  spacing: { base: 8, scale: [8, 16, 24] },
  borders: { radii: [999] },
  shadows: { values: [] },
  components: { button: {} },
  variables: {},
  layout: { gridCount: 2, flexCount: 3 },
  materialLanguage: { label: 'editorial dark' },
  imageryStyle: { label: 'cinematic photography' },
  accessibility: { score: 92, failCount: 1 },
  score: { overall: 88, grade: 'B' },
};

describe('reference benchmark', () => {
  it('parses an explicit concurrency value in base 10', () => {
    assert.equal(parseBenchmarkConcurrency('3'), 3);
    assert.equal(parseBenchmarkConcurrency('10'), 10);
  });

  it('rejects duplicate URLs so one site cannot inflate the benchmark', () => {
    assert.throws(
      () => normalizeReferenceManifest({ references: [reference, { ...reference, id: 'style-2' }] }),
      /Duplicate URL/,
    );
  });

  it('keeps Refero claims separate from extractor evidence', () => {
    const comparison = compareReferenceToExtraction(reference, design);
    assert.equal(comparison.reference.id, 'style-1');
    assert.deepEqual(comparison.reference.signals, ['dark', 'editorial', 'serif', 'pill', 'cinematic', 'photography']);
    assert.deepEqual(comparison.extraction.palette, ['#050505', '#ffffff']);
    assert.deepEqual(comparison.extraction.fontFamilies, ['Canela']);
    assert.deepEqual(comparison.extraction.radii, [999]);
    assert.ok(comparison.sharedSignals.includes('editorial'));
    assert.ok(comparison.sharedSignals.includes('cinematic'));
  });

  it('does not report disabled material metrics as observed signals', () => {
    const comparison = compareReferenceToExtraction(reference, {
      ...design,
      borders: { radii: [{ value: 8, count: 4 }] },
      materialLanguage: { label: 'flat', metrics: { hasPill: false, gradientCount: 0 } },
      imageryStyle: { label: 'mixed', counts: { photoLike: 0 } },
    });
    assert.ok(!comparison.extractionSignals.includes('pill'));
    assert.ok(!comparison.extractionSignals.includes('gradient'));
    assert.ok(!comparison.extractionSignals.includes('photography'));
  });

  it('saves per-site evidence and a wall-clock report while preserving failures', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'designlang-reference-benchmark-'));
    const second = { ...reference, id: 'style-2', title: 'Failure', url: 'https://failure.example' };
    let active = 0;
    let maxActive = 0;
    const extract = async (url) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      if (url.includes('failure')) throw new Error('blocked by target');
      return design;
    };

    const report = await runReferenceBenchmark({
      manifest: { name: 'premium-ten', references: [reference, second] },
      outDir,
      concurrency: 1,
      extract,
    });

    assert.equal(maxActive, 1);
    assert.deepEqual(report.counts, { total: 2, succeeded: 1, failed: 1 });
    assert.equal(report.sites[1].error, 'blocked by target');
    assert.ok(report.durationMs >= 10);
    assert.equal(JSON.parse(readFileSync(join(outDir, 'report.json'), 'utf8')).counts.failed, 1);
    assert.match(readFileSync(join(outDir, 'report.md'), 'utf8'), /Failure/);
    assert.equal(JSON.parse(readFileSync(join(outDir, 'example-com', 'refero.json'), 'utf8')).id, 'style-1');
    const savedExtraction = JSON.parse(readFileSync(join(outDir, 'example-com', 'extraction.json'), 'utf8'));
    assert.equal(savedExtraction.meta.title, 'Example');
    assert.equal(savedExtraction._raw, undefined);
  });
});
