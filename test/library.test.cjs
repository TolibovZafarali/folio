const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { LibraryStore, MAX_PDF_BYTES } = require('../library.cjs');
const sourcePDF = path.join(__dirname, 'fixtures/orwellanimalfarm.pdf');

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'folio-library-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'Animal Farm.pdf');
  await fs.copyFile(sourcePDF, source);
  const data = path.join(directory, 'app-data');
  return { directory, source, data, store: await LibraryStore.open(data) };
}

test('imported books and their saved pages survive restart and removal of the original file', async t => {
  const { store, data, source } = await fixture(t);
  const result = await store.importBooks([source]);
  assert.deepEqual(result.errors, []);
  assert.equal(result.importedIds.length, 1);
  const id = result.importedIds[0];
  assert.equal(result.library.books[0].title, 'Animal Farm');
  assert.equal(result.library.books[0].page, 1);
  const original = await fs.readFile(source);
  await store.saveProgress({ id, page: 23, totalPages: 71 });
  await fs.unlink(source);
  const reopened = await LibraryStore.open(data);
  assert.equal(reopened.snapshot().activeBookId, id);
  assert.equal(reopened.snapshot().books[0].page, 23);
  assert.equal(reopened.snapshot().books[0].totalPages, 71);
  assert.deepEqual(Buffer.from(await reopened.readBook(id)), original);
});

test('duplicate imports retain progress and restore a missing imported copy', async t => {
  const { store, data, source, directory } = await fixture(t);
  const first = await store.importBooks([source]);
  const id = first.importedIds[0];
  await store.saveProgress({ id, page: 42, totalPages: 71 });
  const renamed = path.join(directory, 'Another name.pdf');
  await fs.copyFile(source, renamed);
  await fs.rm(path.join(data, 'books', `${id}.pdf`));
  const duplicate = await store.importBooks([renamed, source]);
  assert.deepEqual(duplicate.importedIds, [id]);
  assert.deepEqual(duplicate.errors, []);
  assert.equal(duplicate.library.books.length, 1);
  assert.equal(duplicate.library.books[0].page, 42);
  assert.equal(duplicate.library.books[0].title, 'Animal Farm');
  assert.match(Buffer.from(await store.readBook(id)).subarray(0, 5).toString(), /^%PDF-/);
});

test('invalid files fail individually while valid PDFs still import', async t => {
  const { store, directory, source } = await fixture(t);
  const invalid = path.join(directory, 'not-a-book.pdf');
  await fs.writeFile(invalid, 'An unrelated text document');
  const oversized = path.join(directory, 'too-large.pdf');
  const handle = await fs.open(oversized, 'w');
  await handle.truncate(MAX_PDF_BYTES + 1); await handle.close();
  const result = await store.importBooks([invalid, oversized, source]);
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0], /does not appear to be a PDF/);
  assert.match(result.errors[1], /smaller than 200 MB/);
  assert.equal(result.library.books.length, 1);
  assert.equal(result.importedIds.length, 1);
});

test('concurrent page, pin and window updates do not discard one another', async t => {
  const { store, data, source } = await fixture(t);
  const { importedIds: [id] } = await store.importBooks([source]);
  await Promise.all([
    store.saveProgress({ id, page: 8, totalPages: 71 }),
    store.setAlwaysOnTop(true),
    store.setWindowBounds({ x: 40, y: 80, width: 540, height: 600 }),
    store.saveProgress({ id, page: 9, totalPages: 71 }),
  ]);
  const reopened = await LibraryStore.open(data);
  assert.equal(reopened.snapshot().books[0].page, 9);
  assert.equal(reopened.snapshot().alwaysOnTop, true);
  assert.deepEqual(reopened.getWindowBounds(), { x: 40, y: 80, width: 540, height: 600 });
  assert(!(await fs.readdir(data)).some(name => name.endsWith('.tmp')));
});

test('invalid page and ID requests are rejected without damaging saved progress', async t => {
  const { store, source } = await fixture(t);
  const { importedIds: [id] } = await store.importBooks([source]);
  await store.saveProgress({ id, page: 5, totalPages: 71 });
  for (const page of [0, -1, 72, 1.5, NaN]) await assert.rejects(store.saveProgress({ id, page, totalPages: 71 }), /Invalid page position/);
  await assert.rejects(store.saveProgress({ id: '../outside', page: 1, totalPages: 71 }), /Invalid book ID/);
  await assert.rejects(store.readBook('../outside'), /Invalid book ID/);
  await assert.rejects(store.setAlwaysOnTop('yes'), /Invalid window preference/);
  assert.equal(store.snapshot().books[0].page, 5);
});

test('damaged indexes are preserved alongside PDFs before creating a recoverable empty shelf', async t => {
  const { store, data, source } = await fixture(t);
  const { importedIds: [id] } = await store.importBooks([source]);
  await fs.writeFile(path.join(data, 'library.json'), '{broken index');
  const recovered = await LibraryStore.open(data);
  assert.deepEqual(recovered.snapshot().books, []);
  assert.match(recovered.recoveryNotice, /preserved/);
  const backup = (await fs.readdir(data)).find(name => name.startsWith('library.corrupt-'));
  assert(backup);
  assert.equal(await fs.readFile(path.join(data, backup), 'utf8'), '{broken index');
  assert((await fs.stat(path.join(data, 'books', `${id}.pdf`))).isFile());
  const restored = await recovered.importBooks([source]);
  assert.deepEqual(restored.importedIds, [id]);
});

test('removing a book preserves the original and concurrent reimport keeps a readable copy', async t => {
  const { store, source } = await fixture(t);
  const { importedIds: [id] } = await store.importBooks([source]);
  await Promise.all([store.removeBook(id), store.importBooks([source])]);
  assert.equal(store.snapshot().books.length, 1);
  assert((await store.readBook(id)).length > 0);
  assert((await fs.stat(source)).isFile());
  await store.removeBook(id);
  assert.deepEqual(store.snapshot().books, []);
  assert.equal(store.snapshot().activeBookId, null);
  assert((await fs.stat(source)).isFile());
});

test('EPUB copies, duplicate imports and chapter positions coexist with legacy PDFs', async t => {
  const { store, data, source, directory } = await fixture(t);
  const { createEpub } = await import('./fixtures/epub-fixture.mjs');
  const epubFile = path.join(directory, 'Quiet Garden.epub');
  const bytes = createEpub();
  await fs.writeFile(epubFile, bytes);
  const result = await store.importBooks([source, epubFile]);
  assert.deepEqual(result.errors, []);
  const [pdfId, epubId] = result.importedIds;
  await store.saveProgress({ id: pdfId, page: 7, totalPages: 71 });
  await store.saveProgress({ id: epubId, page: 2, totalPages: 2, scrollProgress: .45 });
  await fs.rm(path.join(data, 'books', `${epubId}.epub`));
  const duplicate = await store.importBooks([epubFile]);
  assert.deepEqual(duplicate.errors, []);
  assert.equal(duplicate.library.books[1].scrollProgress, .45);
  // Existing PDF libraries predate format and EPUB scroll-position fields.
  const legacy = JSON.parse(await fs.readFile(path.join(data, 'library.json'), 'utf8'));
  delete legacy.books[0].format; delete legacy.books[0].scrollProgress;
  await fs.writeFile(path.join(data, 'library.json'), JSON.stringify(legacy));
  await fs.rm(epubFile);
  const reopened = await LibraryStore.open(data);
  assert.equal(reopened.snapshot().books[0].page, 7);
  assert.equal(reopened.snapshot().books[0].format, 'pdf');
  assert.equal(reopened.snapshot().books[1].page, 2);
  assert.equal(reopened.snapshot().books[1].scrollProgress, .45);
  assert.deepEqual(Buffer.from(await reopened.readBook(epubId)), Buffer.from(bytes));
  await assert.rejects(reopened.saveProgress({ id: epubId, page: 2, totalPages: 2, scrollProgress: 2 }), /Invalid reading position/);
  await reopened.removeBook(epubId);
  await assert.rejects(fs.access(path.join(data, 'books', `${epubId}.epub`)));
  assert.equal(reopened.snapshot().books[0].page, 7);
});

test('invalid EPUB archives do not displace imported books', async t => {
  const { store, directory, source } = await fixture(t);
  const invalid = path.join(directory, 'broken.epub');
  await fs.writeFile(invalid, 'not a ZIP');
  const { createEpub } = await import('./fixtures/epub-fixture.mjs');
  const disguised = path.join(directory, 'unrelated.epub');
  await fs.writeFile(disguised, createEpub({ mimetype: new TextEncoder().encode('application/zip') }));
  const result = await store.importBooks([invalid, disguised, source]);
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0], /damaged or unreadable/);
  assert.match(result.errors[1], /does not appear to be an EPUB/);
  assert.equal(result.library.books.length, 1);
});


test('oversized EPUB resources are rejected before decompression', async () => {
  const { createEpub } = await import('./fixtures/epub-fixture.mjs');
  const { readEpubArchive } = await import('../epub.mjs');
  const bytes = createEpub({ 'OPS/oversized.bin': new Uint8Array(32 * 1024 * 1024 + 1) });
  assert.throws(() => readEpubArchive(bytes), /too large to unpack/);
});
