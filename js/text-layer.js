/*
 * text-layer.js — transparent, selectable text over each rendered page.
 *
 * pdf.js gives every text item a transform matrix in PDF space. We convert that
 * to CSS pixels and place an absolutely positioned span per item, coloured
 * transparent so the canvas underneath shows through. Two payoffs: the reader
 * can select and copy, and the browser's own Ctrl+F finds words on the visible
 * pages.
 *
 * Pointer events are off by default (see flipbook.css) so dragging still curls
 * the page; the toolbar's "select text" toggle turns them on.
 */

import * as pdfSource from './pdf-source.js';

/**
 * @param {number} pageNum
 * @param {HTMLElement} layer
 * @param {number} cssWidth width the page occupies on screen
 */
export async function buildTextLayer(pageNum, layer, cssWidth) {
  if (!layer || layer.dataset.page === String(pageNum)) return;

  const [textContent, base] = await Promise.all([
    pdfSource.getTextContent(pageNum),
    pdfSource.getViewport(pageNum, 1),
  ]);

  // Scale from PDF units to the on-screen size of the page.
  const scale = cssWidth / base.width;
  const viewport = await pdfSource.getViewport(pageNum, scale);

  const frag = document.createDocumentFragment();

  for (let i = 0; i < textContent.items.length; i++) {
    const item = textContent.items[i];
    if (!item.str || !item.str.trim()) continue;

    // [a, b, c, d, e, f] in viewport space after applying the transform.
    const tx = applyTransform(item.transform, viewport.transform);
    const fontHeight = Math.hypot(tx[2], tx[3]);
    if (!fontHeight) continue;

    const span = document.createElement('span');
    span.textContent = item.str;
    span.dataset.item = String(i);

    // Baseline sits at tx[5]; CSS positions from the top of the line box.
    span.style.left = `${tx[4]}px`;
    span.style.top = `${tx[5] - fontHeight}px`;
    span.style.fontSize = `${fontHeight}px`;
    span.style.fontFamily = 'sans-serif';

    // Squeeze the span to the width pdf.js measured, so selection highlights
    // line up with the glyphs painted on the canvas.
    if (item.width) {
      const targetWidth = item.width * scale;
      span.style.width = `${targetWidth}px`;
      span.dataset.width = String(targetWidth);
    }

    frag.appendChild(span);
  }

  layer.textContent = '';
  layer.appendChild(frag);
  layer.dataset.page = String(pageNum);

  // Horizontal scaling needs measured widths, so it happens after insertion.
  normalizeWidths(layer);
}

/** Multiplies a pdf.js text transform by the viewport transform. */
function applyTransform(t, v) {
  return [
    v[0] * t[0] + v[2] * t[1],
    v[1] * t[0] + v[3] * t[1],
    v[0] * t[2] + v[2] * t[3],
    v[1] * t[2] + v[3] * t[3],
    v[0] * t[4] + v[2] * t[5] + v[4],
    v[1] * t[4] + v[3] * t[5] + v[5],
  ];
}

/**
 * The PDF's real fonts aren't loaded for the overlay, so our sans-serif spans
 * rarely match the measured width. A horizontal transform pulls each span onto
 * the width pdf.js reported, which keeps selection rectangles honest.
 */
function normalizeWidths(layer) {
  const spans = layer.querySelectorAll('span[data-width]');
  for (const span of spans) {
    const target = parseFloat(span.dataset.width);
    const actual = span.getBoundingClientRect().width;
    if (target > 0 && actual > 0) {
      const ratio = target / actual;
      // Ignore wild ratios; they signal a measurement we shouldn't trust.
      if (ratio > 0.05 && ratio < 20) {
        span.style.transform = `scaleX(${ratio})`;
      }
    }
    span.style.width = 'auto';
  }
}

export function clearTextLayer(layer) {
  if (!layer) return;
  layer.textContent = '';
  delete layer.dataset.page;
}

/** Highlights specific text items, used when jumping to a search result. */
export function highlightItems(layer, itemIndices) {
  if (!layer) return;
  clearHighlights(layer);
  const wanted = new Set(itemIndices.map(String));
  for (const span of layer.querySelectorAll('span[data-item]')) {
    if (wanted.has(span.dataset.item)) span.classList.add('hit');
  }
}

export function clearHighlights(layer) {
  if (!layer) return;
  for (const span of layer.querySelectorAll('span.hit')) {
    span.classList.remove('hit');
  }
}
