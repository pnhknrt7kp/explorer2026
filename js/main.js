/*
 * main.js — bootstrap and wiring.
 *
 * Loads the PDF, starts the flipbook, and connects the toolbar, panel, search,
 * zoom, keyboard and URL state. Also owns the failure messages: a reader who
 * hits a problem should always be told what happened in plain words and offered
 * the PDF directly rather than left looking at a blank stage.
 */

import * as pdfSource from './pdf-source.js';
import * as flipbook from './flipbook.js';
import * as thumbnails from './thumbnails.js';
import * as zoom from './zoom.js';
import * as search from './search.js';
import { highlightItems, clearHighlights } from './text-layer.js';

const DEFAULTS = {
  title: 'The Explorer',
  pdfPath: 'assets/document.pdf',
  downloadUrl: '',
  maxRenderScale: 2,
};

const config = Object.assign({}, DEFAULTS, window.FLIPBOOK_CONFIG || {});

const el = (id) => document.getElementById(id);

const ui = {
  toolbar: el('toolbar'),
  title: el('doc-title'),
  stage: el('stage'),
  bookWrap: el('book-wrap'),
  book: el('book'),
  pager: el('pager'),
  pageInput: el('page-input'),
  pageTotal: el('page-total'),
  prev: el('btn-prev'),
  next: el('btn-next'),
  panel: el('panel'),
  panelBtn: el('btn-panel'),
  panelClose: el('panel-close'),
  scrim: el('scrim'),
  thumbs: el('thumbs'),
  contentsBtn: el('btn-contents'),
  searchBtn: el('btn-search'),
  searchDrawer: el('search-drawer'),
  searchForm: el('search-form'),
  searchInput: el('search-input'),
  searchClose: el('search-close'),
  searchStatus: el('search-status'),
  searchResults: el('search-results'),
  selectBtn: el('btn-select'),
  zoomBtn: el('btn-zoom'),
  download: el('btn-download'),
  fullscreenBtn: el('btn-fullscreen'),
  loading: el('loading'),
  loadingNote: el('loading-note'),
  progressFill: el('progress-fill'),
  error: el('error'),
  errorTitle: el('error-title'),
  errorMessage: el('error-message'),
  errorDownload: el('error-download'),
  live: el('live'),
};

let pageCount = 0;
let contentsPage = null;
/** The path actually being loaded, which ?pdf= can override. */
let activePdfPath = config.pdfPath;
let selecting = false;
let lastHighlight = null;

/* ---------------- error and loading states ---------------- */

function showError(title, message) {
  ui.loading.hidden = true;
  ui.error.hidden = false;
  ui.errorTitle.textContent = title;
  ui.errorMessage.textContent = message;

  // Without a document these controls do nothing, and offering them invites the
  // reader to click around a broken page. Download stays — it may still work.
  for (const btn of [ui.panelBtn, ui.searchBtn, ui.selectBtn, ui.zoomBtn, ui.contentsBtn]) {
    if (btn) btn.hidden = true;
  }
}

/** Turns a pdf.js failure into something a reader can act on. */
function describeFailure(err) {
  const name = err && err.name;
  const message = String((err && err.message) || err || '');

  if (location.protocol === 'file:') {
    return [
      'This page needs a web server',
      'The viewer was opened directly from a folder, and browsers block reading ' +
        'files that way for security. Publish the folder to a web server, or ' +
        'open it through a local one, and it will work.',
    ];
  }
  if (name === 'PasswordException') {
    return ['This PDF is password protected', 'The viewer cannot open an encrypted PDF. Remove the password and upload it again.'];
  }
  if (name === 'MissingPDFException' || /404/.test(message)) {
    return [
      'The magazine file is missing',
      `Nothing was found at "${activePdfPath}". Check the file is uploaded and that its name matches exactly.`,
    ];
  }
  if (name === 'InvalidPDFException') {
    return ['That file is not a readable PDF', 'The file was found but could not be read. It may be corrupt, or not a PDF at all. Try re-exporting it.'];
  }
  if (name === 'UnexpectedResponseException') {
    return ['The magazine could not be downloaded', 'The server refused the request for the PDF. If the file is on another domain, it must allow cross-origin requests.'];
  }
  return ['The magazine could not be opened', message || 'An unexpected error occurred while loading the PDF.'];
}

/* ---------------- cache busting ---------------- */

/**
 * Asks the server for the PDF's current ETag/Last-Modified and appends it as a
 * version token. Without this, a reader who visited before the file was
 * replaced keeps seeing the old edition from their browser cache — the most
 * likely complaint given a non-technical person publishes by overwriting.
 */
async function versionedUrl(path) {
  try {
    const res = await fetch(path, { method: 'HEAD', cache: 'no-store' });
    if (!res.ok) return path;

    const tag = res.headers.get('ETag') || res.headers.get('Last-Modified');
    if (!tag) return path;

    // Short, URL-safe token derived from the header.
    let hash = 0;
    for (let i = 0; i < tag.length; i++) {
      hash = (hash * 31 + tag.charCodeAt(i)) | 0;
    }
    const token = Math.abs(hash).toString(36);
    return `${path}${path.includes('?') ? '&' : '?'}v=${token}`;
  } catch {
    // HEAD unsupported or blocked — load the plain URL rather than fail.
    return path;
  }
}

/* ---------------- URL state ---------------- */

function pageFromUrl() {
  const params = new URLSearchParams(location.search);
  const fromQuery = parseInt(params.get('page'), 10);
  if (Number.isFinite(fromQuery)) return fromQuery;

  const hash = /page=(\d+)/.exec(location.hash || '');
  if (hash) return parseInt(hash[1], 10);

  return 1;
}

function writeUrl(page) {
  const params = new URLSearchParams(location.search);
  if (page > 1) params.set('page', String(page));
  else params.delete('page');

  const qs = params.toString();
  history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}`);
}

/* ---------------- page change ---------------- */

function onPageChange(page, total) {
  ui.pageInput.value = String(page);
  ui.pageTotal.textContent = `/ ${total}`;
  ui.prev.disabled = page <= 1;
  ui.next.disabled = page >= total;

  thumbnails.setCurrent(page);
  writeUrl(page);
  ui.live.textContent = `Page ${page} of ${total}`;

  // A highlight from a previous search result shouldn't follow the reader.
  if (lastHighlight && lastHighlight !== page) {
    const prevEl = flipbook.getPageElement(lastHighlight);
    if (prevEl) clearHighlights(prevEl.querySelector('.text-layer'));
    lastHighlight = null;
  }
}

/* ---------------- panel ---------------- */

let panelOpen = false;

function setPanel(open) {
  panelOpen = open;
  ui.panel.classList.toggle('open', open);
  // `inert` keeps the closed panel's thumbnails out of the tab order without
  // using `hidden`, which would kill the slide transition.
  if (open) ui.panel.removeAttribute('inert');
  else ui.panel.setAttribute('inert', '');

  ui.panelBtn.setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('panel-open', open);
  ui.scrim.hidden = !open;
  ui.scrim.classList.toggle('show', open);
  if (open) thumbnails.setCurrent(flipbook.getCurrentPage());
}

/* ---------------- search ---------------- */

function setSearch(open) {
  ui.searchDrawer.hidden = !open;
  ui.searchBtn.setAttribute('aria-expanded', String(open));
  if (open) {
    ui.searchInput.focus();
    ui.searchInput.select();
  }
  flipbook.handleResize();
}

function renderSearchStatus() {
  const done = search.indexedCount();
  if (search.isReady()) {
    ui.searchStatus.textContent = '';
    return;
  }
  ui.searchStatus.textContent = `Preparing search… ${done} of ${pageCount} pages ready`;
}

let searchTimer = null;

function runSearch() {
  const term = ui.searchInput.value.trim();
  ui.searchResults.textContent = '';

  if (term.length < 2) {
    renderSearchStatus();
    return;
  }

  const hits = search.query(term);

  if (!hits.length) {
    ui.searchStatus.textContent = search.isReady()
      ? `No matches for “${term}”.`
      : `No matches yet — still preparing search (${search.indexedCount()} of ${pageCount} pages).`;
    return;
  }

  ui.searchStatus.textContent = `${hits.length} page${hits.length === 1 ? '' : 's'} match “${term}”${
    search.isReady() ? '' : ' so far'
  }.`;

  const frag = document.createDocumentFragment();
  for (const hit of hits) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'search-hit';
    btn.innerHTML =
      `<span class="search-hit-page">Page ${hit.page}</span>` +
      `<span class="search-hit-snippet">${hit.snippet}</span>`;
    btn.addEventListener('click', () => goToHit(hit));
    li.appendChild(btn);
    frag.appendChild(li);
  }
  ui.searchResults.appendChild(frag);
}

async function goToHit(hit) {
  flipbook.goTo(hit.page);
  if (window.innerWidth < 900) setSearch(false);

  // The text layer for that page may not exist yet; give the render a moment.
  await new Promise((r) => setTimeout(r, 350));
  const pageEl = flipbook.getPageElement(hit.page);
  if (pageEl) {
    highlightItems(pageEl.querySelector('.text-layer'), hit.items);
    lastHighlight = hit.page;
  }
}

/* ---------------- fullscreen ---------------- */

function toggleFullscreen() {
  const doc = document;
  const root = doc.documentElement;

  if (doc.fullscreenElement || doc.webkitFullscreenElement) {
    (doc.exitFullscreen || doc.webkitExitFullscreen).call(doc);
    return;
  }

  const request = root.requestFullscreen || root.webkitRequestFullscreen;
  if (request) {
    request.call(root).catch(() => toggleImmersive());
  } else {
    // iPhone Safari has no Fullscreen API, so fall back to hiding the chrome.
    toggleImmersive();
  }
}

function toggleImmersive() {
  document.body.classList.toggle('immersive');
  flipbook.handleResize();
}

/* ---------------- text selection ---------------- */

function setSelecting(on) {
  selecting = on;
  ui.selectBtn.setAttribute('aria-pressed', String(on));
  flipbook.setSelecting(on);
  ui.live.textContent = on
    ? 'Text selection on. Use the arrows or page list to turn pages.'
    : 'Text selection off. Drag a page to turn it.';
}

/* ---------------- wiring ---------------- */

function wire() {
  ui.prev.addEventListener('click', () => flipbook.prev());
  ui.next.addEventListener('click', () => flipbook.next());

  ui.pageInput.addEventListener('focus', () => ui.pageInput.select());
  el('pager-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const wanted = parseInt(ui.pageInput.value, 10);
    if (Number.isFinite(wanted)) flipbook.goTo(wanted);
    else ui.pageInput.value = String(flipbook.getCurrentPage());
    ui.pageInput.blur();
  });

  ui.panelBtn.addEventListener('click', () => setPanel(!panelOpen));
  ui.panelClose.addEventListener('click', () => setPanel(false));
  ui.scrim.addEventListener('click', () => setPanel(false));

  ui.searchBtn.addEventListener('click', () => setSearch(ui.searchDrawer.hidden));
  ui.searchClose.addEventListener('click', () => setSearch(false));
  ui.searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    runSearch();
  });
  ui.searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 180);
  });

  ui.selectBtn.addEventListener('click', () => setSelecting(!selecting));
  ui.zoomBtn.addEventListener('click', () => zoom.open(flipbook.getCurrentPage()));
  ui.fullscreenBtn.addEventListener('click', toggleFullscreen);

  ui.contentsBtn.addEventListener('click', () => {
    if (contentsPage) flipbook.goTo(contentsPage);
  });

  // Double-tap or double-click a page to zoom into it.
  ui.book.addEventListener('dblclick', (event) => {
    if (selecting) return;
    const pageEl = event.target.closest('.page');
    const page = pageEl ? Number(pageEl.dataset.page) : flipbook.getCurrentPage();
    zoom.open(page);
  });

  let lastTap = 0;
  ui.book.addEventListener(
    'touchend',
    (event) => {
      if (selecting || event.touches.length) return;
      const now = Date.now();
      if (now - lastTap < 300) {
        const pageEl = event.target.closest('.page');
        const page = pageEl ? Number(pageEl.dataset.page) : flipbook.getCurrentPage();
        zoom.open(page);
        lastTap = 0;
      } else {
        lastTap = now;
      }
    },
    { passive: true },
  );

  document.addEventListener('keydown', (event) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName);

    if (event.key === 'Escape') {
      if (zoom.isOpen()) zoom.close();
      else if (!ui.searchDrawer.hidden) setSearch(false);
      else if (panelOpen) setPanel(false);
      else if (document.body.classList.contains('immersive')) toggleImmersive();
      return;
    }

    if (typing) return;

    if (event.key === '/') {
      event.preventDefault();
      setSearch(true);
      return;
    }
    if (zoom.isOpen()) return;

    switch (event.key) {
      case 'ArrowRight':
      case 'PageDown':
        event.preventDefault();
        flipbook.next();
        break;
      case 'ArrowLeft':
      case 'PageUp':
        event.preventDefault();
        flipbook.prev();
        break;
      case 'Home':
        event.preventDefault();
        flipbook.goTo(1);
        break;
      case 'End':
        event.preventDefault();
        flipbook.goTo(pageCount);
        break;
      case 'f':
      case 'F':
        toggleFullscreen();
        break;
      default:
        break;
    }
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      flipbook.handleResize();
      zoom.handleResize();
    }, 150);
  });

  window.addEventListener('popstate', () => flipbook.goTo(pageFromUrl()));
}

/* ---------------- boot ---------------- */

async function boot() {
  document.title = config.title;
  ui.title.textContent = config.title;

  // ?pdf= lets you preview another document without editing config.js.
  const override = new URLSearchParams(location.search).get('pdf');
  const pdfPath = override || config.pdfPath;
  activePdfPath = pdfPath;

  const downloadHref = config.downloadUrl || pdfPath;
  ui.download.href = downloadHref;
  ui.errorDownload.href = downloadHref;
  if (config.downloadUrl) {
    // An external link shouldn't carry a download attribute or replace the tab.
    ui.download.removeAttribute('download');
    ui.download.target = '_blank';
    ui.download.rel = 'noopener';
  }

  if (location.protocol === 'file:') {
    showError(...describeFailure({ name: 'FileProtocol' }));
    return;
  }

  zoom.init({
    root: el('zoom'),
    viewport: el('zoom-viewport'),
    surface: el('zoom-surface'),
    canvas: el('zoom-canvas'),
    text: el('zoom-text'),
    label: el('zoom-label'),
    hint: el('zoom-hint'),
    zoomIn: el('zoom-in'),
    zoomOut: el('zoom-out'),
    close: el('zoom-close'),
  });

  // Read the requested page before anything can rewrite the URL: starting the
  // flipbook reports page 1, which would strip the ?page= parameter first.
  const requestedPage = pageFromUrl();

  try {
    const url = await versionedUrl(pdfPath);

    await pdfSource.open(url, (loaded, total) => {
      if (total > 0) {
        const pct = Math.min(Math.round((loaded / total) * 100), 100);
        ui.progressFill.style.width = `${pct}%`;
        ui.loadingNote.textContent = `${pct}% of ${(total / 1048576).toFixed(1)} MB`;
      } else {
        ui.loadingNote.textContent = `${(loaded / 1048576).toFixed(1)} MB downloaded`;
      }
    });

    pageCount = pdfSource.getPageCount();
    const base = await pdfSource.getBaseViewport();

    await flipbook.init({
      container: ui.book,
      wrap: ui.bookWrap,
      config,
      startPage: requestedPage,
      onChange: onPageChange,
    });

    thumbnails.init({
      list: ui.thumbs,
      pageCount,
      ratio: base.ratio,
      onPick: (page) => {
        flipbook.goTo(page);
        if (window.innerWidth < 1100) setPanel(false);
      },
    });

    wire();

    ui.loading.hidden = true;
    ui.pager.hidden = false;

    // Everything below is enrichment — it must never block reading.
    //
    // Contents detection runs before the search index is started: it only needs
    // the opening pages, whereas indexing reads all of them, and on a large
    // document letting indexing go first leaves the toolbar button missing for
    // several seconds after the magazine is already readable.
    thumbnails
      .findContentsPage(pageCount)
      .then((page) => {
        if (page) {
          contentsPage = page;
          ui.contentsBtn.hidden = false;
        }
      })
      .finally(() => search.build(pageCount, renderSearchStatus));
  } catch (err) {
    console.error(err);
    showError(...describeFailure(err));
  }
}

boot();
