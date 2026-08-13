/*
 * flipbook.js — StPageFlip integration and the render window.
 *
 * StPageFlip handles the curl animation and the portrait/landscape switch. Our
 * job is to feed it page surfaces and to make sure only a handful of pages hold
 * pixels at any moment (see pdf-source.js for why that matters).
 */

import * as pdfSource from './pdf-source.js';
import { buildTextLayer, clearTextLayer } from './text-layer.js';

// Pages either side of the current spread to render ahead of time.
const PRELOAD = 2;
// Pages either side to keep in memory before releasing.
const RETAIN = 4;

let flip = null;
let bookEl = null;
let wrapEl = null;
let pageEls = [];
let pageCount = 0;
let ratio = 0.707;
let config = null;
let onChange = null;
let reduceMotion = false;

/** Builds the empty page surfaces StPageFlip will animate. */
function buildPages(container, count) {
  const frag = document.createDocumentFragment();
  const els = [];

  for (let i = 1; i <= count; i++) {
    const el = document.createElement('div');
    el.className = 'page';
    el.dataset.page = String(i);
    // Density is 'hard' for the covers so they don't bend like paper.
    el.dataset.density = i === 1 || i === count ? 'hard' : 'soft';

    const canvas = document.createElement('canvas');
    // A fresh canvas defaults to 300x150, which across 98 pages reserves ~18 MB
    // of backing store for pages that may never be looked at. Start at zero and
    // let renderPage size it on demand.
    canvas.width = 0;
    canvas.height = 0;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `Page ${i}`);
    el.appendChild(canvas);

    const textLayer = document.createElement('div');
    textLayer.className = 'text-layer';
    el.appendChild(textLayer);

    const spinner = document.createElement('div');
    spinner.className = 'page-spinner';
    el.appendChild(spinner);

    frag.appendChild(el);
    els.push(el);
  }

  container.appendChild(frag);
  return els;
}

/*
 * Sizing note. In 'stretch' mode StPageFlip measures its own block element's
 * offsetWidth/offsetHeight and derives the page box from that, and it switches
 * to a single page when that width drops below 2 * minWidth. So two things have
 * to line up: #book must be given an explicit box (otherwise its height is
 * whatever 98 stacked divs happen to measure, and pages overflow the screen),
 * and our portrait threshold must equal 2 * minWidth or the library and this
 * module would disagree about how many pages are on screen.
 */
const PORTRAIT_BELOW = 768;      // must stay equal to 2 * minWidth below
const MAX_PAGE_WIDTH = 1200;

/** The wrap's content box, excluding the padding that keeps the pager clear. */
function availableBox(wrap) {
  const cs = getComputedStyle(wrap);
  const w = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const h = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  return { w: Math.max(w, 120), h: Math.max(h, 160) };
}

/**
 * Largest page that fits, preserving the PDF's aspect ratio. Returns the single
 * page size plus how many pages are on screen.
 */
function computeSize(wrap) {
  const avail = availableBox(wrap);
  const portrait = avail.w < PORTRAIT_BELOW;
  const spreadPages = portrait ? 1 : 2;

  let w = Math.min(avail.w / spreadPages, MAX_PAGE_WIDTH);
  let h = w / ratio;
  if (h > avail.h) {
    h = avail.h;
    w = h * ratio;
  }

  return {
    width: Math.floor(w),
    height: Math.floor(h),
    spreadPages,
    portrait,
  };
}

/**
 * Pins #book to the exact spread box. Without this StPageFlip stretches to the
 * full stage width and the pages run off the bottom of the screen.
 */
function applySize(container, wrap) {
  const size = computeSize(wrap);
  container.style.width = `${size.width * size.spreadPages}px`;
  container.style.height = `${size.height}px`;
  return size;
}

/**
 * The width a page occupies on screen. StPageFlip sets this once it has laid
 * out, but the first render can fire before that, when clientWidth is still 0 —
 * so fall back to the size we calculated ourselves, and never return 0, which
 * would produce a degenerate scale and a blank canvas.
 */
function pageCssWidth(el) {
  const measured = el ? el.clientWidth : 0;
  if (measured >= 40) return measured;
  const wrap = document.getElementById('book-wrap');
  return Math.max(computeSize(wrap).width, 200);
}

/** Renders one page's canvas and text layer if not already done. */
async function ensurePage(pageNum) {
  if (pageNum < 1 || pageNum > pageCount) return;
  const el = pageEls[pageNum - 1];
  if (!el) return;

  const canvas = el.querySelector('canvas');
  const cssWidth = pageCssWidth(el);

  try {
    await pdfSource.renderPage(pageNum, canvas, cssWidth, config.maxRenderScale);
    el.classList.add('loaded');
    // Text layer is cheap next to the canvas and enables selection + highlights.
    await buildTextLayer(pageNum, el.querySelector('.text-layer'), cssWidth);
  } catch (err) {
    console.warn(`Page ${pageNum} failed to render`, err);
  }
}

/**
 * Renders the pages around `current` and releases the ones that have drifted
 * out of range. This is the whole memory strategy in one function.
 */
function updateWindow(current) {
  const keep = new Set();
  for (let p = current - RETAIN; p <= current + RETAIN + 1; p++) {
    if (p >= 1 && p <= pageCount) keep.add(p);
  }

  pdfSource.retainOnly(keep);

  // Drop the DOM text/loaded state for released pages so they re-render clean.
  for (let i = 1; i <= pageCount; i++) {
    if (!keep.has(i)) {
      const el = pageEls[i - 1];
      if (el && el.classList.contains('loaded')) {
        el.classList.remove('loaded');
        clearTextLayer(el.querySelector('.text-layer'));
      }
    }
  }

  // Current spread first, then outwards, so what the reader sees lands soonest.
  const order = [current, current + 1];
  for (let d = 1; d <= PRELOAD; d++) {
    order.push(current - d, current + 1 + d);
  }
  for (const p of order) ensurePage(p);
}

/**
 * @param {object} opts
 * @param {HTMLElement} opts.container  #book
 * @param {HTMLElement} opts.wrap       #book-wrap
 * @param {object} opts.config
 * @param {number} [opts.startPage]     1-based page to open on
 * @param {(page:number, total:number)=>void} opts.onChange
 */
export async function init({ container, wrap, config: cfg, startPage = 1, onChange: cb }) {
  config = cfg;
  onChange = cb;
  reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  pageCount = pdfSource.getPageCount();
  const base = await pdfSource.getBaseViewport();
  ratio = base.ratio;

  pageEls = buildPages(container, pageCount);

  bookEl = container;
  wrapEl = wrap;
  const { width, height } = applySize(container, wrap);

  flip = new window.St.PageFlip(container, {
    width,
    height,
    size: 'stretch',
    // Half of PORTRAIT_BELOW: this is what makes StPageFlip drop to a single
    // page at the same width our own layout maths switches at.
    minWidth: PORTRAIT_BELOW / 2,
    maxWidth: MAX_PAGE_WIDTH,
    minHeight: 250,
    maxHeight: 2400,
    // Single page on phones, two-page spread on tablet and desktop.
    usePortrait: true,
    // Page 1 and the back page stand alone, as a real magazine does.
    showCover: true,
    autoSize: true,
    mobileScrollSupport: true,
    maxShadowOpacity: 0.5,
    flippingTime: reduceMotion ? 1 : 800,
    drawShadow: !reduceMotion,
    swipeDistance: 30,
    useMouseEvents: true,
    // Open straight on the requested page so a shared link doesn't render the
    // cover and then jump.
    startPage: Math.min(Math.max(startPage, 1), pageCount) - 1,
  });

  flip.loadFromHTML(container.querySelectorAll('.page'));

  // Constructing StPageFlip rewrites the container's inline width, so re-pin the
  // box and let it re-measure. Without this the first layout is driven by the
  // library's own fallback and differs from every later resize.
  applySize(container, wrap);
  flip.update();

  flip.on('flip', (e) => {
    const current = e.data + 1;
    updateWindow(current);
    if (onChange) onChange(current, pageCount);
  });

  flip.on('changeOrientation', () => {
    // Page boxes changed size, so the canvases need re-rendering at the new
    // width or they look soft. Clearing 'loaded' forces that.
    for (const el of pageEls) el.classList.remove('loaded');
    pdfSource.retainOnly(new Set());
    updateWindow(getCurrentPage());
  });

  const opening = getCurrentPage();
  updateWindow(opening);
  if (onChange) onChange(opening, pageCount);

  return { pageCount };
}

export function getCurrentPage() {
  return flip ? flip.getCurrentPageIndex() + 1 : 1;
}

export function getPageCountValue() {
  return pageCount;
}

export function next() {
  if (flip) flip.flipNext();
}

export function prev() {
  if (flip) flip.flipPrev();
}

/** Jumps to a page. Long jumps skip the animation and tidy pdf.js's cache. */
export function goTo(pageNum, { animate = false } = {}) {
  if (!flip) return;
  const target = Math.min(Math.max(pageNum, 1), pageCount);
  const distance = Math.abs(target - getCurrentPage());

  if (animate && distance <= 2 && !reduceMotion) {
    flip.flip(target - 1);
  } else {
    flip.turnToPage(target - 1);
    if (distance > RETAIN * 2) pdfSource.cleanupDocumentCache();
  }

  updateWindow(target);
  if (onChange) onChange(getCurrentPage(), pageCount);
}

/**
 * Re-fits the book after a resize or an orientation change. The explicit box on
 * #book has to be recomputed first, then StPageFlip re-measures it, then the
 * canvases are re-rendered at the new width so they don't look soft.
 */
export function handleResize() {
  if (!flip) return;

  applySize(bookEl, wrapEl);
  flip.update();

  for (const el of pageEls) el.classList.remove('loaded');
  pdfSource.retainOnly(new Set());
  updateWindow(getCurrentPage());
}

/**
 * Turns text selection on or off. While selection is on, dragging selects text
 * instead of curling the page, so page turning goes through the buttons, keys
 * and thumbnails. Trying to support both gestures at once fights the user.
 */
export function setSelecting(on) {
  const container = document.getElementById('book');
  container.classList.toggle('selecting', on);
  document.body.classList.toggle('selecting', on);
}

export function getPageElement(pageNum) {
  return pageEls[pageNum - 1] || null;
}
