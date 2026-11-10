import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import worker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import './style.css';
import { wireUpdates } from './updates.js';
import { openEpub } from './epub.js';

GlobalWorkerOptions.workerSrc = worker;
const api = window.desktopReader;
const $ = id => document.getElementById(id);
const assets = new URL('./pdfjs/', location.href).href;
let library = { books: [], activeBookId: null, alwaysOnTop: false };
let book, pdf, epub, loadingTask, renderingTask;
const pageCount = () => epub?.numPages || pdf?.numPages || 0;
let pageNumber = 1, zoom = 1, mode = 'text', generation = 0, revision = 0;
let busy = false;
let renderedWidth = 0;
const fonts = {
  sans: "'Segoe UI', system-ui, sans-serif",
  serif: "Georgia, 'DejaVu Serif', serif",
  book: "'Palatino Linotype', Palatino, 'Book Antiqua', 'Bitstream Charter', serif",
  mono: "Consolas, 'DejaVu Sans Mono', monospace",
};
let readingFont = 'sans';
try {
  const savedFont = localStorage.getItem('folio.readingFont');
  if (Object.hasOwn(fonts, savedFont)) readingFont = savedFont;
} catch { /* Reading still works when preference storage is unavailable. */ }
function applyFont() {
  $('reading-font').value = readingFont;
  $('text-content').style.setProperty('--reading-font', fonts[readingFont]);
}
applyFont();
$('reading-font').onchange = () => {
  readingFont = $('reading-font').value;
  applyFont();
  if (epub) restoreChapterScroll(book.scrollProgress || 0);
  try { localStorage.setItem('folio.readingFont', readingFont); }
  catch { notify('This font will be used for this session, but could not be saved.'); }
};

function notify(message) { $('notice-text').textContent = message; $('notice').hidden = false; }
$('dismiss-notice').onclick = () => { $('notice').hidden = true; };
let shelfReturnFocus;
function setShelf(open) {
  if (open && $('shelf').hidden) shelfReturnFocus = document.activeElement;
  $('shelf').hidden = !open;
  $('shelf-backdrop').hidden = !open;
  $('main').inert = open;
  for (const id of ['shelf-toggle', 'welcome-shelf']) {
    $(id).setAttribute('aria-expanded', String(open));
    $(id).setAttribute('aria-label', open ? 'Hide bookshelf' : 'Show bookshelf');
  }
  if (open) { drawShelf(); $('close-shelf').focus({ preventScroll: true }); }
  else {
    const target = shelfReturnFocus?.isConnected && $('main').contains(shelfReturnFocus)
      ? shelfReturnFocus : book ? $(mode === 'text' ? 'text-page' : 'pdf-page') : $('welcome-shelf');
    target.focus({ preventScroll: true });
  }
}
$('shelf-toggle').onclick = $('welcome-shelf').onclick = () => setShelf($('shelf').hidden);
$('close-shelf').onclick = () => setShelf(false);
$('shelf-backdrop').onclick = () => setShelf(false);
function drawShelf() {
  $('books').replaceChildren();
  $('empty-shelf').hidden = library.books.length > 0;
  for (const entry of [...library.books].sort((a, b) => b.lastOpened - a.lastOpened)) {
    const item = document.createElement('div'); item.className = 'book-entry';
    const button = document.createElement('button'); button.className = 'book-open';
    button.setAttribute('aria-current', String(book?.id === entry.id));
    const title = document.createElement('span'); title.className = 'book-title'; title.textContent = entry.title;
    const status = document.createElement('span'); status.className = 'book-status';
    status.textContent = entry.totalPages ? `${entry.format === 'epub' ? 'Chapter' : 'Page'} ${entry.page} of ${entry.totalPages}` : 'Ready to read';
    const progress = document.createElement('progress'); progress.className = 'book-progress'; progress.max = 100;
    progress.value = entry.totalPages ? (entry.format === 'epub' ? entry.page - 1 + (entry.scrollProgress || 0) : entry.page) / entry.totalPages * 100 : 0;
    progress.setAttribute('aria-label', `${entry.title} progress`);
    button.append(title, status, progress); item.append(button); $('books').append(item);
    button.onclick = () => { setShelf(false); openBook(entry); };
  }
}
function setBusy(value) {
  busy = value;
  $('reader').setAttribute('aria-busy', String(value));
  for (const id of ['page', 'pdf-view', 'text-view', 'zoom-reset']) $(id).disabled = value || !pageCount();
  $('previous').disabled = value || !pageCount() || pageNumber <= 1;
  $('next').disabled = value || !pageCount() || pageNumber >= pageCount();
  $('zoom-out').disabled = value || !pageCount() || zoom <= 0.7;
  $('zoom-in').disabled = value || !pageCount() || zoom >= 2;
  $('remove').disabled = !book;
}
function applyMode() {
  if (epub) mode = 'text';
  $('text-page').hidden = mode !== 'text'; $('pdf-page').hidden = mode !== 'pdf';
  $('text-view').setAttribute('aria-pressed', String(mode === 'text'));
  $('pdf-view').setAttribute('aria-pressed', String(mode === 'pdf'));
  $('reading-font').disabled = mode !== 'text';
  $('font-hint').textContent = mode === 'text' ? 'Choose a font for Text view.' : 'Switch to Text view to change the font.';
  $('text-content').style.fontSize = `${15 * zoom}px`;
}
for (const [id, value] of [['text-view', 'text'], ['pdf-view', 'pdf']]) {
  $(id).onclick = () => { mode = value; applyMode(); $('viewport').scrollTo(0, 0); };
}
async function importBooks() {
  $('import').disabled = $('welcome-import').disabled = true;
  try {
    const result = await api.importBooks();
    library = result.library; drawShelf();
    if (result.errors.length) notify(result.errors.join('\n'));
    if (result.importedIds.length) {
      setShelf(false);
      await openBook(library.books.find(entry => entry.id === result.importedIds[0]));
    }
  } catch (error) { notify(`Couldn’t import the book: ${error.message}`); }
  finally { $('import').disabled = $('welcome-import').disabled = false; }
}
$('import').onclick = $('welcome-import').onclick = importBooks;
$('pin').onclick = async () => {
  $('pin').disabled = true;
  try {
    library.alwaysOnTop = await api.setAlwaysOnTop(!library.alwaysOnTop);
    updatePin();
  } catch { notify('Couldn’t change the window setting. Try again.'); }
  finally { $('pin').disabled = false; }
};
function updatePin() {
  $('pin').setAttribute('aria-pressed', String(library.alwaysOnTop));
  $('pin').title = library.alwaysOnTop ? 'Always on top is on' : 'Keep on top';
}
async function stopDocument() {
  const token = ++generation; ++revision;
  renderingTask?.cancel();
  await progressRequest;
  epub?.dispose(); epub = null;
  const oldTask = loadingTask; loadingTask = null; pdf = null;
  await oldTask?.destroy().catch(() => {});
  return token;
}
async function openBook(entry) {
  if (!entry) return;
  const token = await stopDocument();
  if (token !== generation) return;
  book = entry; pageNumber = entry.page || 1; zoom = 1;
  $('welcome').hidden = true; $('reader').hidden = false;
  $('reading-settings').hidden = false;
  $('book-title').textContent = entry.title;
  const isEpub = entry.format === 'epub';
  $('book-subtitle').textContent = `${isEpub ? 'EPUB' : 'PDF'} · Saved on this computer`;
  $('view-settings').hidden = isEpub;
  $('page-label').textContent = isEpub ? 'Chapter' : 'Page';
  $('page').setAttribute('aria-label', isEpub ? 'Chapter' : 'Page');
  $('previous').setAttribute('aria-label', isEpub ? 'Previous chapter' : 'Previous page');
  $('next').setAttribute('aria-label', isEpub ? 'Next chapter' : 'Next page');
  $('next-label').textContent = isEpub ? 'Next chapter' : 'Next page';
  $('text-content').classList.toggle('epub-content', isEpub);
  $('page').value = pageNumber; $('total').textContent = '/ —';
  $('zoom-reset').textContent = '100%';
  $('loading').textContent = 'Opening your book…'; $('loading').hidden = false;
  $('pdf-page').hidden = $('text-page').hidden = $('retry').hidden = true;
  $('save-status').textContent = 'Opening document…'; $('progress').value = 0; $('percentage').textContent = '—';
  drawShelf(); setBusy(true);
  try {
    const bytes = await api.readBook(entry.id);
    if (token !== generation) return;
    if (isEpub) {
      epub = openEpub(bytes); mode = 'text';
      pageNumber = Math.min(pageNumber, epub.numPages);
      $('total').textContent = `/ ${epub.numPages}`; $('page').max = epub.numPages;
      await renderEpubPage(pageNumber, entry.scrollProgress || 0);
      return;
    }
    loadingTask = getDocument({ data: new Uint8Array(bytes), cMapUrl: `${assets}cmaps/`, cMapPacked: true, standardFontDataUrl: `${assets}standard_fonts/`, wasmUrl: `${assets}wasm/`, isEvalSupported: false });
    const loaded = await loadingTask.promise;
    if (token !== generation) return;
    pdf = loaded; pageNumber = Math.min(pageNumber, pdf.numPages);
    $('total').textContent = `/ ${pdf.numPages}`; $('page').max = pdf.numPages;
    await renderPage(pageNumber);
  } catch (error) {
    if (token !== generation) return;
    console.error('Unable to open book:', error);
    $('loading').textContent = isEpub ? error.message : error.name === 'PasswordException' ? 'This PDF is password-protected. Open an unprotected copy to read it here.' : 'This PDF could not be opened. It may be damaged or unavailable.';
    $('loading').hidden = false; $('retry').hidden = false;
    $('save-status').textContent = 'Couldn’t open book'; setBusy(false);
  }
}
function restoreChapterScroll(fraction) {
  const viewport = $('viewport');
  viewport.scrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight) * fraction;
}
let progressRequest = null, pendingProgress = null;
function saveEpubPosition() {
  if (!epub || busy || !book) return;
  const viewport = $('viewport');
  const height = viewport.scrollHeight - viewport.clientHeight;
  book.scrollProgress = height > 0 ? Math.max(0, Math.min(1, viewport.scrollTop / height)) : 0;
  const percentage = Math.round((pageNumber - 1 + book.scrollProgress) / epub.numPages * 100);
  $('percentage').textContent = `${percentage}%`; $('progress').value = percentage;
  pendingProgress = { id: book.id, page: pageNumber, totalPages: epub.numPages, scrollProgress: book.scrollProgress };
  if (progressRequest) return;
  $('save-status').textContent = 'Saving your place…';
  progressRequest = (async () => {
    try {
      while (pendingProgress) {
        const progress = pendingProgress; pendingProgress = null;
        await api.saveProgress(progress);
      }
      $('save-status').textContent = 'Your place is saved';
    } catch {
      pendingProgress = null;
      $('save-status').textContent = 'Position not saved';
      notify('Your place could not be saved. Check that your app data folder is writable.');
    } finally { progressRequest = null; }
  })();
}
$('viewport').addEventListener('scroll', saveEpubPosition, { passive: true });
async function renderEpubPage(number, fraction = 0, fragment = '') {
  const token = generation, run = ++revision, document = epub;
  let rendered = false;
  setBusy(true);
  await progressRequest;
  if (token !== generation || run !== revision) return;
  $('loading').textContent = 'Opening chapter…'; $('loading').hidden = false;
  $('pdf-page').hidden = $('text-page').hidden = true;
  try {
    const chapter = document.chapter(number, (target, anchor) => renderEpubPage(target, 0, anchor));
    $('text-content').replaceChildren(chapter.content);
    $('text-content').dir = chapter.direction;
    $('loading').hidden = $('retry').hidden = true;
    pageNumber = number; $('page').value = number;
    $('text-page').dataset.page = number;
    $('page-caption').textContent = `CHAPTER ${number} OF ${document.numPages}`;
    $('zoom-reset').textContent = `${Math.round(zoom * 100)}%`;
    applyMode();
    await Promise.all(chapter.images.map(img => img.decode().catch(() => {})));
    if (token !== generation || run !== revision) return;
    restoreChapterScroll(fraction);
    if (fragment) chapter.anchors.get(fragment)?.scrollIntoView({ block: 'start' });
    const percentage = Math.round(number / document.numPages * 100);
    $('percentage').textContent = `${percentage}%`; $('progress').value = percentage;
    const saved = await api.saveProgress({ id: book.id, page: number, totalPages: document.numPages, scrollProgress: fraction });
    if (token !== generation || run !== revision) return;
    library = saved; book = saved.books.find(entry => entry.id === book.id); drawShelf();
    $('save-status').textContent = 'Your place is saved';
    rendered = true;
  } catch (error) {
    if (token !== generation || run !== revision) return;
    $('text-page').hidden = true;
    $('loading').textContent = error.message || 'This chapter could not be opened.';
    $('loading').hidden = false; $('retry').hidden = false;
  } finally {
    if (token === generation && run === revision) { setBusy(false); if (rendered) saveEpubPosition(); }
  }
}
function textParagraphs(items) {
  const lines = [];
  let line;
  for (const item of items) {
    if (typeof item.str !== 'string' || !item.str.trim()) continue;
    const y = item.transform[5], height = Math.abs(item.height || item.transform[3]) || 12;
    if (!line || Math.abs(line.y - y) > Math.max(2, height / 4)) { line = { text: item.str, y, height }; lines.push(line); }
    else line.text += `${/\s$/.test(line.text) || /^\s/.test(item.str) ? '' : ' '}${item.str}`;
    if (item.hasEOL) line = null;
  }
  const gaps = lines.slice(1).map((value, i) => Math.abs(lines[i].y - value.y)).filter(gap => gap > 2).sort((a, b) => a - b);
  const leading = gaps[Math.floor(gaps.length / 2)] || 16;
  const paragraphs = [];
  for (const [i, value] of lines.entries()) {
    const previous = lines[i - 1];
    if (!previous || Math.abs(previous.y - value.y) > leading * 1.35 || Math.abs(previous.height - value.height) > 2) paragraphs.push(value.text.trim());
    else paragraphs[paragraphs.length - 1] += ` ${value.text.trim()}`;
  }
  return paragraphs;
}
async function renderPage(number, resetScroll = true) {
  if (epub) return renderEpubPage(number, resetScroll ? 0 : book.scrollProgress || 0);
  if (!pdf) return;
  const token = generation, run = ++revision;
  renderingTask?.cancel(); setBusy(true);
  $('loading').textContent = 'Preparing page…'; $('loading').hidden = false;
  $('pdf-page').hidden = $('text-page').hidden = true;
  try {
    const page = await pdf.getPage(number);
    if (token !== generation || run !== revision) return;
    const raw = page.getViewport({ scale: 1 });
    const viewportWidth = $('viewport').clientWidth;
    const width = Math.max(240, Math.min(900, viewportWidth));
    const viewport = page.getViewport({ scale: width / raw.width * zoom });
    const ratio = Math.min(devicePixelRatio || 1, 2);
    $('canvas').width = Math.round(viewport.width * ratio); $('canvas').height = Math.round(viewport.height * ratio);
    $('canvas').style.width = `${viewport.width}px`; $('canvas').style.height = `${viewport.height}px`;
    $('pdf-page').style.width = `${viewport.width}px`;
    renderingTask = page.render({ canvasContext: $('canvas').getContext('2d'), viewport, transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0] });
    await renderingTask.promise;
    if (token !== generation || run !== revision) return;
    // A text extraction failure should not make a readable PDF page unavailable.
    let paragraphs = [];
    try { paragraphs = textParagraphs((await page.getTextContent()).items); } catch { /* Use PDF view. */ }
    if (token !== generation || run !== revision) return;
    $('text-content').replaceChildren(...paragraphs.map(text => { const p = document.createElement('p'); p.textContent = text; p.dir = 'auto'; return p; }));
    if (!paragraphs.length) {
      const p = document.createElement('p'); p.textContent = 'This page has no selectable text. Use PDF view to see the original page.';
      const button = document.createElement('button'); button.className = 'primary'; button.textContent = 'Show PDF'; button.onclick = () => { mode = 'pdf'; applyMode(); };
      $('text-content').append(p, button);
      mode = 'pdf';
    }
    renderedWidth = viewportWidth;
    pageNumber = number; $('page').value = number;
    $('text-page').dataset.page = $('canvas').dataset.page = number;
    $('page-caption').textContent = `PAGE ${number} OF ${pdf.numPages}`;
    $('zoom-reset').textContent = `${Math.round(zoom * 100)}%`;
    $('loading').hidden = $('retry').hidden = true; applyMode();
    const percentage = Math.round(number / pdf.numPages * 100);
    $('percentage').textContent = `${percentage}%`; $('progress').value = percentage;
    if (resetScroll) $('viewport').scrollTo(0, 0);
    $('save-status').textContent = 'Saving your place…';
    try {
      const saved = await api.saveProgress({ id: book.id, page: number, totalPages: pdf.numPages });
      if (token !== generation || run !== revision) return;
      library = saved; book = saved.books.find(entry => entry.id === book.id); drawShelf();
      $('save-status').textContent = 'Your place is saved';
    } catch { if (token === generation) { $('save-status').textContent = 'Position not saved'; notify('Your place could not be saved. Check that your app data folder is writable.'); } }
  } catch (error) {
    if (token !== generation || run !== revision || error.name === 'RenderingCancelledException') return;
    console.error('Unable to render PDF page:', error);
    $('loading').textContent = 'This page couldn’t be displayed. Try another page or reopen the book.';
    $('loading').hidden = false; $('retry').hidden = false;
    $('page').value = pageNumber;
  } finally { if (token === generation && run === revision) setBusy(false); }
}
async function turnPage(number) {
  await renderPage(number);
  // Start the new page at the top, including for keyboard and screen reader users.
  if (!busy) $(mode === 'text' ? 'text-page' : 'pdf-page').focus({ preventScroll: true });
}
$('previous').onclick = () => turnPage(Math.max(1, pageNumber - 1));
$('next').onclick = () => turnPage(Math.min(pageCount(), pageNumber + 1));
function jump() {
  if (!pageCount() || busy) return;
  const value = Number($('page').value);
  if (Number.isInteger(value) && value >= 1 && value <= pageCount()) renderPage(value);
  else $('page').value = pageNumber;
}
$('page').onchange = jump;
$('page').onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); jump(); } };
for (const [id, amount] of [['zoom-in', 0.15], ['zoom-out', -0.15], ['zoom-reset', 0]]) {
  $(id).onclick = () => { zoom = amount ? Math.max(0.7, Math.min(2, Math.round((zoom + amount) * 100) / 100)) : 1; renderPage(pageNumber, false); };
}
$('retry').onclick = () => openBook(book);
$('remove').onclick = async () => {
  if (!book) return;
  const id = book.id;
  try {
    const state = await api.removeBook(id);
    library = state;
    if (!state.books.some(entry => entry.id === id)) {
      await stopDocument(); book = null;
      $('reader').hidden = true; $('welcome').hidden = false;
      $('reading-settings').hidden = true;
      drawShelf();
      const next = state.books.find(entry => entry.id === state.activeBookId);
      if (next) await openBook(next);
    }
  } catch { notify('Couldn’t remove the book. Please try again.'); }
};
window.addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); setShelf($('shelf').hidden); return; }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') { event.preventDefault(); if (!$('import').disabled) importBooks(); return; }
  if (!$('shelf').hidden || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.ctrlKey || event.metaKey || event.altKey || !pageCount() || busy) return;
  if (event.key === 'ArrowRight' && !$('next').disabled) { event.preventDefault(); $('next').click(); }
  if (event.key === 'ArrowLeft' && !$('previous').disabled) { event.preventDefault(); $('previous').click(); }
});
let timer;
function resize() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (epub) { restoreChapterScroll(book.scrollProgress || 0); return; }
    if (pdf && document.activeElement !== $('page') && $('viewport').clientWidth !== renderedWidth) renderPage(pageNumber, false);
  }, 180);
}
$('page').addEventListener('blur', resize);
window.addEventListener('resize', resize);
async function init() {
  if (!api) { notify('Open Folio Reader from the desktop application.'); return; }
  wireUpdates(api);
  try {
    library = await api.getLibrary(); updatePin(); drawShelf();
    const entry = library.books.find(item => item.id === library.activeBookId);
    if (entry) await openBook(entry);
  } catch { notify('Your library could not be loaded. Please restart the app.'); }
}
init();
