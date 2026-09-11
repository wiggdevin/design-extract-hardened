import { describe, it } from 'node:test';
import assert from 'node:assert';

import { processRuntimeMotion, detectScrollRecipes, nameDuration, detectMotionStack } from '../src/extractors/motion-runtime.js';
import { detectChoreography } from '../src/extractors/motion-choreography.js';

const rawCapture = {
  observations: [
    // duplicate of the first hover obs — must dedupe
    { trigger: 'hover', selector: 'button:nth-of-type(1)', tag: 'BUTTON', type: 'transition', name: 'background-color', duration: 180, delay: 0, easing: 'ease-out', iterations: 1, properties: ['background-color', 'color'] },
    { trigger: 'hover', selector: 'button:nth-of-type(1)', tag: 'button', type: 'transition', name: 'background-color', duration: 180, delay: 0, easing: 'ease-out', iterations: 1, properties: ['color', 'background-color'] },
    { trigger: 'load', selector: '.hero h1', tag: 'h1', type: 'animation', name: 'fadeUp', duration: 600, delay: 0, easing: 'cubic-bezier(0.16,1,0.3,1)', iterations: 1, properties: ['opacity', 'transform'] },
    { trigger: 'scroll', selector: '.parallax-bg', tag: 'div', type: 'animation', name: 'drift', duration: 0, delay: 0, easing: 'linear', iterations: 'Infinity', properties: ['transform'] },
    { trigger: 'scroll', selector: '.reveal-card', tag: 'div', type: 'animation', name: 'reveal', duration: 500, delay: 0, easing: 'ease-out', iterations: 1, properties: ['opacity', 'transform'] },
    { /* junk */ trigger: 'hover' },
    null,
  ],
};

describe('processRuntimeMotion', () => {
  const model = processRuntimeMotion(rawCapture);

  it('dedupes identical observations (property order normalized)', () => {
    const hover = model.byTrigger.hover;
    assert.equal(hover.length, 1, 'the two identical hover obs collapse to one');
    assert.deepEqual(hover[0].properties, ['background-color', 'color']);
  });

  it('drops junk/null observations', () => {
    assert.equal(model.observations.length, 4);
  });

  it('groups observations by trigger', () => {
    assert.deepEqual(model.triggers.sort(), ['hover', 'load', 'scroll']);
    assert.equal(model.byTrigger.load.length, 1);
    assert.equal(model.byTrigger.scroll.length, 2);
  });

  it('collects unique runtime durations with semantic names', () => {
    const names = model.durations.map(d => d.name);
    assert.ok(names.includes('sm'));  // 180ms
    assert.ok(names.includes('lg'));  // 600ms
    assert.equal(model.durations.find(d => d.ms === 600).css, '600ms');
  });

  it('reports stats', () => {
    assert.equal(model.stats.observed, 4);
    assert.equal(model.stats.byTrigger.scroll, 2);
  });

  it('accepts a bare array too', () => {
    assert.equal(processRuntimeMotion(rawCapture.observations).observations.length, 4);
  });
});

describe('detectScrollRecipes', () => {
  const model = processRuntimeMotion(rawCapture);
  it('classifies transform-only scroll motion as parallax', () => {
    const parallax = model.scrollRecipes.find(r => r.selector === '.parallax-bg');
    assert.equal(parallax.kind, 'parallax');
  });
  it('classifies opacity+transform scroll motion as reveal', () => {
    const reveal = model.scrollRecipes.find(r => r.selector === '.reveal-card');
    assert.equal(reveal.kind, 'reveal');
  });
  it('only considers scroll-triggered observations', () => {
    assert.equal(detectScrollRecipes(model.observations).length, 2);
  });
});

describe('detectChoreography', () => {
  it('detects an evenly-staggered enter sequence', () => {
    const obs = [0, 80, 160, 240].map((delay, i) => ({
      trigger: 'load', selector: `.grid .item:nth-of-type(${i + 1})`, type: 'animation',
      name: 'fadeUp', duration: 400, delay, easing: 'ease-out',
      properties: ['opacity', 'transform'], durationName: 'md',
    }));
    const seq = detectChoreography(obs);
    assert.equal(seq.length, 1);
    assert.equal(seq[0].count, 4);
    assert.equal(seq[0].staggerMs, 80);
    assert.equal(seq[0].selectorPattern, '.grid .item:nth-of-type(*)');
  });

  it('ignores groups that all fire together (no stagger)', () => {
    const obs = [0, 0, 0].map((delay, i) => ({
      trigger: 'load', selector: `.x:nth-of-type(${i + 1})`, type: 'animation',
      name: 'fade', duration: 300, delay, easing: 'ease', properties: ['opacity'], durationName: 'md',
    }));
    assert.equal(detectChoreography(obs).length, 0);
  });

  it('ignores sequences shorter than 3', () => {
    const obs = [0, 100].map((delay, i) => ({
      trigger: 'load', selector: `.y:nth-of-type(${i + 1})`, type: 'animation',
      name: 'fade', duration: 300, delay, easing: 'ease', properties: ['opacity'], durationName: 'md',
    }));
    assert.equal(detectChoreography(obs).length, 0);
  });
});

describe('nameDuration', () => {
  it('buckets durations', () => {
    assert.equal(nameDuration(0), 'instant');
    assert.equal(nameDuration(200), 'sm');
    assert.equal(nameDuration(5000), 'xxl');
  });
});

describe('detectMotionStack', () => {
  // Signals recorded from the odysseycontracting.com capture (Avada theme):
  // one <lottie-player>, fusion-lottie wrappers, Swiper sliders, fusion-animated reveals.
  const odyssey = {
    scripts: [
      'https://odysseycontracting.com/wp-includes/js/jquery/jquery.min.js?ver=3.7.1',
      'https://odysseycontracting.com/wp-content/themes/Avada/includes/lib/assets/min/js/general/avada-header.js',
    ],
    windowGlobals: ['wp', 'jQuery'],
    tagCounts: { 'lottie-player': 1, canvas: 0, video: 1 },
    classNameSample: [
      'fusion-fullwidth fullwidth-box fusion-builder-row-1',
      'fusion-layout-column fusion_builder_column fusion-flex-column fusion-animated',
      'fusion-lottie fusion-lottie-animation',
      'swiper-container fusion-carousel',
      'swiper-wrapper',
      'swiper-slide',
      'fusion-layout-column fusion-animated',
    ],
  };

  it('names lottie, swiper, and theme reveals on the reference records', () => {
    const stack = detectMotionStack(odyssey);
    const names = stack.map(s => s.name);
    assert.ok(names.includes('lottie'), names.join(','));
    assert.ok(names.includes('swiper'), names.join(','));
    assert.ok(names.includes('theme-reveal'), names.join(','));
    const lottie = stack.find(s => s.name === 'lottie');
    assert.deepEqual([...lottie.evidence].sort(), ['class', 'tag']);
    assert.equal(lottie.count, 2);
  });

  it('reads script sources and window globals', () => {
    const stack = detectMotionStack({
      scripts: ['https://cdn.example/gsap.min.js', 'https://cdn.example/ScrollTrigger.min.js', '/assets/lenis.js'],
      windowGlobals: ['gsap', 'ScrollTrigger', 'Lenis'],
    });
    assert.deepEqual(stack.map(s => s.name).sort(), ['gsap', 'lenis', 'scrolltrigger']);
    assert.deepEqual([...stack.find(s => s.name === 'gsap').evidence].sort(), ['global', 'script']);
  });

  it('returns an empty list when no signal is present', () => {
    assert.deepEqual(detectMotionStack({ scripts: ['/app.js'], windowGlobals: ['React'], classNameSample: ['btn primary'] }), []);
    assert.deepEqual(detectMotionStack(), []);
  });

  it('keeps the observed document top on normalized observations', () => {
    const model = processRuntimeMotion({ observations: [
      { trigger: 'scroll', selector: '.a', properties: ['opacity'], duration: 500, top: 1234.6, height: 400 },
      { trigger: 'scroll', selector: '.b', properties: ['opacity'], duration: 500 },
    ] });
    assert.equal(model.observations[0].top, 1235);
    assert.equal(model.observations[1].top, null);
  });
});
