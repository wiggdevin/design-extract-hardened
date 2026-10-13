// Semantic benchmark runner.
//
//   node benchmarks/semantic-bench.mjs run   <outDir> [refero-manifest] [stress-manifest]
//   node benchmarks/semantic-bench.mjs score <outDir> <ground-truth.json> [refero-manifest] [stress-manifest]
//
// `run` crawls every site in both manifests with the local extractor and saves
// per-site extraction.json (without _raw) plus run.json with timings.
// `score` scores saved extractions against a ground-truth file and writes
// score.json and scorecard.md. Results directories are ignored by git.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [mode, outDirArg, ...rest] = process.argv.slice(2);
if (!mode || !outDirArg) {
  console.error('usage: semantic-bench.mjs run <outDir> [refero] [stress] | score <outDir> <gt.json> [refero] [stress]');
  process.exit(2);
}
const outDir = resolve(outDirArg);
const gtPath = mode === 'score' ? resolve(rest.shift() || '') : null;
const referoPath = resolve(rest[0] || join(ROOT, 'benchmarks/refero-premium-10.json'));
const stressPath = resolve(rest[1] || join(ROOT, 'benchmarks/stress-sites-v1.json'));

function loadRefs(path, set) {
  if (!existsSync(path)) { console.error(`manifest not found, skipping: ${path}`); return []; }
  const refs = JSON.parse(readFileSync(path, 'utf8')).references || [];
  return refs.map(r => ({ id: r.id, title: r.title, url: r.url, set }));
}
const sites = [...loadRefs(referoPath, 'refero'), ...loadRefs(stressPath, 'stress')];
if (!sites.length) { console.error('no sites to run'); process.exit(2); }

if (mode === 'run') {
  const { extractDesignLanguage } = await import(join(ROOT, 'src/index.js'));
  mkdirSync(outDir, { recursive: true });
  const concurrency = 3;
  const queue = [...sites];
  const results = [];
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  async function worker() {
    while (queue.length) {
      const site = queue.shift();
      const siteDir = join(outDir, site.id);
      mkdirSync(siteDir, { recursive: true });
      const s0 = Date.now();
      try {
        const design = await extractDesignLanguage(site.url, { wait: 1500 });
        const { _raw, ...publicDesign } = design;
        writeFileSync(join(siteDir, 'extraction.json'), JSON.stringify(publicDesign, null, 1));
        results.push({ ...site, status: 'succeeded', ms: Date.now() - s0, finalUrl: design.meta?.url, evidence: design.evidence, warnings: design.warnings });
        console.log(`ok   ${site.title} ${Date.now() - s0}ms`);
      } catch (err) {
        results.push({ ...site, status: 'failed', ms: Date.now() - s0, error: String(err?.message || err).slice(0, 200) });
        console.log(`FAIL ${site.title}: ${String(err?.message || err).slice(0, 120)}`);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  const report = { startedAt, finishedAt: new Date().toISOString(), wallMs: Date.now() - t0, concurrency, viewport: { width: 1280, height: 800 }, results };
  writeFileSync(join(outDir, 'run.json'), JSON.stringify(report, null, 1));
  console.log(`done: ${results.filter(r => r.status === 'succeeded').length}/${results.length} succeeded in ${Math.round(report.wallMs / 1000)}s`);
} else if (mode === 'score') {
  const { loadSemanticGroundTruth, scoreSemanticExtraction, formatSemanticScorecard, isPlaceholderMediaSrc } = await import(join(ROOT, 'src/semantic-benchmark.js'));
  const gt = loadSemanticGroundTruth(JSON.parse(readFileSync(gtPath, 'utf8')));
  const extractionsById = {};
  for (const site of sites) {
    const p = join(outDir, site.id, 'extraction.json');
    if (existsSync(p)) extractionsById[site.id] = JSON.parse(readFileSync(p, 'utf8'));
  }
  const score = scoreSemanticExtraction(gt, extractionsById);
  const card = formatSemanticScorecard(score);
  writeFileSync(join(outDir, 'score.json'), JSON.stringify(score, null, 1));
  writeFileSync(join(outDir, 'scorecard.md'), card);
  console.log(card);
  for (const site of sites) {
    const e = extractionsById[site.id];
    if (!e) { console.log(`- ${site.title}: NO EXTRACTION`); continue; }
    const fam = (e.typography?.system?.acceptedFamilies || e.typography?.families || []).map(f => f.name).slice(0, 4).join(', ');
    const rej = (e.typography?.system?.rejectedFamilies || []).map(f => f.name).slice(0, 4).join(', ');
    const geo = e.borders?.geometry?.global?.value ?? 'null';
    const btn = e.borders?.geometry?.byRole?.button?.value ?? '-';
    const dist = (e.imageryStyle?.distribution || []).slice(0, 3).map(d => `${d.label} ${Math.round(d.share * 100)}%`).join(' / ');
    const bp = e.blueprint || {};
    const order = (bp.readingOrder || []).slice(0, 6).join(' > ');
    console.log(`- ${site.title}: fonts=[${fam}] rejected=[${rej}] geometry=${geo} button=${btn} material=${e.materialLanguage?.label} imagery=${e.imageryStyle?.label} (${dist}) bands=${(bp.bands || []).length} order=[${order}] oversized=${bp.counts?.oversizedDropped ?? 0} placeholders=${(bp.bands || []).filter(b => isPlaceholderMediaSrc(b.media?.src)).length} scroll=${e.evidence?.capture?.scroll?.steps ?? '-'} motionStack=[${(e.motion?.stack || []).map(s => s.name).join(',')}]`);
  }
} else {
  console.error('unknown mode'); process.exit(2);
}
