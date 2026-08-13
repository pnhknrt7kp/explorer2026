/*
 * thumbnails.js — the pages panel, the page-number jump, and locating the
 * magazine's own contents page.
 *
 * 98 thumbnails is too many to render on open, so each one paints only when it
 * scrolls into view. Thumbnails are small enough (~140px wide) that keeping
 * them all once painted is fine — the expensive canvases are the full pages.
 */

import * as pdfSource from './pdf-source.js';

const THUMB_WIDTH = 150;

let listEl = null;
let onPick = null;
let observer = null;
let currentPage = 1;

/**
 * @param {object} opts
 * @param {HTMLElement} opts.list  the <ol> to fill
 * @param {number} opts.pageCount
 * @param {number} opts.ratio  page width / height
 * @param {(page:number)=>void} opts.onPick
 */
export function init({ list, pageCount, ratio, onPick: cb }) {
  listEl = list;
  onPick = cb;

  const frag = document.createDocumentFragment();

  for (let i = 1; i <= pageCount; i++) {
    const li = document.createElement('li');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'thumb';
    btn.dataset.page = String(i);
    btn.setAttribute('aria-label', `Go to page ${i}`);

    // Reserve the right box before the canvas exists so the list doesn't jump
    // around as thumbnails stream in.
    const shim = document.createElement('div');
    shim.className = 'thumb-shim';
    shim.style.paddingTop = `${(1 / ratio) * 100}%`;
    btn.appendChild(shim);

    const num = document.createElement('span');
    num.className = 'thumb-num';
    num.textContent = String(i);
    btn.appendChild(num);

    li.appendChild(btn);
    frag.appendChild(li);
  }

  listEl.appendChild(frag);

  listEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.thumb');
    if (btn && onPick) onPick(Number(btn.dataset.page));
  });

  observer = new IntersectionObserver(onIntersect, {
    root: listEl,
    // Start a little early so scrolling feels like the images are already there.
    rootMargin: '200px 0px',
  });

  for (const btn of listEl.querySelectorAll('.thumb')) observer.observe(btn);

  setCurrent(currentPage);
}

function onIntersect(entries) {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const btn = entry.target;
    observer.unobserve(btn);
    paint(btn);
  }
}

async function paint(btn) {
  if (btn.dataset.painted) return;
  btn.dataset.painted = '1';

  const pageNum = Number(btn.dataset.page);
  try {
    const { canvas } = await pdfSource.renderToNewCanvas(pageNum, THUMB_WIDTH);
    const shim = btn.querySelector('.thumb-shim');
    if (shim) shim.remove();
    btn.insertBefore(canvas, btn.firstChild);
  } catch (err) {
    // A thumbnail that won't paint isn't worth interrupting reading over.
    console.warn(`Thumbnail ${pageNum} failed`, err);
    delete btn.dataset.painted;
  }
}

/** Marks the active thumbnail and scrolls it into view. */
export function setCurrent(pageNum) {
  currentPage = pageNum;
  if (!listEl) return;

  for (const btn of listEl.querySelectorAll('.thumb.current')) {
    btn.classList.remove('current');
  }

  const btn = listEl.querySelector(`.thumb[data-page="${pageNum}"]`);
  if (btn) {
    btn.classList.add('current');
    if (listEl.offsetParent) {
      btn.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
}

/**
 * Finds the magazine's own table-of-contents page by reading the text of the
 * opening pages. Deliberately not a hardcoded page number: a new edition can
 * move it, and this survives that. Returns null if there isn't one.
 */
export async function findContentsPage(pageCount, limit = 15) {
  const last = Math.min(limit, pageCount);

  for (let i = 1; i <= last; i++) {
    try {
      const tc = await pdfSource.getTextContent(i);
      const text = tc.items.map((item) => item.str).join(' ');
      if (/table\s*of\s*contents|^\s*contents\s*$/i.test(text)) return i;
    } catch {
      // Unreadable page — just keep looking.
    }
  }
  return null;
}
