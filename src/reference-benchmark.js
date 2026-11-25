import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { formatDtcgTokens } from './formatters/dtcg-tokens.js';

const SIGNALS = [
  'dark', 'light', 'monochrome', 'editorial', 'minimal', 'serif', 'sans-serif',
  'monospace', 'pill', 'rounded', 'sharp', 'cinematic', 'photography', 'gradient',
  'grid', 'spacious', 'compact', 'high-contrast', 'organic', 'technical',
];

function normalizeSignalText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/sans serif/g, 'sans-serif')
    .replace(/high contrast/g, 'high-contrast');
}

function collectSignals(value) {
  const text = normalizeSignalText(value);
  return SIGNALS.filter((signal) => text.includes(signal));
}

function slugFromUrl(url) {
  const parsed = new URL(url);
  const path = parsed.pathname === '/' ? '' : `-${parsed.pathname}`;
  return `${parsed.hostname.replace(/^www\./, '')}${path}`
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

export function parseBenchmarkConcurrency(value) {
  return Number.parseInt(value, 10);
}

export function normalizeReferenceManifest(manifest) {
  const references = Array.isArray(manifest) ? manifest : manifest?.references;
  if (!Array.isArray(references) || references.length === 0) {
    throw new Error('Manifest must contain a non-empty references array');
  }

  const seenUrls = new Set();
  const normalized = references.map((reference, index) => {
    if (!reference || typeof reference !== 'object') {
      throw new Error(`Reference ${index + 1} must be an object`);
    }
    if (!reference.id || !reference.title || !reference.url) {
      throw new Error(`Reference ${index + 1} requires id, title, and url`);
    }
    const url = new URL(reference.url).href;
    if (seenUrls.has(url)) throw new Error(`Duplicate URL in manifest: ${url}`);
    seenUrls.add(url);
    return {
      id: String(reference.id),
      title: String(reference.title),
      url,
      previewUrl: reference.previewUrl ? String(reference.previewUrl) : null,
      description: reference.description ? String(reference.description) : '',
      query: reference.query ? String(reference.query) : null,
    };
  });

  return {
    name: Array.isArray(manifest) ? 'reference-benchmark' : String(manifest.name || 'reference-benchmark'),
    source: Array.isArray(manifest) ? 'Refero' : String(manifest.source || 'Refero'),
    references: normalized,
  };
}

export function compareReferenceToExtraction(reference, design) {
  const referenceSignals = collectSignals(reference.description);
  const extraction = {
    palette: safeArray(design.colors?.all).slice(0, 20).map((color) => color?.hex).filter(Boolean),
    fontFamilies: safeArray(design.typography?.families).map((font) => font?.name || font).filter(Boolean),
    typeScaleCount: safeArray(design.typography?.scale).length,
    spacingBase: design.spacing?.base ?? null,
    radii: safeArray(design.borders?.radii),
    shadows: safeArray(design.shadows?.values),
    layout: design.layout || null,
    materialLanguage: design.materialLanguage || null,
    imageryStyle: design.imageryStyle || null,
    score: design.score || null,
    accessibility: design.accessibility
      ? { score: design.accessibility.score ?? null, failCount: design.accessibility.failCount ?? null }
      : null,
  };
  const extractionSignalSet = new Set(collectSignals([
    extraction.materialLanguage?.label,
    extraction.imageryStyle?.label,
  ].filter(Boolean).join(' ')));
  const materialMetrics = extraction.materialLanguage?.metrics || {};
  const radii = extraction.radii.map((radius) => typeof radius === 'number' ? radius : radius?.value).filter(Number.isFinite);
  if (materialMetrics.hasPill === true || radii.some((radius) => radius >= 999)) extractionSignalSet.add('pill');
  if ((materialMetrics.gradientCount || 0) > 0) extractionSignalSet.add('gradient');
  if ((design.layout?.gridCount || 0) > 0) extractionSignalSet.add('grid');
  if (radii.length > 0 && Math.max(...radii) > 0) extractionSignalSet.add('rounded');
  if (radii.length > 0 && Math.max(...radii) === 0) extractionSignalSet.add('sharp');
  const extractionSignals = SIGNALS.filter((signal) => extractionSignalSet.has(signal));

  return {
    reference: {
      id: reference.id,
      title: reference.title,
      url: reference.url,
      description: reference.description,
      signals: referenceSignals,
    },
    extraction,
    extractionSignals,
    sharedSignals: referenceSignals.filter((signal) => extractionSignals.includes(signal)),
    note: 'Shared signals are a lexical aid, not a fidelity score. Review the side-by-side evidence.',
  };
}

function markdownReport(report) {
  const lines = [
    `# ${report.name}`,
    '',
    `Source: ${report.source}`,
    `Wall-clock time: ${(report.durationMs / 1000).toFixed(1)}s`,
    `Concurrency: ${report.concurrency}`,
    `Results: ${report.counts.succeeded} succeeded, ${report.counts.failed} failed, ${report.counts.total} total`,
    '',
    '| Site | Status | Time | Refero signals | Extractor signals |',
    '|---|---:|---:|---|---|',
  ];
  for (const site of report.sites) {
    lines.push(`| ${site.title} | ${site.status} | ${(site.durationMs / 1000).toFixed(1)}s | ${site.comparison?.reference.signals.join(', ') || '—'} | ${site.comparison?.extractionSignals.join(', ') || '—'} |`);
  }
  lines.push('', '## Review notes', '');
  for (const site of report.sites) {
    lines.push(`### ${site.title}`, '', `- URL: ${site.url}`, `- Refero style: ${site.referenceId}`);
    if (site.error) {
      lines.push(`- Extraction failed: ${site.error}`, '');
      continue;
    }
    lines.push(
      `- Saved evidence: ${site.outputDirectory}`,
      `- Shared lexical signals: ${site.comparison.sharedSignals.join(', ') || 'none'}`,
      '- Interpretation: inspect refero.json beside extraction.json; shared signals are not a quality score.',
      '',
    );
  }
  return `${lines.join('\n')}\n`;
}

export async function runReferenceBenchmark({ manifest, outDir, concurrency = 3, extract }) {
  const normalized = normalizeReferenceManifest(manifest);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 10) {
    throw new Error('Concurrency must be an integer from 1 to 10');
  }
  if (typeof extract !== 'function') throw new Error('An extract function is required');

  const startedAt = new Date();
  const startedMs = Date.now();
  const sites = new Array(normalized.references.length);
  let nextIndex = 0;
  mkdirSync(outDir, { recursive: true });

  async function worker() {
    while (nextIndex < normalized.references.length) {
      const index = nextIndex++;
      const reference = normalized.references[index];
      const siteStarted = Date.now();
      const siteDir = join(outDir, slugFromUrl(reference.url));
      mkdirSync(siteDir, { recursive: true });
      writeFileSync(join(siteDir, 'refero.json'), `${JSON.stringify(reference, null, 2)}\n`, 'utf8');
      try {
        const design = await extract(reference.url);
        const { _raw: _discardedRawSource, ...publicDesign } = design;
        const comparison = compareReferenceToExtraction(reference, publicDesign);
        writeFileSync(join(siteDir, 'extraction.json'), `${JSON.stringify(publicDesign, null, 2)}\n`, 'utf8');
        writeFileSync(join(siteDir, 'design-tokens.json'), `${JSON.stringify(formatDtcgTokens(publicDesign), null, 2)}\n`, 'utf8');
        writeFileSync(join(siteDir, 'comparison.json'), `${JSON.stringify(comparison, null, 2)}\n`, 'utf8');
        sites[index] = {
          referenceId: reference.id,
          title: reference.title,
          url: reference.url,
          status: 'succeeded',
          durationMs: Date.now() - siteStarted,
          outputDirectory: siteDir,
          comparison,
        };
      } catch (error) {
        sites[index] = {
          referenceId: reference.id,
          title: reference.title,
          url: reference.url,
          status: 'failed',
          durationMs: Date.now() - siteStarted,
          outputDirectory: siteDir,
          error: error?.message || String(error),
        };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, normalized.references.length) }, worker));
  const report = {
    schemaVersion: 1,
    name: normalized.name,
    source: normalized.source,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
    concurrency,
    counts: {
      total: sites.length,
      succeeded: sites.filter((site) => site.status === 'succeeded').length,
      failed: sites.filter((site) => site.status === 'failed').length,
    },
    sites,
  };
  writeFileSync(join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(join(outDir, 'report.md'), markdownReport(report), 'utf8');
  return report;
}
