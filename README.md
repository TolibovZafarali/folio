# Folio Reader for Windows

A compact desktop app for your own PDF and EPUB books. Open a book, resize the window, and optionally pin it above other applications. The app keeps its own copy of each imported book and remembers your page, bookshelf, window size, and pin setting. Reading works offline.

This directory is the complete standalone source project, version **1.2.0**. It has no dependency on a website or a parent repository. The project is maintained at [TolibovZafarali/folio](https://github.com/TolibovZafarali/folio). See [CODEX_HANDOFF.md](CODEX_HANDOFF.md) for migration and release notes.

## Windows download

[Download Folio Reader 1.2.0 for Windows](https://github.com/TolibovZafarali/folio/releases/download/reader-v1.2.0/Folio-Reader-Setup-1.2.0-x64.exe). The [release page](https://github.com/TolibovZafarali/folio/releases/tag/reader-v1.2.0) includes checksums and update files.

Version 1.2.0 adds DRM-free EPUB books alongside PDFs. Read reflowed chapters with embedded images and your preferred font; Folio remembers the chapter and your position within it. The book still fills the app window.

Windows installers target Windows 10/11, 64-bit, and install for your account without administrator access. The application is unsigned, so Windows may show a publisher or SmartScreen prompt. Check the release checksums before installing.

In version 1.1.2 or newer, click **Check for updates**, then **Update and restart** to get 1.2.0.

In an existing 1.1.1 installation, click **Check for updates**, then **Update and restart**. The original `TolibovZafarali/any-to-pdf` feed also serves the verified 1.1.2 installer, so the built-in updater can preserve your books and progress while switching to this repository for future updates.

## Reading and local data

- Use **Open book** to import PDFs or DRM-free EPUBs. PDFs offer Text and original PDF views. EPUBs use reflowed chapter text, images, and the book font you choose. Encrypted EPUBs are not supported.
- Navigation appears below the book: Previous/Next page for PDFs, Previous/Next chapter for EPUBs. The number field jumps to a page or chapter. Your place is saved automatically, including your scroll position within EPUB chapters. Left and right arrow keys also navigate.
- The book fills the app without a fixed header or footer. Press **Esc**, or use **Bookshelf & settings** below the page, to open the panel for reading settings, zoom, pinning, updates, and book actions. Closing the panel keeps your scroll position. Choose Modern sans, Classic serif, Book serif, or Monospace for Text view; your font choice is remembered. PDF view preserves the original document fonts.
- Resize the window normally and use the pin button to keep it on top.
- Reopening the app restores the active book and reading position. The bookshelf contains previously imported books.

Imported books and their reading positions are stored under `%APPDATA%\Folio Reader\`. Moving or deleting an original file does not remove the imported copy. Installing updates or uninstalling the app preserves this directory. Back it up to retain your library; deleting it clears the books and progress.

The app has no server, account, or database service. Update checks and downloads contact GitHub; your books and reading history are not uploaded.

## Development

Use Node.js **22.13 or newer**. Run these commands from the directory containing this README and `package.json`:

```sh
npm ci
npm test
npm run test:app
npm start
```

`npm test` covers library persistence, updater behavior, release integrity, and trusted renderer URLs. `npm run test:app` builds the interface and tests the real Electron app, including import, saved pages, restart, resizing, and pin preferences. The PDF fixture is included at `test/fixtures/orwellanimalfarm.pdf`; tests do not need another checkout.

The build copies PDF.js resources into the generated `renderer/public/pdfjs/` directory and builds the interface into `ui/`. These generated directories and `node_modules/` are excluded from source control and the transfer bundle.

## Build and test a Windows installer

Run on Windows, or use the included GitHub Actions workflows:

```sh
npm run build
npm run test:installed
node scripts/verify-update.cjs
```

`test:installed` requires a clean Windows user profile without an existing Folio Reader data directory; it refuses to overwrite an existing library. It installs the application, verifies preserved reading data and updater configuration, and removes its temporary installation afterward.

The outputs are:

- `release/Folio-Reader-Setup-<version>-x64.exe`
- The corresponding `.exe.blockmap`
- `release/latest.yml`
- `release/SHA256SUMS.txt`, written by the verification script

Verification checks installer version, filename, SHA-512, and byte size against the update manifest, then records SHA-256 checksums.

## Releases and repository migration

The package repository and GitHub updater destination are configured for `TolibovZafarali/folio`. See [CODEX_HANDOFF.md](CODEX_HANDOFF.md) for the migration contract. Keep the app identity and data location stable so users retain their libraries.

For a subsequent release:

1. Update `package.json` and `package-lock.json` to a matching version greater than `1.2.0`.
2. Commit the tested standalone project to its intended repository.
3. Create and push a matching `reader-vX.Y.Z` tag.

The included Windows release workflow runs tests, builds and tests the installed app, validates the release files, uploads them to a draft GitHub Release, and publishes the complete release as latest. It rejects mismatched versions and never replaces an already published release.

The migration release on the original repository delivers the same verified 1.1.2 installer through existing clients’ update buttons. Once updated, clients check `TolibovZafarali/folio` for future releases.
