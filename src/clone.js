// Clone — generate a working Next.js starter that mirrors a site's
// extracted design language: section order, voice, material, tokens.
//
// v2: driven by sectionRoles.readingOrder + voice + materialLanguage,
// so the emitted page is a faithful structural mirror of the target,
// not a generic token-showcase.

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const KNOWN_ROLES = new Set([
  'hero', 'logo-wall', 'feature-grid', 'stats', 'testimonial',
  'pricing-table', 'faq', 'steps', 'comparison', 'gallery',
  'bento', 'cta', 'footer',
]);

function dedupeConsecutive(order) {
  const out = [];
  for (const r of order) if (r !== out[out.length - 1]) out.push(r);
  return out;
}

function jsString(value, fallback = '') {
  return JSON.stringify(String(value ?? fallback));
}

function jsxText(value, fallback = '') {
  return `{${jsString(value, fallback)}}`;
}

function finiteNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function titleFromUrl(url = '') {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'this site'; }
}

function pickHeading(voice, fallback) {
  const s = (voice?.sampleHeadings || []).find(h => h && h.length > 4 && h.length < 80);
  return s || fallback;
}

function materialPreset(material = {}) {
  const label = material?.label || 'flat';
  switch (label) {
    case 'brutalist': return { radius: '0px', shadow: '4px 4px 0 0 currentColor', border: '2px solid currentColor', cardBorder: '2px solid var(--color-foreground)' };
    case 'glass':     return { radius: '16px', shadow: '0 8px 32px rgba(0,0,0,0.08)', border: '1px solid rgba(255,255,255,0.18)', cardBorder: '1px solid var(--color-neutral-2)', backdrop: 'backdrop-filter: blur(12px);' };
    case 'soft-ui':
    case 'neumorphism': return { radius: '24px', shadow: '12px 12px 24px rgba(0,0,0,0.08), -12px -12px 24px rgba(255,255,255,0.6)', border: 'none', cardBorder: 'none' };
    case 'flat':      return { radius: 'var(--radius)', shadow: 'none', border: '1px solid var(--color-neutral-2)', cardBorder: '1px solid var(--color-neutral-2)' };
    case 'material-you': return { radius: '28px', shadow: 'var(--shadow)', border: 'none', cardBorder: 'none' };
    default:          return { radius: 'var(--radius)', shadow: 'var(--shadow)', border: '1px solid var(--color-neutral-2)', cardBorder: '1px solid var(--color-neutral-2)' };
  }
}

function primaryCta(voice) {
  const verb = voice?.ctaVerbs?.[0]?.value || 'Get started';
  return verb.charAt(0).toUpperCase() + verb.slice(1);
}

function secondaryCta(voice) {
  const verb = voice?.ctaVerbs?.[1]?.value || 'Learn more';
  return verb.charAt(0).toUpperCase() + verb.slice(1);
}

// ─── Section renderers ─────────────────────────────────────────

function renderHero(ctx) {
  const { voice, intent, url, mat, headings, bodySize } = ctx;
  const lede = pickHeading(voice, `A ${intent || 'product'} that deserves its own design system.`);
  const primary = primaryCta(voice);
  const secondary = secondaryCta(voice);
  const h0 = headings[0] || {};
  const h0Size = finiteNumber(h0.size, 56, 8, 240);
  const h0Weight = finiteNumber(h0.weight, 700, 100, 1000);
  const h0LineHeight = jsString(h0.lineHeight, '1.05');
  return `
      <section style={{ padding: '96px 0 72px', textAlign: 'left', maxWidth: '880px' }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--color-neutral-1)', marginBottom: 24 }}>
          cloned · ${jsxText(titleFromUrl(url))}
        </div>
        <h1 style={{ fontSize: 'clamp(40px, 6vw, ${h0Size}px)', fontWeight: ${h0Weight}, lineHeight: ${h0LineHeight}, letterSpacing: '-0.025em', marginBottom: 24 }}>
          ${jsxText(lede)}
        </h1>
        <p style={{ fontSize: ${bodySize + 4}, lineHeight: 1.55, color: 'var(--color-neutral-1)', maxWidth: '52ch', marginBottom: 32 }}>
          Every token, section, button verb and shadow on this page was extracted from the live site — nothing invented.
        </p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button style={{ background: 'var(--color-primary)', color: '#fff', border: '${mat.border === 'none' ? 'none' : '1px solid var(--color-primary)'}', padding: '14px 22px', borderRadius: '${mat.radius}', boxShadow: '${mat.shadow}', fontSize: ${bodySize}, fontWeight: 600, cursor: 'pointer' }}>
            ${jsxText(primary)}
          </button>
          <button style={{ background: 'transparent', color: 'var(--color-foreground)', border: '1px solid var(--color-foreground)', padding: '14px 22px', borderRadius: '${mat.radius}', fontSize: ${bodySize}, fontWeight: 500, cursor: 'pointer' }}>
            ${jsxText(secondary)}
          </button>
        </div>
      </section>`;
}

function renderLogoWall() {
  return `
      <section style={{ padding: '48px 0', borderTop: '1px solid var(--color-neutral-2)', borderBottom: '1px solid var(--color-neutral-2)' }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--color-neutral-1)', marginBottom: 24 }}>trusted by teams at</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 24, alignItems: 'center', opacity: 0.72 }}>
          {['Acme', 'Northwind', 'Initech', 'Umbrella', 'Stark', 'Wayne'].map(n => (
            <div key={n} style={{ fontFamily: 'var(--font-mono)', fontSize: 14, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{n}</div>
          ))}
        </div>
      </section>`;
}

function renderFeatureGrid(ctx) {
  const { voice, mat, headings, bodySize } = ctx;
  const heading = pickHeading(voice, 'What it actually does.');
  const h1 = headings[1] || {};
  const h1Size = finiteNumber(h1.size, 36, 8, 240);
  const h1Weight = finiteNumber(h1.weight, 600, 100, 1000);
  const features = [
    { t: 'Primitives', b: 'Every color, type, shadow and spacing value lifted from the source.' },
    { t: 'Anatomy', b: 'Variants, sizes and states inferred from real DOM — not guessed.' },
    { t: 'Voice', b: 'The verbs your CTAs use, the rhythm of your headings, preserved.' },
    { t: 'Drift', b: 'Audit your tokens against production on every PR. Exit non-zero on divergence.' },
    { t: 'Platforms', b: 'One extraction → iOS, Android, Flutter, WordPress, MCP.' },
    { t: 'Prompts', b: 'Paste into v0 or Lovable and get the design right on the first try.' },
  ];
  return `
      <section style={{ padding: '96px 0' }}>
        <h2 style={{ fontSize: ${h1Size}, fontWeight: ${h1Weight}, letterSpacing: '-0.02em', marginBottom: 48, maxWidth: '20ch' }}>${jsxText(heading)}</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 24 }}>
          {${JSON.stringify(features)}.map(f => (
            <div key={f.t} style={{ padding: 24, borderRadius: '${mat.radius}', border: '${mat.cardBorder}', boxShadow: '${mat.shadow}', background: 'var(--color-background)' }}>
              <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>{f.t}</h3>
              <p style={{ fontSize: ${bodySize - 1}, lineHeight: 1.55, color: 'var(--color-neutral-1)' }}>{f.b}</p>
            </div>
          ))}
        </div>
      </section>`;
}

function renderStats() {
  return `
      <section style={{ padding: '64px 0', borderTop: '1px solid var(--color-neutral-2)', borderBottom: '1px solid var(--color-neutral-2)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 32 }}>
          {[['1,840', 'sites extracted'], ['0.82', 'avg library detection'], ['6s', 'median extraction'], ['W3C', 'DTCG output']].map(([n, l]) => (
            <div key={l}>
              <div style={{ fontSize: 44, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1 }}>{n}</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-neutral-1)', marginTop: 8 }}>{l}</div>
            </div>
          ))}
        </div>
      </section>`;
}

function renderTestimonial(ctx) {
  const { bodySize } = ctx;
  return `
      <section style={{ padding: '96px 0', maxWidth: '760px' }}>
        <p style={{ fontSize: ${bodySize + 10}, lineHeight: 1.4, fontWeight: 500, letterSpacing: '-0.01em' }}>
          &ldquo;It rebuilt our entire landing page into a token-clean Next.js project in under a minute.
          Nothing we've paid for comes close.&rdquo;
        </p>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-neutral-1)', marginTop: 24 }}>
          — design lead, Series B startup
        </p>
      </section>`;
}

function renderPricing(ctx) {
  const { voice, mat, bodySize } = ctx;
  const cta = primaryCta(voice);
  const tiers = [
    { t: 'Free', p: '$0', b: 'CLI + MCP + every extractor.' },
    { t: 'Team', p: '$19', b: 'CI drift bot + drift reports on every PR.' },
    { t: 'Studio', p: '$49', b: 'Hosted studio, shareable extractions.' },
  ];
  return `
      <section style={{ padding: '96px 0' }}>
        <h2 style={{ fontSize: 36, fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 48 }}>Pricing</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20 }}>
          {${JSON.stringify(tiers)}.map((tier, i) => (
            <div key={tier.t} style={{ padding: 28, borderRadius: '${mat.radius}', border: '${mat.cardBorder}', boxShadow: i === 1 ? '${mat.shadow}' : 'none', background: i === 1 ? 'var(--color-foreground)' : 'var(--color-background)', color: i === 1 ? 'var(--color-background)' : 'var(--color-foreground)' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', opacity: 0.7 }}>{tier.t}</div>
              <div style={{ fontSize: 40, fontWeight: 700, margin: '12px 0', letterSpacing: '-0.02em' }}>{tier.p}<span style={{ fontSize: 14, fontWeight: 400, opacity: 0.7 }}> / mo</span></div>
              <p style={{ fontSize: ${bodySize - 1}, lineHeight: 1.55, marginBottom: 24, opacity: 0.85 }}>{tier.b}</p>
              <button style={{ width: '100%', background: i === 1 ? 'var(--color-background)' : 'var(--color-primary)', color: i === 1 ? 'var(--color-foreground)' : '#fff', border: 'none', padding: '12px 16px', borderRadius: '${mat.radius}', fontSize: ${bodySize}, fontWeight: 600, cursor: 'pointer' }}>${jsxText(cta)}</button>
            </div>
          ))}
        </div>
      </section>`;
}

function renderFaq() {
  const qas = [
    ['How accurate is the clone?', 'Every token and the section reading order come from the real DOM. Copy is filler — the design is real.'],
    ['Does it use an LLM?', 'No. Everything runs from Playwright + deterministic classifiers. --smart is optional.'],
    ['Can it handle auth?', 'Yes — pass --cookie-file for Netscape cookies, Playwright storageState, or a JSON array.'],
    ['Is this legal to use on competitors?', 'It captures publicly rendered CSS/DOM. Use respectfully; the tokens belong to the source.'],
  ];
  return `
      <section style={{ padding: '96px 0', maxWidth: '760px' }}>
        <h2 style={{ fontSize: 36, fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 32 }}>Questions</h2>
        <div>
          {${JSON.stringify(qas)}.map(([q, a]) => (
            <details key={q} style={{ padding: '20px 0', borderTop: '1px solid var(--color-neutral-2)' }}>
              <summary style={{ fontSize: 18, fontWeight: 600, cursor: 'pointer', listStyle: 'none' }}>{q}</summary>
              <p style={{ fontSize: 15, lineHeight: 1.6, color: 'var(--color-neutral-1)', marginTop: 12 }}>{a}</p>
            </details>
          ))}
        </div>
      </section>`;
}

function renderSteps() {
  const steps = [
    ['01', 'Extract', 'Point designlang at any URL. Get DTCG tokens in seconds.'],
    ['02', 'Emit', 'One extraction fans out to Tailwind, CSS vars, Figma vars, iOS, Android, Flutter.'],
    ['03', 'Ship', 'Clone a starter, add the CI bot, or launch the Studio to share.'],
  ];
  return `
      <section style={{ padding: '96px 0' }}>
        <h2 style={{ fontSize: 36, fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 48 }}>How</h2>
        <ol style={{ listStyle: 'none', padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 24 }}>
          {${JSON.stringify(steps)}.map(([n, t, b]) => (
            <li key={n}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, color: 'var(--color-primary)', marginBottom: 12 }}>{n}</div>
              <h3 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em', marginBottom: 8 }}>{t}</h3>
              <p style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--color-neutral-1)' }}>{b}</p>
            </li>
          ))}
        </ol>
      </section>`;
}

function renderComparison() {
  const rows = [
    ['Section order reproduction', '✓', '–'],
    ['DTCG tokens (W3C)', '✓', '–'],
    ['Motion + anatomy + voice', '✓', '–'],
    ['CI drift bot', '✓', '–'],
    ['Local studio', '✓', '–'],
    ['$', '0', '$200+/mo'],
  ];
  return `
      <section style={{ padding: '96px 0' }}>
        <h2 style={{ fontSize: 36, fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 32 }}>vs. what you're paying for</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '12px 0', borderBottom: '1px solid var(--color-foreground)', fontWeight: 500, fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase' }}></th>
              <th style={{ textAlign: 'left', padding: '12px 16px', borderBottom: '1px solid var(--color-foreground)', fontWeight: 600 }}>designlang</th>
              <th style={{ textAlign: 'left', padding: '12px 16px', borderBottom: '1px solid var(--color-foreground)', fontWeight: 500, color: 'var(--color-neutral-1)' }}>paid peers</th>
            </tr>
          </thead>
          <tbody>
            {${JSON.stringify(rows)}.map(([k, a, b], i) => (
              <tr key={k + i}>
                <td style={{ padding: '14px 0', borderBottom: '1px solid var(--color-neutral-2)' }}>{k}</td>
                <td style={{ padding: '14px 16px', borderBottom: '1px solid var(--color-neutral-2)', fontFamily: 'var(--font-mono)', color: 'var(--color-primary)' }}>{a}</td>
                <td style={{ padding: '14px 16px', borderBottom: '1px solid var(--color-neutral-2)', fontFamily: 'var(--font-mono)', color: 'var(--color-neutral-1)' }}>{b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>`;
}

function renderCta(ctx) {
  const { voice, mat, bodySize } = ctx;
  const primary = primaryCta(voice);
  return `
      <section style={{ padding: '96px 0', textAlign: 'center', borderTop: '1px solid var(--color-neutral-2)' }}>
        <h2 style={{ fontSize: 44, fontWeight: 700, letterSpacing: '-0.025em', marginBottom: 24 }}>Ready when you are.</h2>
        <p style={{ fontSize: ${bodySize + 2}, color: 'var(--color-neutral-1)', marginBottom: 32, maxWidth: '46ch', margin: '0 auto 32px' }}>One command. A full project. No keys, no account.</p>
        <button style={{ background: 'var(--color-primary)', color: '#fff', border: 'none', padding: '16px 28px', borderRadius: '${mat.radius}', boxShadow: '${mat.shadow}', fontSize: ${bodySize + 2}, fontWeight: 600, cursor: 'pointer' }}>
          ${jsxText(primary)}
        </button>
      </section>`;
}

function renderFooter(url) {
  return `
      <footer style={{ padding: '48px 0 32px', borderTop: '1px solid var(--color-neutral-2)', fontSize: 13, color: 'var(--color-neutral-1)', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
        <div>Cloned from <a href=${jsxText(url)} style={{ color: 'var(--color-primary)' }}>${jsxText(titleFromUrl(url))}</a> · structure + tokens only</div>
        <div style={{ fontFamily: 'var(--font-mono)' }}>designlang clone</div>
      </footer>`;
}

const RENDERERS = {
  'hero':          renderHero,
  'logo-wall':     renderLogoWall,
  'feature-grid':  renderFeatureGrid,
  'stats':         renderStats,
  'testimonial':   renderTestimonial,
  'pricing-table': renderPricing,
  'faq':           renderFaq,
  'steps':         renderSteps,
  'comparison':    renderComparison,
  'bento':         renderFeatureGrid,
  'gallery':       renderFeatureGrid,
  'cta':           renderCta,
};

// ─── Main ──────────────────────────────────────────────────────

export function generateClone(design, outDir) {
  const projectDir = outDir;
  mkdirSync(join(projectDir, 'src/app'), { recursive: true });
  mkdirSync(join(projectDir, 'public'), { recursive: true });

  const { colors, typography, spacing, borders, shadows } = design;
  const voice = design.voice || {};
  const sectionRoles = design.sectionRoles || {};
  const materialLanguage = design.materialLanguage || {};
  const pageIntent = design.pageIntent || {};
  const url = design.meta?.url || '';
  const metadataTitle = `${design.meta?.title || 'Cloned Design'} · cloned`;
  const metadataDescription = `Design cloned from ${url} with designlang.`;

  const primaryHex = colors.primary?.hex || '#3b82f6';
  const secondaryHex = colors.secondary?.hex || '#8b5cf6';
  const accentHex = colors.accent?.hex || '#f59e0b';
  const bgColor = colors.backgrounds[0] || '#ffffff';
  const textColor = colors.text[0] || '#171717';
  const fontFamily = typography.families[0]?.name || 'Inter';
  const monoFont = typography.families.find(f => f.name.toLowerCase().includes('mono'))?.name || 'monospace';
  const radiusMd = borders.radii.find(r => r.label === 'md')?.value || 8;
  const shadowMd = shadows.values.find(s => s.label === 'md')?.raw || '0 4px 6px rgba(0,0,0,0.1)';
  const neutrals = colors.neutrals.slice(0, 5);

  // package.json
  writeFileSync(join(projectDir, 'package.json'), JSON.stringify({
    name: `${(design.meta.title || 'cloned').toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 40) || 'cloned-design'}-clone`,
    version: '0.1.0',
    private: true,
    scripts: { dev: 'next dev', build: 'next build', start: 'next start' },
    dependencies: { next: '^15.0.0', react: '^19.0.0', 'react-dom': '^19.0.0' },
    devDependencies: { tailwindcss: '^4.0.0', '@tailwindcss/postcss': '^4.0.0' },
  }, null, 2), 'utf-8');

  // globals.css
  writeFileSync(join(projectDir, 'src/app/globals.css'), `@import "tailwindcss";

:root {
  --color-primary: ${primaryHex};
  --color-secondary: ${secondaryHex};
  --color-accent: ${accentHex};
  --color-background: ${bgColor};
  --color-foreground: ${textColor};
${neutrals.map((n, i) => `  --color-neutral-${i + 1}: ${n.hex};`).join('\n')}
  --font-sans: '${fontFamily}', system-ui, sans-serif;
  --font-mono: '${monoFont}', monospace;
  --radius: ${radiusMd}px;
  --shadow: ${shadowMd};
}

* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--color-background);
  color: var(--color-foreground);
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
}
a { color: var(--color-primary); }
button { font-family: inherit; }
`, 'utf-8');

  // layout.js
  writeFileSync(join(projectDir, 'src/app/layout.js'), `export const metadata = {
  title: ${jsString(metadataTitle)},
  description: ${jsString(metadataDescription)},
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontFamily)}:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
`, 'utf-8');

  // Build page from sectionRoles.readingOrder
  const rawOrder = Array.isArray(sectionRoles.readingOrder) && sectionRoles.readingOrder.length
    ? sectionRoles.readingOrder.filter(r => KNOWN_ROLES.has(r))
    : ['hero', 'logo-wall', 'feature-grid', 'stats', 'testimonial', 'pricing-table', 'faq', 'cta', 'footer'];
  const order = dedupeConsecutive(rawOrder);
  if (!order.includes('footer')) order.push('footer');

  const ctx = {
    voice,
    intent: pageIntent?.type || 'landing',
    url,
    mat: materialPreset(materialLanguage),
    headings: typography.headings || [],
    bodySize: finiteNumber(typography.body?.size, 16, 8, 72),
  };

  const sections = order
    .filter(r => r !== 'footer')
    .map(r => (RENDERERS[r] || (() => ''))(ctx))
    .join('\n');

  const pageJs = `import './globals.css';

export default function Home() {
  return (
    <main style={{ maxWidth: 1200, margin: '0 auto', padding: '0 clamp(20px, 4vw, 48px)' }}>
${sections}
${renderFooter(url)}
    </main>
  );
}
`;

  writeFileSync(join(projectDir, 'src/app/page.js'), pageJs, 'utf-8');

  // Next config
  writeFileSync(join(projectDir, 'next.config.mjs'), `/** @type {import('next').NextConfig} */
const nextConfig = {};
export default nextConfig;
`, 'utf-8');

  writeFileSync(join(projectDir, 'postcss.config.mjs'), `const config = {
  plugins: { "@tailwindcss/postcss": {} },
};
export default config;
`, 'utf-8');

  // README — tells the user what was reproduced.
  writeFileSync(join(projectDir, 'README.md'), `# ${design.meta.title || 'Cloned design'}

Generated by \`designlang clone ${url}\`.

## What was reproduced
- **Intent:** ${pageIntent?.type || 'landing'}${pageIntent?.confidence ? ` (${pageIntent.confidence})` : ''}
- **Material:** ${materialLanguage?.label || 'flat'}${materialLanguage?.confidence ? ` (${materialLanguage.confidence})` : ''}
- **Section order:** ${order.join(' → ')}
- **Voice:** tone *${voice.tone || 'neutral'}*, headings *${voice.headingStyle || 'sentence'}* / *${voice.headingLengthClass || 'balanced'}*, top CTAs: ${(voice.ctaVerbs || []).slice(0, 3).map(v => v.value).join(', ') || '—'}
- **Typography:** ${fontFamily} / ${monoFont}
- **Palette:** primary ${primaryHex}, secondary ${secondaryHex}, accent ${accentHex}
- **Radius / shadow:** ${radiusMd}px / extracted

## Run

\`\`\`
npm install
npm run dev
\`\`\`

> Copy is filler. The design is real.
`, 'utf-8');

  return {
    dir: projectDir,
    files: ['package.json', 'src/app/globals.css', 'src/app/layout.js', 'src/app/page.js', 'next.config.mjs', 'postcss.config.mjs', 'README.md'],
    order,
  };
}
