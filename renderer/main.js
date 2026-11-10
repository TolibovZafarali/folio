import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import worker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import './style.css';
import { wireUpdates } from './updates.js';

GlobalWorkerOptions.workerSrc = worker;
const api = window.desktopReader;
const $ = id => document.getElementById(id);
const assets = new URL('./pdfjs/', location.href).href;
let library = { books: [], activeBookId: null, alwaysOnTop: false };
let book, pdf, loadingTask, renderingTask;
let pageNumber = 1, zoom = 1, mode = 'text', generation = 0, revision = 0;
let busy = false;
let renderedWidth = 0;

function notify(message) { $('notice-text').textContent = message; $('notice').hidden = false; }
$('dismiss-notice').onclick = () => { $('notice').hidden = true; };
function setShelf(open) {
  const changed = $('shelf').hidden === open;
  $('shelf').hidden = !open;
  $('shelf-toggle').setAttribute('aria-expanded', String(open));
  $('shelf-toggle').setAttribute('aria-label', open ? 'Hide bookshelf' : 'Show bookshelf');
  if (!open) $('shelf-toggle').focus();
  if (changed) resize();
}
$('shelf-toggle').onclick = () => setShelf($('shelf').hidden);
$('close-shelf').onclick = () => setShelf(false);
function drawShelf() {
  $('books').replaceChildren();
  $('empty-shelf').hidden = library.books.length > 0;
  for (const entry of [...library.books].sort((a, b) => b.lastOpened - a.lastOpened)) {
    const item = document.createElement('div'); item.className = 'book-entry';
    const button = document.createElement('button'); button.className = 'book-open';
    button.setAttribute('aria-current', String(book?.id === entry.id));
    const title = document.createElement('span'); title.className = 'book-title'; title.textContent = entry.title;
    const status = document.createElement('span'); status.className = 'book-status';
    status.textContent = entry.totalPages ? `Page ${entry.page} of ${entry.totalPages}` : 'Ready to read';
    const progress = document.createElement('progress'); progress.className = 'book-progress'; progress.max = 100;
    progress.value = entry.totalPages ? entry.page / entry.totalPages * 100 : 0;
    progress.setAttribute('aria-label', `${entry.title} progress`);
    button.append(title, status, progress); item.append(button); $('books').append(item);
    button.onclick = () => { if (innerWidth < 640) setShelf(false); openBook(entry); };
  }
}
function setBusy(value) {
  busy = value;
  $('reader').setAttribute('aria-busy', String(value));
  for (const id of ['page', 'pdf-view', 'text-view', 'zoom-reset']) $(id).disabled = value || !pdf;
  $('previous').disabled = value || !pdf || pageNumber <= 1;
  $('next').disabled = value || !pdf || pageNumber >= pdf.numPages;
  $('zoom-out').disabled = value || !pdf || zoom <= 0.7;
  $('zoom-in').disabled = value || !pdf || zoom >= 2;
  $('remove').disabled = !book;
}
function applyMode() {
  $('text-page').hidden = mode !== 'text'; $('pdf-page').hidden = mode !== 'pdf';
  $('text-view').setAttribute('aria-pressed', String(mode === 'text'));
  $('pdf-view').setAttribute('aria-pressed', String(mode === 'pdf'));
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
  } catch (error) { notify(`Couldn’t import the PDF: ${error.message}`); }
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
  $('book-title').textContent = entry.title;
  $('book-subtitle').textContent = 'Saved on this computer';
  $('page').value = pageNumber; $('total').textContent = '/ —';
  $('zoom-reset').textContent = '100%';
  $('loading').textContent = 'Opening your PDF…'; $('loading').hidden = false;
  $('pdf-page').hidden = $('text-page').hidden = $('retry').hidden = true;
  $('save-status').textContent = 'Opening document…'; $('progress').value = 0; $('percentage').textContent = '—';
  drawShelf(); setBusy(true);
  try {
    const bytes = await api.readBook(entry.id);
    if (token !== generation) return;
    loadingTask = getDocument({ data: new Uint8Array(bytes), cMapUrl: `${assets}cmaps/`, cMapPacked: true, standardFontDataUrl: `${assets}standard_fonts/`, wasmUrl: `${assets}wasm/`, isEvalSupported: false });
    const loaded = await loadingTask.promise;
    if (token !== generation) return;
    pdf = loaded; pageNumber = Math.min(pageNumber, pdf.numPages);
    $('total').textContent = `/ ${pdf.numPages}`; $('page').max = pdf.numPages;
    await renderPage(pageNumber);
  } catch (error) {
    if (token !== generation) return;
    console.error('Unable to open PDF:', error);
    $('loading').textContent = error.name === 'PasswordException' ? 'This PDF is password-protected. Open an unprotected copy to read it here.' : 'This PDF could not be opened. It may be damaged or unavailable.';
    $('loading').hidden = false; $('retry').hidden = false;
    $('save-status').textContent = 'Couldn’t open PDF'; setBusy(false);
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
    const width = Math.max(240, Math.min(900, viewportWidth - 32));
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
$('previous').onclick = () => renderPage(Math.max(1, pageNumber - 1));
$('next').onclick = () => renderPage(Math.min(pdf.numPages, pageNumber + 1));
function jump() {
  if (!pdf || busy) return;
  const value = Number($('page').value);
  if (Number.isInteger(value) && value >= 1 && value <= pdf.numPages) renderPage(value);
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
      drawShelf();
      const next = state.books.find(entry => entry.id === state.activeBookId);
      if (next) await openBook(next);
    }
  } catch { notify('Couldn’t remove the book. Please try again.'); }
};
window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('shelf').hidden) setShelf(false);
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') { event.preventDefault(); if (!$('import').disabled) importBooks(); return; }
  if (/^(INPUT|TEXTAREA)$/.test(event.target.tagName) || event.ctrlKey || event.metaKey || event.altKey || !pdf || busy) return;
  if (event.key === 'ArrowRight' && !$('next').disabled) { event.preventDefault(); $('next').click(); }
  if (event.key === 'ArrowLeft' && !$('previous').disabled) { event.preventDefault(); $('previous').click(); }
});
let timer;
function resize() {
  clearTimeout(timer);
  timer = setTimeout(() => {
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
