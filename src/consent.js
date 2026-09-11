// Consent banners: get them out of the capture without consenting.
//
// A cookie card covers part of the first screen, locks body scroll (so lazy
// media below the fold never loads), and puts its own fonts, colors, and
// radii in front of the extractor. This module runs once after the page
// settles and before anything is measured:
//
// 1. Find the banner: known consent-tool roots first, then a generic shape
//    (a fixed or modal box whose text talks about cookies and holds a button).
// 2. Prefer a refusal control ("Reject all", "Only necessary"). That is a real
//    user action that sets no tracking cookies. An acceptance control is never
//    pressed: the crawl must not grant consent on the operator's behalf.
// 3. Whatever is still showing is hidden with an inline display:none, along
//    with the tool's backdrop, and the scroll lock on html/body is released.
//
// Nothing is removed from the DOM, and nothing runs when no banner is found,
// so a page's own overflow rules are untouched.

export const CONSENT_SELECTORS = [
  '#onetrust-consent-sdk', '#onetrust-banner-sdk',
  '#CybotCookiebotDialog',
  '#usercentrics-root', '#usercentrics-cmp-ui',
  '#didomi-host', '#didomi-popup',
  '.qc-cmp2-container', '#qc-cmp2-container',
  '#sp_message_container_', '[id^="sp_message_container_"]',
  '.osano-cm-window', '.osano-cm-dialog',
  '#truste-consent-track', '.truste_box_overlay',
  '#axeptio_overlay', '#axeptio_main_button',
  '#iubenda-cs-banner',
  '.termly-banner-top', '.termly-styles-banner', '#termly-code-snippet-support',
  '#hs-eu-cookie-confirmation',
  '#shopify-pc__banner', '#shopify-privacy-banner',
  '.klaro', '.cookie-notice', '#cookie-notice', '#cookiebanner', '#cookie-banner',
  '.cc-window', '.cc-banner',
  '#cookieConsent', '#cookie-consent', '.cookie-consent', '#gdpr-banner', '.gdpr-banner',
  '#ketch-banner', '.evidon-banner', '#_evidon_banner', '#cmpbox', '#cmpwrapper',
  '[aria-label*="cookie" i][role="dialog"]', '[aria-label*="consent" i][role="dialog"]',
];

// Backdrops the tools put behind their dialog. A backdrop can also be found
// by shape (fixed, covers the viewport, translucent, no text) once a root is.
export const CONSENT_BACKDROP_SELECTORS = [
  '.onetrust-pc-dark-filter', '#CybotCookiebotDialogBodyUnderlay', '.qc-cmp2-container .qc-cmp-cleanslate',
  '.osano-cm-window__overlay', '.truste_overlay', '#axeptio_overlay', '.klaro .cookie-modal',
  '.cc-overlay', '.cookie-consent-overlay',
];

// Refusal wording. Anchored, short, and never matching an accept, allow,
// agree, ok, settings, or preferences control.
export const REJECT_BUTTON_PATTERN = /^(?:reject(?: all| everything| optional)?(?: cookies)?|decline(?: all)?(?: cookies)?|deny(?: all)?(?: cookies)?|refuse(?: all)?(?: cookies)?|disagree(?: and close)?|no,? thanks|only (?:strictly )?(?:necessary|essential|required)(?: cookies)?|(?:strictly )?(?:necessary|essential|required)(?: cookies)? only|use (?:only )?(?:necessary|essential)(?: cookies)?(?: only)?|continue without (?:accepting|agreeing)|(?:accept|allow) (?:only )?(?:necessary|essential|required)(?: cookies)?(?: only)?)$/i;

const CONSENT_TEXT = /\b(cookies?|consent|privacy (choices|settings|preferences)|gdpr|tracking technologies)\b/i;
// An age gate asks the visitor to attest something. It often mentions cookies
// in its small print, but it is not a consent banner and is never touched.
export const AGE_GATE_TEXT = /legal drinking age|of legal age|(are you|you are|you're|confirm (that )?you('re| are)) (over|at least|of age)|\b(18|19|20|21)\+?\s*(years|or older|and over)|date of birth|birth ?date|enter your (age|birth)/i;
const HIDDEN_ATTR = 'data-designlang-consent';

// Runs inside the page. Stage 'reject' presses the first refusal control in a
// detected root. Stage 'hide' hides what is still showing, hides backdrops,
// and releases the scroll lock. Both stages return what they saw.
function consentPassInPage({ stage, afterClick = false, selectors, backdropSelectors, rejectSource, textSource, ageSource, hiddenAttr }) {
  const REJECT = new RegExp(rejectSource, 'i');
  const TEXT = new RegExp(textSource, 'i');
  const AGE = new RegExp(ageSource, 'i');
  // Consent tools render inside open shadow roots too (N26). Queries cover
  // the document and every open shadow root, bounded.
  const shadowRoots = [];
  (function collectRoots(root, depth) {
    if (depth > 6 || shadowRoots.length >= 500) return;
    for (const host of root.querySelectorAll('*')) {
      if (host.shadowRoot) { shadowRoots.push(host.shadowRoot); collectRoots(host.shadowRoot, depth + 1); if (shadowRoots.length >= 500) return; }
    }
  })(document, 0);
  const queryAll = (sel) => {
    const out = [];
    for (const r of [document, ...shadowRoots]) { try { out.push(...r.querySelectorAll(sel)); } catch { /* invalid selector */ } }
    return out;
  };
  const labelOf = (el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}`;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const rendered = (el) => {
    if (!el || !(el instanceof Element)) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  };
  const boxed = (el) => { const r = el.getBoundingClientRect(); return r.width >= 40 && r.height >= 24; };
  // A tool's wrapper often has no box of its own (its children are fixed),
  // so a root counts as shown when it or a direct child has a box.
  const shown = (el) => rendered(el) && (boxed(el) || Array.from(el.children).some(c => rendered(c) && boxed(c)));
  const shownControl = (el) => { if (!rendered(el)) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const roots = [];
  const detected = [];
  const ignored = [];
  const add = (el, label) => {
    if (!el || roots.some(r => r === el || r.contains(el) || el.contains(r))) return;
    roots.push(el);
    detected.push(label);
  };
  for (const sel of selectors) {
    for (const el of queryAll(sel)) if (shown(el)) add(el, sel);
  }
  if (!roots.length) {
    // Generic shape: fixed/sticky or modal, at least 2% of the viewport, talks
    // about cookies within its first 600 characters, and holds a control.
    const candidates = queryAll('div, section, aside, dialog, form, [role="dialog"], [role="alertdialog"]');
    for (const el of candidates) {
      if (!shown(el)) continue;
      const cs = getComputedStyle(el);
      const modal = el.getAttribute('aria-modal') === 'true' || el.tagName === 'DIALOG';
      if (!modal && cs.position !== 'fixed' && cs.position !== 'sticky') continue;
      // The part of the box that is on screen must be at least 2% of the
      // viewport: an off-screen cart drawer is fixed too, but not a banner.
      const r = el.getBoundingClientRect();
      const ox = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
      const oy = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
      if (ox * oy < 0.02 * vw * vh) continue;
      const text = norm(el.textContent).slice(0, 600);
      if (!TEXT.test(text)) continue;
      if (!el.querySelector('button, [role="button"], input[type="button"], input[type="submit"], a[href]')) continue;
      if (AGE.test(text)) { ignored.push(`age-gate:${labelOf(el)}`); continue; }
      add(el, `generic:${labelOf(el)}`);
      if (roots.length >= 3) break;
    }
  }
  const releaseScrollLock = () => {
    let released = false;
    for (const el of [document.documentElement, document.body]) {
      if (!el) continue;
      const cs = getComputedStyle(el);
      if (cs.overflowY === 'hidden' || cs.overflow === 'hidden') { el.style.setProperty('overflow', 'auto', 'important'); released = true; }
      if (cs.position === 'fixed') { el.style.setProperty('position', 'static', 'important'); released = true; }
    }
    return released;
  };
  if (!roots.length) {
    // After a refusal click the tool is gone, but its lock may linger.
    const scrollLockReleased = stage === 'hide' && afterClick ? releaseScrollLock() : false;
    return { detected: [], ignored, clicked: false, hidden: 0, scrollLockReleased };
  }

  if (stage === 'reject') {
    for (const root of roots) {
      const controls = root.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"], a');
      for (const c of controls) {
        const label = norm(c.tagName === 'INPUT' ? c.value : (c.getAttribute('aria-label') || c.textContent));
        if (label.length > 40 || !REJECT.test(label) || !shownControl(c)) continue;
        c.click();
        return { detected, ignored, clicked: true, hidden: 0, scrollLockReleased: false };
      }
    }
    return { detected, ignored, clicked: false, hidden: 0, scrollLockReleased: false };
  }

  // stage 'hide'
  let hidden = 0;
  const hide = (el) => {
    if (!el || el.getAttribute(hiddenAttr)) return;
    el.style.setProperty('display', 'none', 'important');
    el.setAttribute(hiddenAttr, 'hidden');
    hidden++;
  };
  for (const root of roots) hide(root);
  for (const sel of backdropSelectors) {
    for (const el of queryAll(sel)) if (shown(el)) hide(el);
  }
  // Backdrop by shape: fixed, covers the viewport, translucent or filtered,
  // and holds no text of its own.
  for (const el of queryAll('div, span, section')) {
    if (!shown(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed') continue;
    const r = el.getBoundingClientRect();
    if (r.width < vw * 0.9 || r.height < vh * 0.9) continue;
    if (norm(el.textContent).length > 0) continue;
    const alpha = (() => { const m = /rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*([\d.]+))?\s*\)/.exec(cs.backgroundColor); return m ? (m[1] == null ? 1 : Number(m[1])) : 1; })();
    const translucent = (alpha > 0 && alpha < 1) || Number(cs.opacity) < 1 || (cs.backdropFilter && cs.backdropFilter !== 'none');
    if (translucent) hide(el);
  }
  // Release the scroll lock the tool put on the document.
  const scrollLockReleased = releaseScrollLock();
  return { detected, ignored, clicked: false, hidden, scrollLockReleased };
}

// Node side. Returns { detected, action, scrollLockReleased, ignored } where
// action is 'rejected', 'hidden', 'rejected+hidden', or 'none', and ignored
// names boxes that looked like a banner but were left alone (an age gate).
// Never throws.
export async function neutralizeConsent(page, { settleMs = 500 } = {}) {
  const args = {
    selectors: CONSENT_SELECTORS,
    backdropSelectors: CONSENT_BACKDROP_SELECTORS,
    rejectSource: REJECT_BUTTON_PATTERN.source,
    textSource: CONSENT_TEXT.source,
    ageSource: AGE_GATE_TEXT.source,
    hiddenAttr: HIDDEN_ATTR,
  };
  const none = { detected: [], action: 'none', scrollLockReleased: false, ignored: [] };
  let first;
  try { first = await page.evaluate(consentPassInPage, { ...args, stage: 'reject' }); } catch { return none; }
  if (!first || !first.detected.length) return { ...none, ignored: (first && first.ignored) || [] };
  if (first.clicked) await page.waitForTimeout(settleMs).catch(() => {});
  let second;
  try { second = await page.evaluate(consentPassInPage, { ...args, stage: 'hide', afterClick: first.clicked }); } catch { second = null; }
  const hidden = !!(second && second.hidden > 0);
  const scrollLockReleased = !!(second && second.scrollLockReleased);
  const detected = [...new Set([...first.detected, ...((second && second.detected) || [])])];
  const ignored = [...new Set([...(first.ignored || []), ...((second && second.ignored) || [])])];
  let action = 'none';
  if (first.clicked && hidden) action = 'rejected+hidden';
  else if (first.clicked) action = 'rejected';
  else if (hidden) action = 'hidden';
  return { detected, action, scrollLockReleased, ignored };
}
