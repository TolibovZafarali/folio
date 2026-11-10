const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const MAX_PDF_BYTES = 200 * 1024 * 1024;
const MAX_PAGES = 1_000_000;
const BOOK_ID = /^[a-f0-9]{64}$/;
const emptyState = () => ({ version: 1, books: [], activeBookId: null, alwaysOnTop: false, windowBounds: null });
const clone = value => JSON.parse(JSON.stringify(value));

function validateState(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.books)) throw new Error('Invalid library format');
  const state = emptyState();
  const ids = new Set();
  for (const book of value.books) {
    if (!book || !BOOK_ID.test(book.id) || ids.has(book.id) || typeof book.title !== 'string' || !book.title.trim() || typeof book.filename !== 'string' || path.basename(book.filename) !== book.filename || !Number.isInteger(book.page) || book.page < 1 || !Number.isInteger(book.totalPages) || book.totalPages < 0 || book.totalPages > MAX_PAGES || (book.totalPages && book.page > book.totalPages) || (!book.totalPages && book.page !== 1)) {
      throw new Error('Invalid book record');
    }
    ids.add(book.id);
    state.books.push({ id: book.id, title: book.title.slice(0, 300), filename: book.filename, page: book.page, totalPages: book.totalPages, lastOpened: Number.isFinite(book.lastOpened) && book.lastOpened >= 0 ? book.lastOpened : 0 });
  }
  state.activeBookId = ids.has(value.activeBookId) ? value.activeBookId : null;
  state.alwaysOnTop = value.alwaysOnTop === true;
  const bounds = value.windowBounds;
  if (bounds && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(bounds[key]))) {
    state.windowBounds = Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Math.round(bounds[key])]));
  }
  return state;
}

class LibraryStore {
  constructor(directory) {
    this.directory = directory;
    this.booksDirectory = path.join(directory, 'books');
    this.filename = path.join(directory, 'library.json');
    this.state = emptyState();
    this.pending = Promise.resolve();
  }

  static async open(directory) {
    const store = new LibraryStore(directory);
    await fs.mkdir(store.booksDirectory, { recursive: true });
    let contents;
    try { contents = await fs.readFile(store.filename, 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (contents !== undefined) {
      try { store.state = validateState(JSON.parse(contents)); }
      catch {
        // Preserve the original metadata for recovery instead of replacing it silently.
        await fs.rename(store.filename, path.join(directory, `library.corrupt-${Date.now()}-${randomUUID()}.json`));
        store.recoveryNotice = 'The saved library index was damaged. Its original file and your PDFs have been preserved in the app data folder. Import your PDFs again to rebuild the shelf.';
        await store.persist(store.state);
      }
    }
    return store;
  }

  snapshot() {
    const { books, activeBookId, alwaysOnTop } = this.state;
    return clone({ books, activeBookId, alwaysOnTop });
  }

  getWindowBounds() { return clone(this.state.windowBounds); }

  async persist(state) {
    const temporary = path.join(this.directory, `.library-${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await fs.open(temporary, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(state, null, 2) + '\n', 'utf8');
      await handle.sync();
      await handle.close(); handle = null;
      await fs.rename(temporary, this.filename);
    } finally {
      await handle?.close();
      await fs.rm(temporary, { force: true });
    }
  }

  mutate(operation, afterCommit) {
    const run = async () => {
      const draft = clone(this.state);
      const result = await operation(draft);
      await this.persist(draft);
      this.state = draft;
      await afterCommit?.();
      return result;
    };
    const job = this.pending.then(run, run);
    this.pending = job.catch(() => {});
    return job;
  }

  async importBooks(filenames) {
    const importedIds = [], errors = [];
    for (const filename of filenames) {
      try {
        const stat = await fs.stat(filename);
        if (!stat.isFile() || stat.size > MAX_PDF_BYTES) throw new Error('Choose a PDF smaller than 200 MB.');
        const bytes = await fs.readFile(filename);
        if (bytes.length > MAX_PDF_BYTES || bytes.subarray(0, 1024).indexOf('%PDF-') < 0) throw new Error('This file does not appear to be a PDF.');
        const id = createHash('sha256').update(bytes).digest('hex');
        await this.mutate(async draft => {
          const target = path.join(this.booksDirectory, `${id}.pdf`);
          // A duplicate import can restore a missing copy without resetting progress.
          try { await fs.access(target); }
          catch (error) {
            if (error.code !== 'ENOENT') throw error;
            const temporary = path.join(this.booksDirectory, `.${randomUUID()}.tmp`);
            try { await fs.writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 }); await fs.rename(temporary, target); }
            finally { await fs.rm(temporary, { force: true }); }
          }
          if (!draft.books.some(book => book.id === id)) {
            const name = path.basename(filename);
            draft.books.push({ id, title: name.replace(/\.pdf$/i, '').slice(0, 300) || 'Untitled document', filename: name, page: 1, totalPages: 0, lastOpened: 0 });
          }
          if (!draft.activeBookId) draft.activeBookId = id;
        });
        if (!importedIds.includes(id)) importedIds.push(id);
      } catch (error) {
        errors.push(`${path.basename(filename)}: ${error.code ? 'The file could not be read or copied.' : error.message}`);
      }
    }
    return { library: this.snapshot(), importedIds, errors };
  }

  requireBook(id, state = this.state) {
    if (typeof id !== 'string' || !BOOK_ID.test(id)) throw new Error('Invalid book ID.');
    const book = state.books.find(item => item.id === id);
    if (!book) throw new Error('This book is no longer in the library.');
    return book;
  }

  async readBook(id) {
    this.requireBook(id);
    return new Uint8Array(await fs.readFile(path.join(this.booksDirectory, `${id}.pdf`)));
  }

  async saveProgress(progress) {
    if (!progress || !Number.isInteger(progress.page) || !Number.isInteger(progress.totalPages) || progress.totalPages < 1 || progress.totalPages > MAX_PAGES || progress.page < 1 || progress.page > progress.totalPages) throw new Error('Invalid page position.');
    await this.mutate(draft => {
      const book = this.requireBook(progress.id, draft);
      book.page = progress.page; book.totalPages = progress.totalPages; book.lastOpened = Date.now();
      draft.activeBookId = book.id;
    });
    return this.snapshot();
  }

  async removeBook(id) {
    await this.mutate(draft => {
      this.requireBook(id, draft);
      draft.books = draft.books.filter(book => book.id !== id);
      if (draft.activeBookId === id) draft.activeBookId = [...draft.books].sort((a, b) => b.lastOpened - a.lastOpened)[0]?.id || null;
    }, () => fs.rm(path.join(this.booksDirectory, `${id}.pdf`), { force: true }));
    // Cleanup stays inside the mutation queue, after the metadata commit, so a
    // simultaneous reimport cannot accidentally lose its newly restored file.
    return this.snapshot();
  }

  async setAlwaysOnTop(value) {
    if (typeof value !== 'boolean') throw new Error('Invalid window preference.');
    await this.mutate(draft => { draft.alwaysOnTop = value; });
    return value;
  }

  async setWindowBounds(bounds) {
    if (!bounds || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(bounds[key])) || bounds.width < 1 || bounds.height < 1) throw new Error('Invalid window size.');
    await this.mutate(draft => { draft.windowBounds = Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Math.round(bounds[key])])); });
  }

  async flush() { await this.pending; }
}

module.exports = { LibraryStore, MAX_PDF_BYTES };
