/*
 * pdf-source.js — owns the PDF document and all canvas memory.
 *
 * The memory discipline here is the point of this module. This magazine is 98
 * A4 pages; at 2x device pixel ratio each rendered page is roughly 8 MB of
 * RGBA, so rendering them all would ask the browser for ~780 MB. iOS Safari
 * caps total canvas memory and silently paints blank pages once you cross it,
 * so we keep only a small window of pages rendered and actively release the
 * rest.
 */

const WORKER_SRC = 'vendor/pdfjs/pdf.worker.min.mjs';

// Long edge ceiling per page canvas, independent of DPR. Keeps a single canvas
// well inside mobile Safari's per-canvas limits.
const MAX_EDGE = 2048;

let pdfjs = null;
let doc = null;

/** page number -> { canvas, task, scale, done } */
const rendered = new Map();

/** page number -> Promise<TextContent> */
const textCache = new Map();

/**
 * Loads pdf.js and opens the document.
 * @param {string} url
 * @param {(loaded:number, total:number)=>void} [onProgress]
 */
export async function open(url, onProgress) {
  pdfjs = await import('../vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = WORKER_SRC;

  const task = pdfjs.getDocument({
    url,
    // Bundled CMaps/fonts are not vendored, so lean on system fonts instead.
    useSystemFonts: true,
    disableAutoFetch: false,
  });

  if (onProgress) {
    task.onProgress = ({ loaded, total }) => onProgress(loaded, total || 0);
  }

  doc = await task.promise;
  return doc;
}

export function getPageCount() {
  return doc ? doc.numPages : 0;
}

/**
 * Width/height of page 1 at scale 1. Every page in this magazine is the same
 * size, and StPageFlip needs one fixed aspect ratio for the whole book, so
 * page 1 sets the shape for all of them.
 */
export async function getBaseViewport() {
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  return { width: vp.width, height: vp.height, ratio: vp.width / vp.height };
}

/** Scale that fills cssWidth px of layout, capped for memory. */
function pickScale(viewportWidth, cssWidth, maxRenderScale) {
  const dpr = Math.min(window.devicePixelRatio || 1, maxRenderScale);
  const target = (cssWidth * dpr) / viewportWidth;
  const capped = Math.min(target, MAX_EDGE / viewportWidth);
  return Math.max(capped, 0.1);
}

/**
 * Renders a page into a canvas. Safe to call repeatedly; an in-flight render
 * for the same page at the same scale is reused rather than duplicated.
 *
 * @param {number} pageNum 1-based
 * @param {HTMLCanvasElement} canvas
 * @param {number} cssWidth intended CSS width in px
 * @param {number} maxRenderScale from config
 */
export async function renderPage(pageNum, canvas, cssWidth, maxRenderScale) {
  const page = await doc.getPage(pageNum);
  const base = page.getViewport({ scale: 1 });
  const scale = pickScale(base.width, cssWidth, maxRenderScale);

  const existing = rendered.get(pageNum);
  // Already sharp enough — don't burn memory re-rendering for a few percent.
  if (existing && existing.done && existing.canvas === canvas && existing.scale >= scale * 0.95) {
    return;
  }
  if (existing && existing.task) {
    existing.task.cancel();
  }

  const viewport = page.getViewport({ scale });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);

  const ctx = canvas.getContext('2d', { alpha: false });
  const task = page.render({ canvasContext: ctx, viewport });

  rendered.set(pageNum, { canvas, task, scale, done: false });

  try {
    await task.promise;
    const entry = rendered.get(pageNum);
    if (entry && entry.task === task) {
      entry.task = null;
      entry.done = true;
    }
  } catch (err) {
    // Cancelling a render is normal during fast flipping, not a failure.
    if (err && err.name === 'RenderingCancelledException') return;
    throw err;
  }
}

/**
 * Renders a page into a detached canvas at a fixed pixel width — used for
 * thumbnails and the zoom view, which manage their own lifetimes.
 */
export async function renderToNewCanvas(pageNum, pixelWidth) {
  const page = await doc.getPage(pageNum);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(pixelWidth / base.width, MAX_EDGE / base.width);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);

  const ctx = canvas.getContext('2d', { alpha: false });
  await page.render({ canvasContext: ctx, viewport }).promise;
  return { canvas, viewport };
}

/**
 * Frees a page's pixels. Setting the dimensions to zero is what actually
 * returns the memory — dropping the reference alone leaves the backing store
 * alive until GC decides to run, which on iOS is too late to help.
 */
export function releasePage(pageNum) {
  const entry = rendered.get(pageNum);
  if (!entry) return;
  if (entry.task) entry.task.cancel();
  if (entry.canvas) {
    entry.canvas.width = 0;
    entry.canvas.height = 0;
  }
  rendered.delete(pageNum);
}

/**
 * Releases pdf.js's own internal page/font cache. Separate from our canvases
 * and worth calling after a long jump across the magazine, where none of the
 * cached intermediate pages will be wanted again.
 */
export function cleanupDocumentCache() {
  if (doc) doc.cleanup().catch(() => {});
}

export function isRendered(pageNum) {
  const entry = rendered.get(pageNum);
  return !!(entry && entry.done);
}

export function renderedCount() {
  return rendered.size;
}

/** Releases every page outside `keep`. */
export function retainOnly(keep) {
  for (const pageNum of [...rendered.keys()]) {
    if (!keep.has(pageNum)) releasePage(pageNum);
  }
}

/** Text items for a page, cached — the search index and text layer share this. */
export function getTextContent(pageNum) {
  if (!textCache.has(pageNum)) {
    textCache.set(
      pageNum,
      doc.getPage(pageNum).then((page) => page.getTextContent()),
    );
  }
  return textCache.get(pageNum);
}

/** Viewport at a given scale, for positioning text layer spans. */
export async function getViewport(pageNum, scale) {
  const page = await doc.getPage(pageNum);
  return page.getViewport({ scale });
}

export function getPdfjs() {
  return pdfjs;
}

export function getDocument() {
  return doc;
}
