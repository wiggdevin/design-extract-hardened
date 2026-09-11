/*
 * Odyssey Contracting - static rebuild
 * app.js does exactly two things:
 *   1. Reveal-on-scroll for elements marked data-reveal.
 *   2. A minimal slider for elements marked data-slider.
 * See BUILD-NOTES.md for the reasoning behind the approach below.
 */

(function () {
  'use strict';

  /* ---------- 1. Reveal on scroll ---------- */

  function initReveal() {
    var items = document.querySelectorAll('[data-reveal]');
    if (!items.length) return;

    if (!('IntersectionObserver' in window)) {
      // No IntersectionObserver support: leave everything visible (default state).
      return;
    }

    // Only elements on screen at load get the hide-then-fade treatment.
    // Everything below the fold stays visible from the start, so the page
    // never depends on scrolling to show its content.
    var onScreen = [];
    items.forEach(function (el) {
      var rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight && rect.bottom > 0) {
        el.classList.add('reveal-pending');
        onScreen.push(el);
      }
    });

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.remove('reveal-pending');
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });

    onScreen.forEach(function (el) {
      observer.observe(el);
    });
  }

  /* ---------- 2. Minimal slider ---------- */

  function initSliders() {
    var sliders = document.querySelectorAll('[data-slider]');

    sliders.forEach(function (slider) {
      var slides = slider.querySelectorAll('.slide');
      var prevBtn = slider.querySelector('.slider-prev');
      var nextBtn = slider.querySelector('.slider-next');
      var current = 0;

      if (slides.length <= 1) {
        // Only one slide was recovered from the extraction; controls stay
        // present (matches the recorded 2-button hero band) but do nothing.
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        return;
      }

      function show(index) {
        slides[current].classList.remove('is-active');
        current = (index + slides.length) % slides.length;
        slides[current].classList.add('is-active');
      }

      if (prevBtn) prevBtn.addEventListener('click', function () { show(current - 1); });
      if (nextBtn) nextBtn.addEventListener('click', function () { show(current + 1); });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    initReveal();
    initSliders();
  });
})();
