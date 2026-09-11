// Pixel-lane bakeoff (benchmark tooling, not part of extraction).
//
//   node benchmarks/pixel-bakeoff.mjs capture <resultsDir> <outDir> [refero] [stress]
//   node benchmarks/pixel-bakeoff.mjs features <outDir>
//   node benchmarks/pixel-bakeoff.mjs score <outDir> <resultsDir> <gt.json> [refero] [stress]
//
// capture: for every site in a saved benchmark run, open the page, find the
// elements behind imageryStyle.dominantMedia, and screenshot each element
// in-page (no secondary fetch of image URLs). Crops and a viewport shot are
// written to <outDir>/<site>/ for inspection. Crops never leave the outDir.
// features: compute Sharp pixel features for every crop into media.json.
// score: relabel the saved distribution with pixel labels for candidates the
// DOM left `unknown`, then score media top-two recall against ground truth.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { pixelFeatures, classifyPixels } from '../src/extractors/pixel-features.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VIEWPORT = { width: 1280, height: 800 };
const MAX_CANDIDATES = 5;
const LEDGER_MAX_ENTRIES = 300;
const LEDGER_MAX_ITEM = 8 * 1024 * 1024;
const LEDGER_MAX_TOTAL = 64 * 1024 * 1024;
function absoluteUrl(u, base) { try { return new URL(u, base).href; } catch { return u; } }
const [mode, ...args] = process.argv.slice(2);

function loadRefs(path, set) {
  if (!existsSync(path)) { console.error(`manifest not found, skipping: ${path}`); return []; }
  const refs = JSON.parse(readFileSync(path, 'utf8')).references || [];
  return refs.map(r => ({ id: r.id, title: r.title, url: r.url, set }));
}
function loadSites(referoArg, stressArg) {
  const referoPath = resolve(referoArg || join(ROOT, 'benchmarks/refero-premium-10.json'));
  const stressPath = resolve(stressArg || join(ROOT, 'benchmarks/stress-sites-v1.json'));
  return [...loadRefs(referoPath, 'refero'), ...loadRefs(stressPath, 'stress')];
}
function readJson(p) { return JSON.parse(readFileSync(p, 'utf8')); }

// Runs inside the page: tag the element behind one dominantMedia record.
function locateInPage({ index, kind, src, width, height }) {
  const prefix = (src || '').slice(0, 120);
  const abs = (u) => { try { return new URL(u, location.href).href; } catch { return u; } };
  const rectOf = (el) => el.getBoundingClientRect();
  const sizeScore = (r) => Math.abs(r.width - width) + Math.abs(r.height - height);
  const visible = (el) => { const r = rectOf(el); const cs = getComputedStyle(el); return r.width >= 5 && r.height >= 5 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  let pool = [];
  let matchedBy = 'size';
  if (kind === 'img' || kind === 'svg') {
    pool = [...document.querySelectorAll(kind === 'svg' ? 'svg' : 'img')].filter(visible);
    const bySrc = kind === 'img' && prefix ? pool.filter(el => (el.currentSrc || el.src || '').startsWith(prefix)) : [];
    if (bySrc.length) { pool = bySrc; matchedBy = 'src'; }
  } else if (kind === 'css-background') {
    pool = [...document.querySelectorAll('*')].filter(el => { const bg = getComputedStyle(el).backgroundImage; return bg && bg !== 'none' && bg.includes('url('); }).filter(visible);
    const bySrc = prefix ? pool.filter(el => getComputedStyle(el).backgroundImage.includes(prefix.slice(0, 80))) : [];
    if (bySrc.length) { pool = bySrc; matchedBy = 'src'; }
  } else if (kind === 'video-poster') {
    pool = [...document.querySelectorAll('video[poster]')].filter(visible);
    const bySrc = prefix ? pool.filter(el => abs(el.getAttribute('poster') || '').startsWith(abs(prefix))) : [];
    if (bySrc.length) { pool = bySrc; matchedBy = 'src'; }
  } else if (kind === 'canvas') {
    pool = [...document.querySelectorAll('canvas')].filter(visible);
  }
  if (!pool.length) return { found: false, reason: 'no candidate elements' };
  // A size-only match is not the recorded source; only a canvas (which has
  // no source) may be identified by its box.
  if (matchedBy === 'size' && kind !== 'canvas') return { found: false, reason: 'source not present in the live page' };
  pool.sort((a, b) => sizeScore(rectOf(a)) - sizeScore(rectOf(b)));
  const el = pool[0];
  el.setAttribute('data-bakeoff', String(index));
  const r = rectOf(el);
  return { found: true, matchedBy, rect: { x: Math.round(r.left), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) }, tag: el.tagName.toLowerCase(), matchedSrc: kind === 'img' && matchedBy === 'src' ? (el.currentSrc || el.src || '').slice(0, 160) : '' };
}

async function captureSite(site, resultsDir, outDir) {
  const extractionPath = join(resultsDir, site.id, 'extraction.json');
  if (!existsSync(extractionPath)) return { ...site, status: 'no-extraction', media: [] };
  const extraction = readJson(extractionPath);
  const dominant = (extraction.imageryStyle?.dominantMedia || []).slice(0, MAX_CANDIDATES);
  const siteDir = join(outDir, site.id);
  mkdirSync(siteDir, { recursive: true });
  const t0 = Date.now();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  const media = [];
  let status = 'ok';
  // Response ledger: bytes of raster images the page itself loaded, kept in
  // memory only and bounded. No URL is fetched that the page did not fetch.
  const ledger = new Map();
  let ledgerBytes = 0;
  page.on('response', (resp) => {
    const type = (resp.headers()['content-type'] || '').toLowerCase();
    if (!type.startsWith('image/') || type.includes('svg')) return;
    if (ledger.size >= LEDGER_MAX_ENTRIES) return;
    resp.body().then((buf) => {
      if (!buf || buf.length > LEDGER_MAX_ITEM || ledgerBytes + buf.length > LEDGER_MAX_TOTAL) return;
      if (ledger.has(resp.url())) return;
      ledger.set(resp.url(), { buf, type });
      ledgerBytes += buf.length;
    }).catch(() => {});
  });
  try {
    await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await page.evaluate(() => document.fonts.ready).catch(() => {});
    const docHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < Math.min(docHeight, 12000); y += 700) {
      await page.evaluate((yy) => window.scrollTo(0, yy), y);
      await page.waitForTimeout(120);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(siteDir, 'viewport.png') });

    for (let i = 0; i < dominant.length; i++) {
      const d = dominant[i];
      const record = { index: i, kind: d.kind, src: d.src, domLabel: d.label, weight: d.weight, width: d.width, height: d.height, captured: false };
      if (!d.weight || (d.src || '').startsWith('data:')) { record.error = 'not a voting raster'; media.push(record); continue; }
      try {
        const loc = await page.evaluate(locateInPage, { index: i, kind: d.kind, src: d.src, width: d.width, height: d.height });
        if (loc.found) Object.assign(record, { tag: loc.tag, rect: loc.rect, matchedSrc: loc.matchedSrc, matchedBy: loc.matchedBy });
        // Prefer the bytes the page loaded for this source; the composited
        // element screenshot carries overlays, text, and lazy-load blanks.
        const wanted = [loc.matchedSrc, d.src].filter(u => u && !u.startsWith('data:')).map(u => absoluteUrl(u, page.url())).filter(u => u.length >= 40);
        let hit = null;
        for (const [url, entry] of ledger) {
          if (wanted.some(w => w && (url === w || url.startsWith(w.slice(0, 120))))) { hit = { url, ...entry }; break; }
        }
        // A mostly transparent layer (linear.app stacks glow and mask images
        // over a dark background) says nothing on its own; the composited
        // element is what the page shows.
        let transparentLayer = false;
        if (hit) {
          try {
            const meta = await sharp(hit.buf).metadata();
            if (meta.hasAlpha) {
              const st = await sharp(hit.buf).stats();
              const alpha = st.channels[st.channels.length - 1];
              transparentLayer = alpha && alpha.mean < 128;
            }
          } catch { /* undecodable: fall through to the composited path */ hit = null; }
        }
        if (hit && !transparentLayer) {
          const ext = (hit.type.split('/')[1] || 'bin').split(';')[0].replace('jpeg', 'jpg');
          const cropPath = join(siteDir, `crop-${i}.${ext}`);
          writeFileSync(cropPath, hit.buf);
          Object.assign(record, { captured: true, source: 'network', cropPath, bytes: hit.buf.length, contentType: hit.type, ledgerUrl: hit.url.slice(0, 160) });
        } else {
          if (hit && transparentLayer) record.note = 'network bytes are a transparent layer; using composited element';
          if (!loc.found) { record.error = loc.reason; media.push(record); continue; }
          const handle = page.locator(`[data-bakeoff="${i}"]`).first();
          await handle.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
          await page.waitForTimeout(400);
          const png = await handle.screenshot({ timeout: 15000, animations: 'allow' });
          const cropPath = join(siteDir, `crop-${i}.png`);
          writeFileSync(cropPath, png);
          Object.assign(record, { captured: true, source: 'composited', cropPath, bytes: png.length });
        }
      } catch (err) {
        record.error = String(err?.message || err).slice(0, 160);
      }
      media.push(record);
    }
  } catch (err) {
    status = `nav-error: ${String(err?.message || err).slice(0, 120)}`;
  }
  await browser.close();
  const ledgerIndex = [...ledger.entries()].map(([url, e]) => ({ url: url.slice(0, 200), type: e.type, bytes: e.buf.length })).sort((a, b) => b.bytes - a.bytes).slice(0, 60);
  const out = { ...site, status, ms: Date.now() - t0, domLabel: extraction.imageryStyle?.label, media, ledger: { entries: ledger.size, bytes: ledgerBytes, largest: ledgerIndex } };
  writeFileSync(join(siteDir, 'media.json'), JSON.stringify(out, null, 1));
  console.log(`${status === 'ok' ? 'ok  ' : 'FAIL'} ${site.title}: ${media.filter(m => m.captured).length}/${media.length} crops, ${Date.now() - t0}ms`);
  return out;
}

async function featuresFor(outDir, sites) {
  for (const site of sites) {
    const p = join(outDir, site.id, 'media.json');
    if (!existsSync(p)) continue;
    const rec = readJson(p);
    for (const m of rec.media) {
      if (!m.captured || !m.cropPath || !existsSync(m.cropPath)) continue;
      try {
        m.features = await pixelFeatures(readFileSync(m.cropPath));
        m.pixel = classifyPixels(m.features, { kind: m.kind, width: m.width, height: m.height });
      } catch (err) {
        m.featureError = String(err?.message || err).slice(0, 120);
      }
    }
    writeFileSync(p, JSON.stringify(rec, null, 1));
    for (const m of rec.media) {
      if (!m.features) continue;
      const f = m.features;
      console.log([site.title.padEnd(18), `${m.index}`, m.kind.padEnd(14), (m.source || '').padEnd(10), (m.domLabel || '').padEnd(19), m.pixel.label.padEnd(14), `ent ${f.entropy}`, `uniq ${f.uniqueRatio}`, `flat ${f.flatShare}`, `top8 ${f.top8Share}`, `axis ${f.axisEdgeShare}`, `edge ${f.edgeDensity}`, `sat ${f.saturation}`, `alpha ${f.transparentShare}`].join(' | '));
    }
  }
}

const PHOTO_FAMILY = new Set(['photography', 'product-photography']);
function relabel(extraction, mediaRecords) {
  const dist = new Map((extraction.imageryStyle?.distribution || []).map(d => [d.label, d.weight]));
  const moved = [];
  for (const m of mediaRecords) {
    if (!m.pixel || m.pixel.label === 'unknown' || m.domLabel !== 'unknown') continue;
    dist.set('unknown', Math.max(0, (dist.get('unknown') || 0) - m.weight));
    dist.set(m.pixel.label, (dist.get(m.pixel.label) || 0) + m.weight);
    moved.push({ kind: m.kind, weight: m.weight, to: m.pixel.label, signals: m.pixel.signals });
  }
  const total = [...dist.values()].reduce((s, v) => s + v, 0) || 1;
  const distribution = [...dist.entries()].filter(([, w]) => w > 0).map(([label, weight]) => ({ label, share: weight / total, weight })).sort((a, b) => b.share - a.share);
  const top = distribution[0];
  const second = distribution[1];
  const sameFamily = second && PHOTO_FAMILY.has(top?.label) && PHOTO_FAMILY.has(second.label);
  const rival = sameFamily ? distribution[2] : second;
  const familyShare = top ? (sameFamily ? top.share + second.share : top.share) : 0;
  let label = 'mixed';
  if (top && familyShare >= 0.5 && familyShare - (rival ? rival.share : 0) >= 0.15) label = top.label;
  const unknownShare = (dist.get('unknown') || 0) / total;
  if (unknownShare > 0.5) label = 'unknown';
  return { label, distribution, moved };
}

if (mode === 'capture') {
  const [resultsDir, outDir, referoArg, stressArg] = args;
  if (!resultsDir || !outDir) { console.error('usage: capture <resultsDir> <outDir> [refero] [stress]'); process.exit(2); }
  const sites = loadSites(referoArg, stressArg);
  mkdirSync(resolve(outDir), { recursive: true });
  const queue = [...sites];
  const results = [];
  async function worker() { while (queue.length) results.push(await captureSite(queue.shift(), resolve(resultsDir), resolve(outDir))); }
  await Promise.all(Array.from({ length: 3 }, worker));
  writeFileSync(join(resolve(outDir), 'capture.json'), JSON.stringify({ capturedAt: new Date().toISOString(), viewport: VIEWPORT, results: results.map(({ media, ...r }) => ({ ...r, crops: media.filter(m => m.captured).length, candidates: media.length })) }, null, 1));
} else if (mode === 'features') {
  const [outDir, referoArg, stressArg] = args;
  if (!outDir) { console.error('usage: features <outDir>'); process.exit(2); }
  await featuresFor(resolve(outDir), loadSites(referoArg, stressArg));
} else if (mode === 'score') {
  const [outDir, resultsDir, gtPath, referoArg, stressArg] = args;
  if (!outDir || !resultsDir || !gtPath) { console.error('usage: score <outDir> <resultsDir> <gt.json>'); process.exit(2); }
  const gt = readJson(resolve(gtPath));
  const truthById = new Map(gt.sites.map(s => [s.id, s]));
  let hits = 0, scored = 0, photoFp = 0;
  const rows = [];
  for (const site of loadSites(referoArg, stressArg)) {
    const mp = join(resolve(outDir), site.id, 'media.json');
    const ep = join(resolve(resultsDir), site.id, 'extraction.json');
    const truth = truthById.get(site.id);
    if (!truth || !existsSync(ep)) continue;
    const extraction = readJson(ep);
    const rec = existsSync(mp) ? readJson(mp) : { media: [] };
    const before = extraction.imageryStyle?.label;
    const { label, distribution, moved } = relabel(extraction, rec.media);
    const labels = [label, ...distribution.slice(0, 2).map(d => d.label)];
    const hit = truth.mediaTopTwo.some(t => labels.includes(t));
    const fp = PHOTO_FAMILY.has(label) && !truth.mediaTopTwo.some(t => PHOTO_FAMILY.has(t));
    scored++; if (hit) hits++; if (fp) photoFp++;
    rows.push({ site: site.title, truth: truth.mediaTopTwo, before, after: label, top: distribution.slice(0, 2).map(d => `${d.label} ${Math.round(d.share * 100)}%`), moved, hit, fp });
  }
  for (const r of rows) console.log(`${r.hit ? 'HIT ' : 'MISS'}${r.fp ? ' FP' : '   '} ${r.site.padEnd(18)} truth=${r.truth.join('/')} before=${r.before} after=${r.after} top=[${r.top.join(', ')}] moved=${r.moved.map(m => `${m.kind}->${m.to}`).join(',') || '-'}`);
  console.log(`media top-two recall ${hits}/${scored}; photography false positives ${photoFp}/${scored}`);
  writeFileSync(join(resolve(outDir), 'score.json'), JSON.stringify({ hits, scored, photoFp, rows }, null, 1));
} else {
  console.error('usage: capture | features | score');
  process.exit(2);
}
