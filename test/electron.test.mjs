import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { _electron as electron } from 'playwright';

const require = createRequire(import.meta.url);
const desktop = fileURLToPath(new URL('../', import.meta.url));
const fixturePDF = fileURLToPath(new URL('./fixtures/orwellanimalfarm.pdf', import.meta.url));

async function waitForPage(page, number) {
  await page.waitForFunction(expected => {
    const reader = document.querySelector('#reader');
    return reader?.getAttribute('aria-busy') === 'false' && document.querySelector('#text-page')?.dataset.page === String(expected);
  }, number);
}

async function setShelf(page, open) {
  if (await page.locator('#shelf').isVisible() !== open) {
    if (open) await page.getByRole('button', { name: 'Show bookshelf', exact: true }).click();
    else await page.locator('#close-shelf').click();
    if (await page.locator('#reader').isVisible()) {
      await page.waitForFunction(() => document.querySelector('#reader').getAttribute('aria-busy') === 'false');
    }
  }
}

test('the native app imports, shows update states, pins, resizes and restores its copied PDF after restart', { timeout: 120_000 }, async () => {
  await access(path.join(desktop, 'ui', 'index.html'));
  const directory = await mkdtemp(path.join(tmpdir(), 'folio-electron-test-'));
  const profile = path.join(directory, 'profile');
  const original = path.join(directory, 'Animal Farm.pdf');
  await mkdir(profile);
  await copyFile(fixturePDF, original);
  // Keep tests completely separate from any real library. This wrapper calls
  // Electron's public API before production main code, without adding app hooks.
  const wrapper = path.join(directory, 'launch.cjs');
  await writeFile(wrapper, `const { app } = require('electron');\napp.setPath('userData', ${JSON.stringify(profile)});\nrequire(${JSON.stringify(path.join(desktop, 'main.cjs'))});\n`);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  const args = [wrapper];
  if (process.platform === 'linux') args.unshift('--no-sandbox', '--ozone-platform=headless', '--disable-gpu', '--ozone-override-screen-size=1440,1000');
  let application;
  const launch = async () => {
    application = await electron.launch({ executablePath: require('electron'), args, env, timeout: 30_000 });
    assert.equal(await application.evaluate(({ app }) => app.getPath('userData')), profile);
    const page = await application.firstWindow();
    page.setDefaultTimeout(20_000);
    return page;
  };
  try {
    let page = await launch();
    await page.locator('#welcome').waitFor();
    // An unpackaged app must report that updates are unavailable, through the
    // actual renderer -> preload -> main command bridge, without doing network I/O.
    await setShelf(page, true);
    await page.getByRole('button', { name: 'Check for updates', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#update-message')?.textContent.includes('installed Windows app'));
    assert(await page.locator('#update-banner').isVisible());
    assert(await page.locator('#update-action').isHidden());
    await page.getByRole('button', { name: 'Dismiss update message' }).click();
    await application.evaluate(({ dialog }, filename) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] });
    }, original);
    await page.getByRole('button', { name: 'Open book', exact: true }).click();
    await waitForPage(page, 1);
    assert.match(await page.locator('#text-content').textContent(), /Manor Farm/);
    assert.equal(await page.locator('#book-title').textContent(), 'Animal Farm');
    assert(await page.locator('#shelf').isHidden());
    for (const selector of ['.app-brand', '.document-heading']) {
      assert(await page.locator(selector).isHidden(), `${selector} lives inside the closed panel`);
    }
    const readingArea = () => page.locator('#viewport').evaluate(element => {
      const bounds = element.getBoundingClientRect();
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, windowWidth: innerWidth, windowHeight: innerHeight };
    });
    let area = await readingArea();
    assert.deepEqual([area.x, area.y, area.width, area.height], [0, 0, area.windowWidth, area.windowHeight], 'the book viewport fills the app');
    await page.locator('#viewport').evaluate(element => { element.scrollTop = 150; });
    const readingScroll = await page.locator('#viewport').evaluate(element => element.scrollTop);
    await page.keyboard.press('Escape');
    assert(await page.locator('#shelf').isVisible());
    assert.equal(await page.locator('#main').evaluate(element => element.inert), true);
    assert.deepEqual(await readingArea(), area, 'opening the panel must not resize or reflow the book');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#text-page').getAttribute('data-page'), '1');
    await page.keyboard.press('Escape');
    assert(await page.locator('#shelf').isHidden());
    assert.equal(await page.locator('#viewport').evaluate(element => element.scrollTop), readingScroll, 'closing settings preserves the reading position');
    await page.keyboard.press('Escape');
    const backdrop = await page.locator('#shelf-backdrop').boundingBox();
    await page.locator('#shelf-backdrop').click({ position: { x: backdrop.width - 8, y: 200 } });
    assert(await page.locator('#shelf').isHidden());
    assert.equal(await page.locator('#main').evaluate(element => element.inert), false);

    for (const id of ['text-view', 'pdf-view', 'pin', 'import', 'remove', 'zoom-in']) {
      assert(await page.locator(`#${id}`).isHidden(), `${id} stays out of the reading page`);
    }
    assert(await page.locator('#previous').isDisabled());
    await page.locator('#next').scrollIntoViewIfNeeded();
    const layout = await page.evaluate(() => ({
      end: document.querySelector('#text-page').getBoundingClientRect().bottom,
      next: document.querySelector('#next').getBoundingClientRect().top,
    }));
    assert(layout.next >= layout.end, 'Next page follows the book content');
    if (process.env.FOLIO_TEST_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.FOLIO_TEST_SCREENSHOTS, 'folio-page-bottom.png') });
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    await waitForPage(page, 2);
    assert.equal(await page.locator('#viewport').evaluate(element => element.scrollTop), 0);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'text-page');
    await page.getByRole('button', { name: 'Previous page', exact: true }).click();
    await waitForPage(page, 1);
    await setShelf(page, true);
    const font = page.getByLabel('Book font', { exact: true });
    const families = new Set();
    for (const choice of ['sans', 'serif', 'book', 'mono']) {
      await font.selectOption(choice);
      families.add(await page.locator('#text-content').evaluate(element => getComputedStyle(element).fontFamily));
      assert.match(await page.locator('#text-content').textContent(), /Manor Farm/);
    }
    assert.equal(families.size, 4, 'each font choice changes the reading font');
    await font.press('ArrowRight');
    await waitForPage(page, 1); // Native select navigation must not turn the book page.
    await font.selectOption('serif');
    if (process.env.FOLIO_TEST_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.FOLIO_TEST_SCREENSHOTS, 'folio-reading-settings.png') });
    await setShelf(page, false);

    if (process.env.FOLIO_TEST_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.FOLIO_TEST_SCREENSHOTS, 'folio-desktop-reader.png') });
    await page.getByLabel('Page', { exact: true }).fill('7');
    await page.getByLabel('Page', { exact: true }).press('Enter');
    await waitForPage(page, 7);
    await setShelf(page, true);
    await page.getByRole('button', { name: 'PDF', exact: true }).click();
    assert(await page.getByLabel('Book font', { exact: true }).isDisabled());
    await setShelf(page, false);
    assert(await page.locator('#canvas').isVisible());
    const hasInk = await page.locator('#canvas').evaluate(canvas => {
      const bytes = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 0; i < bytes.length; i += 4) if (bytes[i + 3] && bytes[i] < 160 && bytes[i + 1] < 160 && bytes[i + 2] < 160) return true;
      return false;
    });
    assert(hasInk, 'the PDF canvas should contain the actual page');
    await setShelf(page, true);
    await page.getByRole('button', { name: 'Keep on top', exact: true }).click();
    await setShelf(page, false);
    await page.waitForFunction(() => document.querySelector('#pin')?.getAttribute('aria-pressed') === 'true');
    // Ozone's headless platform has no window manager and reports false here.
    // Windows CI verifies real native pinning; Linux still verifies persistence.
    if (process.platform !== 'linux') assert(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isAlwaysOnTop()));
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 25, y: 30, width: 420, height: 580 }));
    await page.waitForFunction(() => innerWidth <= 420);
    await page.waitForTimeout(300);
    await waitForPage(page, 7);
    await setShelf(page, true);
    await page.getByRole('button', { name: 'Text', exact: true }).click();
    await setShelf(page, false);
    // Exercise the real main-to-preload notification path without downloading
    // or installing an invented release. Controller tests cover installation.
    const currentUpdateState = await page.evaluate(() => window.desktopReader.getUpdateState());
    const announceUpdate = state => application.evaluate(({ BrowserWindow }, update) => {
      BrowserWindow.getAllWindows()[0].webContents.send('reader:update-state', update);
    }, { ...currentUpdateState, availableVersion: '9.9.9', ...state });
    await announceUpdate({ status: 'available' });
    await page.locator('#update-banner').waitFor();
    assert.match(await page.locator('#update-message').textContent(), /9\.9\.9/);
    assert(await page.getByRole('button', { name: 'Update and restart', exact: true }).isEnabled());
    await page.getByRole('button', { name: 'Dismiss update message' }).click();
    await announceUpdate({ status: 'available' });
    assert(await page.locator('#update-banner').isHidden(), 'a repeated notification should respect dismissal');
    await setShelf(page, true);
    await page.getByRole('button', { name: 'Check for updates', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#update-message')?.textContent.includes('installed Windows app'));
    assert(await page.locator('#update-banner').isVisible(), 'manual checking should reveal the result again');
    await setShelf(page, false);
    await announceUpdate({ status: 'downloading', percent: 42.4 });
    await page.waitForFunction(() => document.querySelector('#update-message')?.textContent.includes('42%'));
    assert(await page.locator('#check-updates').isDisabled());
    assert(await page.locator('#update-action').isDisabled());
    assert(await page.getByRole('button', { name: 'Dismiss update message' }).isHidden());
    await page.getByRole('button', { name: 'Previous page', exact: true }).click();
    await waitForPage(page, 6);
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    await waitForPage(page, 7);
    const updateError = 'The update could not be verified. Check for updates and try again.';
    await announceUpdate({ status: 'error', message: updateError });
    await page.getByRole('button', { name: 'Try again', exact: true }).waitFor();
    assert.equal(await page.locator('#update-message').textContent(), updateError);
    assert(await page.getByRole('button', { name: 'Try again', exact: true }).isEnabled());
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 360, height: 580 }));
    await page.waitForFunction(() => innerWidth <= 360);
    await page.waitForTimeout(300);
    await waitForPage(page, 7);
    assert(await page.locator('#update-banner').evaluate(element => element.scrollWidth <= element.clientWidth), 'update banner should fit the minimum window width');
    assert(await page.locator('.page-navigation').evaluate(element => element.scrollWidth <= element.clientWidth), 'page controls should fit the minimum window width');
    await setShelf(page, true);
    assert(await page.locator('#reading-font').evaluate(element => element.getBoundingClientRect().right <= innerWidth), 'font chooser fits the minimum window width');
    await setShelf(page, false);
    if (process.env.FOLIO_TEST_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.FOLIO_TEST_SCREENSHOTS, 'folio-desktop-update-error.png') });
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#update-message')?.textContent.includes('installed Windows app'));
    await page.getByRole('button', { name: 'Dismiss update message' }).click();
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 25, y: 30, width: 420, height: 580 }));
    await page.waitForFunction(() => innerWidth <= 420 && innerWidth > 360);
    await page.waitForTimeout(300);
    await waitForPage(page, 7);
    area = await readingArea();
    assert.deepEqual([area.x, area.y, area.width, area.height], [0, 0, area.windowWidth, area.windowHeight], 'the compact reader also fills the app');
    if (process.env.FOLIO_TEST_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.FOLIO_TEST_SCREENSHOTS, 'folio-desktop-small.png') });
    await page.locator('#next').scrollIntoViewIfNeeded();
    if (process.env.FOLIO_TEST_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.FOLIO_TEST_SCREENSHOTS, 'folio-page-bottom-small.png') });
    await page.getByLabel('Page', { exact: true }).fill('71');
    await page.getByLabel('Page', { exact: true }).press('Enter');
    await waitForPage(page, 71);
    assert(await page.locator('#next').isDisabled());
    await page.getByLabel('Page', { exact: true }).fill('7');
    await page.getByLabel('Page', { exact: true }).press('Enter');
    await waitForPage(page, 7);
    const nativeBounds = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getNormalBounds());
    assert.equal(nativeBounds.width, 420);
    assert.equal(nativeBounds.height, 580);
    // application.close() uses the real quit path and waits for the main process.
    await application.close(); application = null;
    const saved = JSON.parse(await readFile(path.join(profile, 'library.json'), 'utf8'));
    assert.equal(saved.books[0].page, 7);
    assert.equal(saved.books[0].totalPages, 71);
    assert.equal(saved.alwaysOnTop, true);
    assert.equal(saved.windowBounds.width, 420);
    assert.equal(saved.windowBounds.height, 580);
    await rm(original);

    page = await launch();
    await waitForPage(page, 7);
    assert.equal(await page.getByLabel('Page', { exact: true }).inputValue(), '7');
    assert.equal(await page.getByLabel('Book font', { exact: true }).inputValue(), 'serif');
    assert.match(await page.locator('#text-content').evaluate(element => getComputedStyle(element).fontFamily), /Georgia/);
    assert.equal(await page.locator('#book-title').textContent(), 'Animal Farm');
    assert.match(await page.locator('#save-status').textContent(), /saved/);
    assert.equal(await page.locator('#pin').getAttribute('aria-pressed'), 'true');
    const restored = await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      return { bounds: window.getNormalBounds(), pinned: window.isAlwaysOnTop() };
    });
    assert.equal(restored.bounds.width, 420);
    assert.equal(restored.bounds.height, 580);
    if (process.platform !== 'linux') assert(restored.pinned);
    await page.getByRole('button', { name: 'Show bookshelf', exact: true }).click();
    assert.match(await page.locator('#books').textContent(), /Animal Farm/);
    assert.match(await page.locator('#books').textContent(), /Page 7 of 71/);
  } finally {
    if (application) await application.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('EPUB chapters, images, fonts and scroll position survive restart without running book scripts', { timeout: 120_000 }, async () => {
  const { createEpub } = await import('./fixtures/epub-fixture.mjs');
  const directory = await mkdtemp(path.join(tmpdir(), 'folio-epub-test-'));
  const profile = path.join(directory, 'profile');
  const original = path.join(directory, 'Quiet Garden.epub');
  await mkdir(profile); await writeFile(original, createEpub());
  const wrapper = path.join(directory, 'launch.cjs');
  await writeFile(wrapper, `const { app } = require('electron');\napp.setPath('userData', ${JSON.stringify(profile)});\nrequire(${JSON.stringify(path.join(desktop, 'main.cjs'))});\n`);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
  const args = [wrapper];
  if (process.platform === 'linux') args.unshift('--no-sandbox', '--ozone-platform=headless', '--disable-gpu');
  let application;
  const launch = async () => {
    application = await electron.launch({ executablePath: require('electron'), args, env });
    const page = await application.firstWindow(); page.setDefaultTimeout(20000); return page;
  };
  try {
    let page = await launch();
    const externalRequests = [];
    page.on('request', request => { if (/^https?:/.test(request.url())) externalRequests.push(request.url()); });
    await page.locator('#welcome').waitFor();
    await application.evaluate(({ dialog }, filename) => {
      dialog.showOpenDialog = async (_window, options) => {
        if (!options.filters.some(filter => filter.extensions.includes('epub'))) throw new Error('EPUB missing from file picker');
        return { canceled: false, filePaths: [filename] };
      };
    }, original);
    await page.locator('#welcome-import').click();
    await waitForPage(page, 1);
    assert.match(await page.locator('#text-content').textContent(), /Morning in the garden/);
    assert.equal(await page.getByLabel('Chapter', { exact: true }).inputValue(), '1');
    assert(await page.getByRole('button', { name: 'Previous chapter', exact: true }).isDisabled());
    assert(await page.locator('#text-content img').evaluate(img => img.complete && img.naturalWidth > 0));
    assert.equal(await page.evaluate(() => window.epubExecuted), undefined);
    assert.equal(await page.locator('#text-content script, #text-content iframe, #text-content [onclick]').count(), 0);
    assert.deepEqual(externalRequests, []);
    await page.getByText('Read the evening chapter', { exact: true }).click();
    await waitForPage(page, 2);
    assert.match(await page.locator('#text-content').textContent(), /Evening in the garden/);
    assert(await page.locator('#viewport').evaluate(el => el.scrollTop > 0));
    await page.keyboard.press('Escape');
    assert(await page.locator('#view-settings').isHidden());
    await page.getByLabel('Book font', { exact: true }).selectOption('book');
    await page.keyboard.press('Escape');
    await page.locator('#viewport').evaluate(el => { el.scrollTop = (el.scrollHeight - el.clientHeight) * .45; });
    await page.waitForFunction(async () => {
      const library = await window.desktopReader.getLibrary();
      return Math.abs(library.books[0].scrollProgress - .45) < .02;
    });
    if (process.env.FOLIO_TEST_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.FOLIO_TEST_SCREENSHOTS, 'folio-epub-reader.png') });
    await application.close(); application = null; await rm(original);
    page = await launch();
    await waitForPage(page, 2);
    assert.equal(await page.getByLabel('Book font', { exact: true }).inputValue(), 'book');
    const restored = await page.locator('#viewport').evaluate(el => el.scrollTop / (el.scrollHeight - el.clientHeight));
    assert(Math.abs(restored - .45) < .03, 'EPUB restores the position inside the chapter');
    assert(await page.getByRole('button', { name: 'Next chapter', exact: true }).isDisabled());
    await page.getByRole('button', { name: 'Previous chapter', exact: true }).click();
    await waitForPage(page, 1);
    assert.match(await page.locator('#text-content').textContent(), /Morning in the garden/);
    await page.getByRole('button', { name: 'Next chapter', exact: true }).click();
    await waitForPage(page, 2);
    assert.equal(await page.locator('#viewport').evaluate(el => el.scrollTop), 0);
    const protectedFile = path.join(directory, 'Protected.epub');
    await writeFile(protectedFile, createEpub({ 'META-INF/encryption.xml': new TextEncoder().encode('<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#"><EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/></EncryptedData></encryption>') }));
    await application.evaluate(({ dialog }, filename) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] });
    }, protectedFile);
    await page.keyboard.press('Control+o');
    await page.waitForFunction(() => document.querySelector('#loading').textContent.includes('DRM-free'));
    assert(await page.locator('#text-page').isHidden());
    await page.keyboard.press('Escape');
    await page.locator('.book-open').filter({ hasText: 'Quiet Garden' }).click();
    await waitForPage(page, 2);
    assert.match(await page.locator('#text-content').textContent(), /Evening in the garden/);
  } finally {
    if (application) await application.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
