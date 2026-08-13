/*
 * search.js — full-text search across the magazine.
 *
 * The index is built in the background after first paint, in small chunks, so
 * the reader can start reading immediately and typing never blocks on it.
 *
 * The important wrinkle: this PDF loses spaces at line breaks, so pdf.js text
 * items join up as "adipiscingelit" where the page reads "adipiscing elit". A
 * single normalised string can't match both, so every page is indexed twice —
 * once joined with spaces, once joined with nothing — and queries are tested
 * against both forms. Cheap, and it catches phrases that straddle a line break.
 */

import * as pdfSource from './pdf-source.js';

const CHUNK_SIZE = 12;
const MAX_RESULTS = 80;
const SNIPPET_RADIUS = 60;

/*
 * Characters removed to build the "tight" index. Whitespace covers the case
 * where a PDF's text stream drops the space at a line break; hyphens cover the
 * opposite and far more common case in a typeset magazine, where a word is
 * split across lines as "Wash- ington" or "reconnais- sance". Stripping both
 * from the page text and from the query makes either form findable.
 */
const TIGHT_STRIP = /[\s­‐-―-]+/g;

/** page number -> { spaced, tight, items } */
const index = new Map();

let pageCount = 0;
let building = false;
let built = false;
let onStatus = null;
let onDone = null;

/** Collapses case, whitespace and diacritics so search is forgiving. */
function normalize(text) {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')       // combining accents
    .replace(/[‘’‛]/g, "'") // curly single quotes
    .replace(/[“”]/g, '"')       // curly double quotes
    .replace(/[‐-―]/g, '-')      // dashes of every width
    .toLowerCase();
}

function collapse(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Builds both string forms for a page, plus a map from character offset back to
 * the text item that produced it, so results can be highlighted.
 */
async function indexPage(pageNum) {
  const tc = await pdfSource.getTextContent(pageNum);

  let spaced = '';
  const offsets = [];   // { start, end, item } in `spaced` coordinates

  for (let i = 0; i < tc.items.length; i++) {
    const str = tc.items[i].str;
    if (!str) continue;

    const start = spaced.length;
    spaced += str;
    offsets.push({ start, end: spaced.length, item: i });

    // Always separate items. This restores the word breaks the PDF's layout
    // implies but its text stream omits; the tight index below covers the
    // opposite case, where a word was split mid-way for kerning.
    spaced += ' ';
  }

  const normSpaced = normalize(spaced);
  const normTight = normalize(spaced).replace(TIGHT_STRIP, '');

  index.set(pageNum, {
    spaced: normSpaced,
    tight: normTight,
    raw: spaced,
    offsets,
  });
}

/**
 * Indexes the whole document in idle slices.
 * @param {number} total
 * @param {(done:number, total:number)=>void} statusCb
 */
export function build(total, statusCb, doneCb) {
  pageCount = total;
  onStatus = statusCb;
  onDone = doneCb;
  if (building || built) return;
  building = true;

  // A plain requestIdleCallback is starved while pages are rendering, which on a
  // long document left searches returning partial results for many seconds. The
  // timeout makes the browser run each chunk even when it is busy.
  const idle = window.requestIdleCallback
    ? (fn) => window.requestIdleCallback(fn, { timeout: 150 })
    : (fn) => setTimeout(() => fn({ timeRemaining: () => 8 }), 16);

  let next = 1;

  const step = async () => {
    const end = Math.min(next + CHUNK_SIZE - 1, pageCount);
    for (let p = next; p <= end; p++) {
      try {
        await indexPage(p);
      } catch {
        // A page we can't read simply won't be searchable.
      }
    }
    next = end + 1;

    if (onStatus) onStatus(index.size, pageCount);

    if (next <= pageCount) {
      idle(step);
    } else {
      building = false;
      built = true;
      if (onStatus) onStatus(pageCount, pageCount);
      // Lets the UI re-run whatever the reader already typed, so a search made
      // while indexing corrects itself instead of standing as a wrong answer.
      if (onDone) onDone();
    }
  };

  idle(step);
}

export function isReady() {
  return built;
}

export function indexedCount() {
  return index.size;
}

/**
 * Searches the index.
 * @param {string} rawQuery
 * @returns {Array<{page:number, snippet:string, items:number[]}>}
 */
export function query(rawQuery) {
  const q = collapse(normalize(rawQuery));
  if (q.length < 2) return [];

  const qTight = q.replace(TIGHT_STRIP, '');
  const results = [];

  // Sorted so results read in page order.
  const pages = [...index.keys()].sort((a, b) => a - b);

  for (const pageNum of pages) {
    const entry = index.get(pageNum);

    // Try the spaced form first: its offsets map cleanly to snippets and items.
    let at = entry.spaced.indexOf(q);
    let matchLength = q.length;
    let source = 'spaced';

    if (at === -1) {
      // Fall back to the space-free form, which catches phrases broken across
      // a line where the PDF dropped the space.
      const tightAt = entry.tight.indexOf(qTight);
      if (tightAt === -1) continue;
      at = mapTightToSpaced(entry.spaced, tightAt);
      matchLength = qTight.length;
      source = 'tight';
    }

    results.push({
      page: pageNum,
      snippet: buildSnippet(entry.raw, at, matchLength, source),
      items: itemsForRange(entry, at, matchLength),
    });

    if (results.length >= MAX_RESULTS) break;
  }

  return results;
}

/**
 * Converts an offset in the space-stripped string back to the equivalent
 * offset in the spaced string, by counting non-space characters.
 */
function mapTightToSpaced(spaced, tightOffset) {
  // Must skip exactly the characters TIGHT_STRIP removed, or the offset drifts
  // and the wrong text items get highlighted.
  const skip = /[\s­‐-―-]/;
  let seen = 0;
  for (let i = 0; i < spaced.length; i++) {
    if (!skip.test(spaced[i])) {
      if (seen === tightOffset) return i;
      seen++;
    }
  }
  return 0;
}

/** A readable excerpt around the match, with the match wrapped in <mark>. */
function buildSnippet(raw, at, length, source) {
  const from = Math.max(at - SNIPPET_RADIUS, 0);
  const to = Math.min(at + length + SNIPPET_RADIUS, raw.length);

  const before = raw.slice(from, at);
  // In tight mode the match may span dropped spaces, so widen a little to be
  // sure the highlighted run actually covers the matched words.
  const matchEnd = source === 'tight' ? Math.min(at + length + 8, raw.length) : at + length;
  const match = raw.slice(at, matchEnd);
  const after = raw.slice(matchEnd, to);

  const prefix = from > 0 ? '…' : '';
  const suffix = to < raw.length ? '…' : '';

  return (
    prefix +
    escapeHtml(collapse(before)) +
    ' <mark>' +
    escapeHtml(collapse(match)) +
    '</mark> ' +
    escapeHtml(collapse(after)) +
    suffix
  );
}

/** Which text items overlap the matched character range. */
function itemsForRange(entry, at, length) {
  const end = at + length;
  const items = [];
  for (const o of entry.offsets) {
    if (o.end > at && o.start < end) items.push(o.item);
  }
  return items;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
