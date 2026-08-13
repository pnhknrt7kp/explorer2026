/*
 * zoom.js — full-screen single-page zoom with pinch and pan.
 *
 * StPageFlip has no zoom, and on a phone an A4 page at screen width is
 * unreadable, so this is the module that makes the magazine actually usable on
 * small devices.
 *
 * Gestures are implemented directly on Pointer Events rather than leaning on
 * native browser pinch-zoom. Native behaviour differs between iOS, Android and
 * desktop trackpads and can't be constrained to one element; doing the maths
 * ourselves gives identical behaviour everywhere and keeps the toolbar fixed.
 */

import * as pdfSource from './pdf-source.js';
import { buildTextLayer, clearTextLayer } from './text-layer.js';

const MIN_SCALE = 1;
const MAX_SCALE = 6;
// Past this, re-render from the PDF so text is genuinely sharp rather than
// an upscaled blur of the page-sized canvas.
const RESHARP_AT = 1.6;

let els = {};
let pageNum = 1;
let baseWidth = 0;
let baseHeight = 0;
let ratio = 0.707;
let renderedAtScale = 1;
let resharpening = false;

let scale = 1;
let tx = 0;
let ty = 0;

/** Active pointers, for pinch tracking. */
const pointers = new Map();
let pinchStart = null;
let panStart = null;
let hintTimer = null;

export function init(elements) {
  els = elements;

  els.viewport.addEventListener('pointerdown', onPointerDown);
  els.viewport.addEventListener('pointermove', onPointerMove);
  els.viewport.addEventListener('pointerup', onPointerUp);
  els.viewport.addEventListener('pointercancel', onPointerUp);
  els.viewport.addEventListener('wheel', onWheel, { passive: false });
  els.viewport.addEventListener('dblclick', onDoubleClick);

  els.zoomIn.addEventListener('click', () => zoomBy(1.5));
  els.zoomOut.addEventListener('click', () => zoomBy(1 / 1.5));
  els.close.addEventListener('click', close);
}

export function isOpen() {
  return !els.root.hidden;
}

/** Opens the overlay on a page, sized to fit. */
export async function open(page) {
  pageNum = page;
  els.root.hidden = false;
  els.label.textContent = `Page ${page}`;
  document.body.style.overflow = 'hidden';

  const base = await pdfSource.getBaseViewport();
  ratio = base.ratio;

  fitToViewport();
  resetTransform();
  showHint();

  await renderAt(1);
}

export function close() {
  els.root.hidden = true;
  document.body.style.overflow = '';
  clearTextLayer(els.text);
  // Release the zoom canvas — it can be the largest single canvas in the app.
  els.canvas.width = 0;
  els.canvas.height = 0;
  pointers.clear();
  pinchStart = null;
  panStart = null;
}

/** Sizes the page to fit the viewport box at scale 1. */
function fitToViewport() {
  const box = els.viewport.getBoundingClientRect();
  const availW = box.width - 24;
  const availH = box.height - 24;

  let h = availH;
  let w = h * ratio;
  if (w > availW) {
    w = availW;
    h = w / ratio;
  }

  baseWidth = Math.floor(w);
  baseHeight = Math.floor(h);

  els.surface.style.width = `${baseWidth}px`;
  els.surface.style.height = `${baseHeight}px`;

  // Centre it in the viewport.
  els.surface.style.marginLeft = `${Math.max((box.width - baseWidth) / 2, 0)}px`;
  els.surface.style.marginTop = `${Math.max((box.height - baseHeight) / 2, 0)}px`;
}

/** Renders the page canvas at `targetScale` times the fitted size. */
async function renderAt(targetScale) {
  if (resharpening) return;
  resharpening = true;

  try {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.min(baseWidth * targetScale * dpr, 4096);

    const { canvas } = await pdfSource.renderToNewCanvas(pageNum, pixelWidth);

    els.canvas.width = canvas.width;
    els.canvas.height = canvas.height;
    els.canvas.getContext('2d', { alpha: false }).drawImage(canvas, 0, 0);
    // Free the scratch canvas immediately.
    canvas.width = 0;
    canvas.height = 0;

    renderedAtScale = targetScale;

    await buildTextLayer(pageNum, els.text, baseWidth);
  } catch (err) {
    console.warn('Zoom render failed', err);
  } finally {
    resharpening = false;
  }
}

function applyTransform() {
  els.surface.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
}

function resetTransform() {
  scale = 1;
  tx = 0;
  ty = 0;
  applyTransform();
}

/**
 * Keeps the page from being dragged entirely off screen. When the page is
 * smaller than the viewport on an axis it stays centred on that axis.
 */
function clampPan() {
  const box = els.viewport.getBoundingClientRect();
  const scaledW = baseWidth * scale;
  const scaledH = baseHeight * scale;

  const slackX = Math.max((scaledW - box.width) / 2, 0);
  const slackY = Math.max((scaledH - box.height) / 2, 0);

  tx = Math.min(Math.max(tx, -slackX), slackX);
  ty = Math.min(Math.max(ty, -slackY), slackY);
}

/** Zooms about the centre of the viewport. */
function zoomBy(factor) {
  const box = els.viewport.getBoundingClientRect();
  zoomAbout(scale * factor, box.width / 2, box.height / 2);
}

/**
 * Zooms so the content under (cx, cy) — viewport coordinates — stays put.
 */
function zoomAbout(nextScale, cx, cy) {
  const clamped = Math.min(Math.max(nextScale, MIN_SCALE), MAX_SCALE);
  if (clamped === scale) return;

  const box = els.viewport.getBoundingClientRect();
  // Position of the anchor relative to the surface's centre, unscaled.
  const originX = cx - box.width / 2 - tx;
  const originY = cy - box.height / 2 - ty;
  const factor = clamped / scale;

  tx -= originX * (factor - 1);
  ty -= originY * (factor - 1);
  scale = clamped;

  clampPan();
  applyTransform();
  maybeResharpen();
}

/** Re-renders at higher resolution once zoomed in far enough to notice. */
function maybeResharpen() {
  if (scale >= RESHARP_AT && scale > renderedAtScale * 1.4) {
    renderAt(Math.min(scale, 4));
  }
}

function onPointerDown(e) {
  // Let the text layer handle its own selection gestures.
  if (e.target.closest('.text-layer span')) return;

  els.viewport.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  hideHint();

  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchStart = {
      distance: Math.hypot(b.x - a.x, b.y - a.y),
      scale,
      midX: (a.x + b.x) / 2,
      midY: (a.y + b.y) / 2,
    };
    panStart = null;
  } else if (pointers.size === 1) {
    panStart = { x: e.clientX, y: e.clientY, tx, ty };
    els.viewport.classList.add('dragging');
  }
}

function onPointerMove(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (pointers.size === 2 && pinchStart) {
    const [a, b] = [...pointers.values()];
    const distance = Math.hypot(b.x - a.x, b.y - a.y);
    if (pinchStart.distance > 0) {
      const box = els.viewport.getBoundingClientRect();
      const next = pinchStart.scale * (distance / pinchStart.distance);
      zoomAbout(next, pinchStart.midX - box.left, pinchStart.midY - box.top);
    }
  } else if (pointers.size === 1 && panStart) {
    tx = panStart.tx + (e.clientX - panStart.x);
    ty = panStart.ty + (e.clientY - panStart.y);
    clampPan();
    applyTransform();
  }
}

function onPointerUp(e) {
  pointers.delete(e.pointerId);
  if (els.viewport.hasPointerCapture?.(e.pointerId)) {
    els.viewport.releasePointerCapture(e.pointerId);
  }

  if (pointers.size < 2) pinchStart = null;
  if (pointers.size === 0) {
    panStart = null;
    els.viewport.classList.remove('dragging');
    // Pinching back out to the fitted size is the natural way to dismiss.
    if (scale <= MIN_SCALE * 1.02) resetTransform();
  }
}

function onWheel(e) {
  e.preventDefault();
  const box = els.viewport.getBoundingClientRect();
  // Trackpad pinch arrives as a wheel event with ctrlKey set.
  const intensity = e.ctrlKey ? 0.01 : 0.0025;
  const factor = Math.exp(-e.deltaY * intensity);
  zoomAbout(scale * factor, e.clientX - box.left, e.clientY - box.top);
}

function onDoubleClick(e) {
  const box = els.viewport.getBoundingClientRect();
  if (scale > 1.05) {
    resetTransform();
    maybeResharpen();
  } else {
    zoomAbout(2.5, e.clientX - box.left, e.clientY - box.top);
  }
}

function showHint() {
  els.hint.classList.remove('faded');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(hideHint, 2600);
}

function hideHint() {
  els.hint.classList.add('faded');
}

export function handleResize() {
  if (!isOpen()) return;
  fitToViewport();
  clampPan();
  applyTransform();
}
