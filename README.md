# Folio Reader for Windows

A compact desktop app for your own PDF books. Open a PDF, resize the window, and optionally pin it above other applications. The app keeps its own copy of each imported book and remembers your page, bookshelf, window size, and pin setting. Reading works offline.

This directory is the complete standalone source project, version **1.1.1**. It has no dependency on a website or a parent repository. The project is maintained at [TolibovZafarali/folio](https://github.com/TolibovZafarali/folio). See [CODEX_HANDOFF.md](CODEX_HANDOFF.md) for migration and release notes.

## Windows download

Windows builds and updates from this project will be published to the [Folio releases page](https://github.com/TolibovZafarali/folio/releases). This source migration does not publish an installer or release. Version **1.1.1** is retained as the source baseline; the first release here must use a newer version.

Windows installers target Windows 10/11, 64-bit, and install for your account without administrator access. The application is unsigned, so Windows may show a publisher or SmartScreen prompt. Check the release checksums before installing.

Existing 1.1.1 installations still check the original `TolibovZafarali/any-to-pdf` update feed. Once a newer installer is available here, install it manually over the existing app to switch feeds while retaining books and progress. Moving the source alone does not migrate installed clients.

## Reading and local data

- Use **Open PDF** to import a book. Text view provides reflowed paragraphs; PDF view shows the original page.
- Use the page field or arrow controls to move through the book. The current page is saved automatically.
- Resize the window normally and use the pin button to keep it on top.
- Reopening the app restores the active book and reading position. The bookshelf contains previously imported books.

Imported PDFs and their reading positions are stored under `%APPDATA%\Folio Reader\`. Moving or deleting an original PDF does not remove the imported copy. Installing updates or uninstalling the app preserves this directory. Back it up to retain your library; deleting it clears the books and progress.

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

1. Update `package.json` and `package-lock.json` to a matching version greater than `1.1.1`.
2. Commit the tested standalone project to its intended repository.
3. Create and push a matching `reader-vX.Y.Z` tag.

The included Windows release workflow runs tests, builds and tests the installed app, validates the release files, uploads them to a draft GitHub Release, and publishes the complete release as latest. It rejects mismatched versions and never replaces an already published release.

Existing 1.1.1 installations continue checking the **original repository**, even after source code moves. They need a manually installed build configured for the new repository, or a separately planned bridge release through the old feed. Changing this source bundle cannot change already installed update settings.
