import assert from 'node:assert/strict';
import { test } from 'node:test';
import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { load as loadYaml } from 'js-yaml';
import { _electron as electron } from 'playwright';

const require = createRequire(import.meta.url);
const { LibraryStore } = require('../library.cjs');
const desktop = fileURLToPath(new URL('../', import.meta.url));
const fixturePDF = fileURLToPath(new URL('./fixtures/orwellanimalfarm.pdf', import.meta.url));
const runFile = promisify(execFile);

async function exists(filename) {
  try { await access(filename); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

test('the installed Windows app keeps an existing portable library and enables its packaged updater', {
  skip: process.platform !== 'win32' && 'NSIS installation requires Windows',
  timeout: 300_000,
}, async () => {
  const metadata = JSON.parse(await readFile(path.join(desktop, 'package.json'), 'utf8'));
  const installer = path.join(desktop, 'release', `Folio-Reader-Setup-${metadata.version}-x64.exe`);
  await access(installer);
  assert(process.env.APPDATA && path.isAbsolute(process.env.APPDATA), 'Windows APPDATA must be available');
  const profile = path.join(process.env.APPDATA, 'Folio Reader');
  const directory = await mkdtemp(path.join(tmpdir(), 'folio-installed-test-'));
  const installation = path.join(directory, 'installed');
  const executable = path.join(installation, 'Folio Reader.exe');
  const uninstaller = path.join(installation, 'Uninstall Folio Reader.exe');
  const original = path.join(directory, 'Animal Farm.pdf');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  const processOptions = { env, timeout: 120_000, windowsHide: true, windowsVerbatimArguments: true };
  let profileCreated = false, profileSeeded = false, application, bookId, epubId, epubBytes;

  async function assertLibraryPreserved() {
    const saved = JSON.parse(await readFile(path.join(profile, 'library.json'), 'utf8'));
    assert.equal(saved.version, 1, 'the existing library format remains readable');
    assert.equal(saved.books.length, 2);
    const retainedEpub = saved.books.find(book => book.id === epubId);
    assert.equal(retainedEpub.page, 2);
    assert(Math.abs(retainedEpub.scrollProgress - .45) < .03);
    assert.deepEqual(await readFile(path.join(profile, 'books', `${epubId}.epub`)), epubBytes);
    assert.equal(saved.activeBookId, bookId);
    assert.equal(saved.books[0].id, bookId);
    assert.equal(saved.books[0].title, 'Animal Farm');
    assert.equal(saved.books[0].page, 7);
    assert.equal(saved.books[0].totalPages, 71);
    assert.equal(saved.alwaysOnTop, true);
    assert.equal(saved.windowBounds.width, 420);
    assert.equal(saved.windowBounds.height, 580);
    assert.deepEqual(await readFile(path.join(profile, 'books', `${bookId}.pdf`)), await readFile(fixturePDF));
  }

  try {
    // The installer must use the normal profile to prove portable-to-installed
    // continuity. Never overwrite or remove an existing user's profile.
    try { await mkdir(profile); }
    catch (error) {
      if (error.code === 'EEXIST') throw new Error('Refusing installed-app test: Folio Reader already has a profile. Run on a clean Windows runner.');
      throw error;
    }
    profileCreated = true;
    await copyFile(fixturePDF, original);
    const store = await LibraryStore.open(profile);
    const imported = await store.importBooks([original]);
    assert.deepEqual(imported.errors, []);
    assert.equal(imported.importedIds.length, 1);
    bookId = imported.importedIds[0];
    const { createEpub } = await import('./fixtures/epub-fixture.mjs');
    epubBytes = Buffer.from(createEpub());
    const existingEpub = path.join(directory, 'Existing EPUB.epub');
    await writeFile(existingEpub, epubBytes);
    const epubImport = await store.importBooks([existingEpub]);
    assert.deepEqual(epubImport.errors, []);
    epubId = epubImport.importedIds[0];
    await store.saveProgress({ id: epubId, page: 2, totalPages: 2, scrollProgress: .45 });
    await rm(existingEpub);
    await store.saveProgress({ id: bookId, page: 7, totalPages: 71 });
    await store.setAlwaysOnTop(true);
    await store.setWindowBounds({ x: 25, y: 30, width: 420, height: 580 });
    await store.flush();
    profileSeeded = true;
    await rm(original); // The installed app must read its stored copy.

    // NSIS requires /D= to be last and unquoted, even when the path has spaces.
    // runAfterFinish=false keeps the installer from launching a second process.
    await runFile(installer, ['/S', `/D=${installation}`], processOptions);
    await access(executable);
    await access(uninstaller);
    await assertLibraryPreserved();
    const updateConfig = loadYaml(await readFile(path.join(installation, 'resources', 'app-update.yml'), 'utf8'));
    const publication = metadata.build.publish.find(provider => provider.provider === 'github');
    assert(publication, 'package.json must configure the GitHub update provider');
    assert.equal(updateConfig.provider, publication.provider);
    assert.equal(updateConfig.owner, publication.owner);
    assert.equal(updateConfig.repo, publication.repo);
    assert.equal(updateConfig.tagNamePrefix, publication.tagNamePrefix);

    // Launch the installed executable directly. No wrapper or user-data-dir
    // override can hide mistakes in packaged profile selection or updater setup.
    application = await electron.launch({ executablePath: executable, cwd: installation, env, timeout: 30_000 });
    const runtime = await application.evaluate(({ app }) => ({
      packaged: app.isPackaged,
      version: app.getVersion(),
      userData: app.getPath('userData'),
      appPath: app.getAppPath(),
    }));
    assert.equal(runtime.packaged, true);
    assert.equal(runtime.version, metadata.version);
    assert.equal(path.resolve(runtime.userData).toLowerCase(), path.resolve(profile).toLowerCase());
    assert.equal(path.basename(runtime.appPath), 'app.asar');
    const page = await application.firstWindow();
    const startupErrors = [];
    const recordError = (kind, message) => {
      if (startupErrors.length < 20) startupErrors.push({ kind, message: String(message).slice(0, 2500) });
    };
    page.on('pageerror', error => recordError('pageerror', error.stack || error.message));
    page.on('console', message => { if (message.type() === 'error') recordError('console', message.text()); });
    page.setDefaultTimeout(20_000);
    try {
      // Verify the actual initial startup, not about:blank or a later reload
      // that could hide a startup-only failure.
      await page.waitForURL(url => url.protocol === 'file:' && url.pathname.endsWith('/ui/index.html'), { waitUntil: 'load' });
      await page.waitForFunction(() => document.querySelector('#reader')?.getAttribute('aria-busy') === 'false' && document.querySelector('#text-page')?.dataset.page === '7');
    } catch (error) {
      const diagnostics = await page.evaluate(async () => {
        const text = id => document.getElementById(id)?.textContent?.slice(0, 500) || '';
        const state = {
          notice: text('notice-text'),
          loading: text('loading'),
          saveStatus: text('save-status'),
          bookTitle: text('book-title'),
          readerBusy: document.getElementById('reader')?.getAttribute('aria-busy'),
          renderedPage: document.getElementById('text-page')?.dataset.page,
          desktopReaderType: typeof window.desktopReader,
        };
        if (typeof window.desktopReader?.getLibrary === 'function') {
          let timer;
          try {
            const library = await Promise.race([
              window.desktopReader.getLibrary(),
              new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('getLibrary timed out')), 2000); }),
            ]);
            state.library = {
              bookCount: library.books?.length,
              hasActiveBook: Boolean(library.activeBookId && library.books?.some(book => book.id === library.activeBookId)),
            };
          } catch (failure) { state.libraryError = String(failure.message).slice(0, 1000); }
          finally { clearTimeout(timer); }
        }
        return state;
      }).catch(failure => ({ inspectionError: String(failure.message).slice(0, 1000) }));
      const nativeDiagnostics = await application.evaluate(({ app, BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        return {
          appPath: app.getAppPath(),
          mainFrameURL: window?.webContents.mainFrame.url,
          webContentsURL: window?.webContents.getURL(),
        };
      }).catch(failure => ({ inspectionError: String(failure.message).slice(0, 1000) }));
      const expectedEntryURL = pathToFileURL(path.join(runtime.appPath, 'ui', 'index.html')).href;
      throw new Error(`Installed renderer did not restore page 7: ${JSON.stringify({ ...diagnostics, nativeDiagnostics, expectedEntryURL, pageURL: page.url(), startupErrors })}`, { cause: error });
    }
    assert.equal(await page.getByLabel('Page', { exact: true }).inputValue(), '7');
    assert.equal(await page.locator('#book-title').textContent(), 'Animal Farm');
    assert.equal(await page.locator('#pin').getAttribute('aria-pressed'), 'true');
    assert((await page.locator('#text-content').textContent()).trim().length > 100, 'the copied PDF page actually renders');
    const native = await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      return { pinned: window.isAlwaysOnTop(), bounds: window.getNormalBounds() };
    });
    assert.equal(native.pinned, true);
    assert.equal(native.bounds.width, 420);
    assert.equal(native.bounds.height, 580);
    // Read only the updater state; this smoke test does not request a download
    // or depend on a live release/network response.
    const updates = await page.evaluate(() => window.desktopReader.getUpdateState());
    assert.notEqual(updates.status, 'disabled');
    assert.equal(updates.version, metadata.version);
    // Open the EPUB imported before installation, with its original removed.
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /Existing EPUB Chapter 2 of 2/ }).click();
    await page.waitForFunction(() => document.querySelector('#reader').getAttribute('aria-busy') === 'false' && document.querySelector('#text-page').dataset.page === '2');
    const restored = await page.locator('#viewport').evaluate(el => el.scrollTop / (el.scrollHeight - el.clientHeight));
    assert(Math.abs(restored - .45) < .03, 'installation retains the saved EPUB position');
    assert.equal(await page.getByText('Styled italic', { exact: true }).evaluate(el => getComputedStyle(el).fontStyle), 'italic');
    assert.equal(await page.getByText('Styled small caps', { exact: true }).evaluate(el => getComputedStyle(el).fontVariantCaps), 'small-caps');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /Animal Farm Page 7 of 71/ }).click();
    await page.waitForFunction(() => document.querySelector('#reader').getAttribute('aria-busy') === 'false' && document.querySelector('#text-page').dataset.page === '7' && document.querySelector('#book-title').textContent === 'Animal Farm');

    await application.close(); application = null;
    await assertLibraryPreserved();
  } finally {
    try {
      if (application) await application.close();
    } finally {
      try {
        if (await exists(uninstaller)) {
          // The NSIS process check matches every executable under $INSTDIR.
          // Copy outside it before using _?=, as electron-builder's upgrade
          // template does, so the uninstaller cannot detect/kill itself.
          // _?= keeps this process waitable; no keep-data override is passed.
          const cleanupExecutable = path.join(directory, 'uninstall.exe');
          await copyFile(uninstaller, cleanupExecutable);
          await runFile(cleanupExecutable, ['/S', `_?=${installation}`], processOptions);
          if (profileSeeded) await assertLibraryPreserved();
        }
      } finally {
        if (profileCreated) await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
        await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      }
    }
  }
});
