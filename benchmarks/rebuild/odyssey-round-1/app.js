// Odyssey Contracting — static rebuild behaviour.
// Two responsibilities only: reveal-on-scroll for [data-reveal], and a
// minimal prev/next slider for [data-slider].

(function revealOnScroll() {
  // [data-reveal] elements are visible by default in CSS. This only adds
  // an opt-in fade/slide-up for elements that are already on screen at
  // load time, because those are guaranteed to get an IntersectionObserver
  // callback almost immediately (no real scroll required). Elements below
  // the initial viewport are left in their default visible state and are
  // never hidden: a page that never scrolls (e.g. an automated full-page
  // screenshot) must never depend on a scroll event to show real content.
  var targets = document.querySelectorAll('[data-reveal]');
  if (targets.length === 0 || !('IntersectionObserver' in window)) return;

  var prefersReducedMotion =
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReducedMotion) return;

  var viewportHeight = window.innerHeight || document.documentElement.clientHeight;

  var observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { root: null, rootMargin: '0px 0px -10% 0px', threshold: 0.15 }
  );

  targets.forEach(function (el) {
    var isInInitialViewport = el.getBoundingClientRect().top < viewportHeight;
    if (isInInitialViewport) {
      el.classList.add('pre-reveal');
      observer.observe(el);
    }
  });
})();

(function sliders() {
  document.querySelectorAll('[data-slider]').forEach(function (root) {
    var track = root.querySelector('.slider-track');
    var slides = root.querySelectorAll('.slide');
    var prevBtn = root.querySelector('[data-slider-prev]');
    var nextBtn = root.querySelector('[data-slider-next]');
    var index = 0;

    if (!track || slides.length === 0) return;

    function update() {
      track.style.transform = 'translateX(-' + index * 100 + '%)';
    }

    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        index = (index - 1 + slides.length) % slides.length;
        update();
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        index = (index + 1) % slides.length;
        update();
      });
    }

    update();
  });
})();
