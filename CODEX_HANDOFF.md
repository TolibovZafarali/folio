# Folio Reader: standalone source handoff

## What this bundle contains

This is the Windows desktop app extracted from `TolibovZafarali/any-to-pdf`, with the project rooted directly at `package.json`. The original source bundle was version **1.1.1**; the current application is **1.1.2**. It contains the Electron main process and preload, PDF reader interface, persistent local library, updater controller, tests, Windows build/release workflows, and a local PDF test fixture.

The website and `/books` web application are not part of this project. The source move preserved runtime behavior. Version 1.1.2 subsequently adds a quieter reading layout and remembered font choices. The bundle excludes `.git`, dependencies, built interfaces, release binaries, generated PDF.js assets, environment files, and user libraries. It contains no credentials.

## Repository migration status

The application now lives directly at the root of `TolibovZafarali/folio`, including `.github/workflows`. The uploaded ZIP was replaced by its source files; the original archive remains available in Git history.

`package.json` repository metadata and `build.publish` now target `TolibovZafarali/folio`. The updater keeps the `reader-v` tag prefix. README download links point to this repository's releases page. Version 1.1.1 remains the source baseline; this migration does not create a release or tag.

## Development and validation

Use Node.js 22.13 or newer from the repository root:

```sh
npm ci
npm test
npm run test:app
npm start
```

On proxy-managed environments with Node 24, if Electron's binary download fails, use `NODE_USE_ENV_PROXY=1 node node_modules/electron/install.js` with the inherited proxy and CA trust. Retain checksum and TLS verification.

The unit/native tests use isolated temporary profiles and the included `test/fixtures/orwellanimalfarm.pdf`. They do not need another checkout or an existing library. Linux native tests run headlessly and verify pin preference persistence; Windows CI verifies actual native pinning.

## Future releases

No release is published as part of the source migration. To prepare a later release:

1. Choose a version greater than 1.1.2 and update `package.json` and `package-lock.json` together.
2. Run the tests and Windows installer checks on a clean Windows profile:

   ```sh
   npm run build
   npm run test:installed
   node scripts/verify-update.cjs
   ```

3. Commit the tested project, then create and push the matching `reader-vX.Y.Z` tag only when publication is intended.

The Windows check workflow runs on pushes to main. The release workflow runs only for release tags or an explicit manual invocation with an existing release tag. It verifies the destination against the current repository, stages a draft, and publishes only after all artifacts are uploaded. Pushing this migration to main does not trigger release publication.

`test:installed` requires a clean Windows profile and refuses to overwrite an existing Folio Reader library. Keep the installer, blockmap, `latest.yml`, and checksums together.

## Preserve application identity and users' data

Keep these values and contracts stable during the repository move:

- `build.appId`: `com.folio.reader`
- `build.productName` and `app.setName(...)`: `Folio Reader`
- The Windows data directory: `%APPDATA%\Folio Reader\`
- The existing `library.json` version-1 schema, imported-PDF ID/file mapping, reading progress, pin preference, and window bounds
- Retaining application data on uninstall (`deleteAppDataOnUninstall: false`)

Do not move or erase the data directory just to reorganize source. Import copies remain separate from original files; users should retain their books and page positions across installation updates.

## Existing users do not automatically move update feeds

Already installed 1.1.1 clients contain update settings pointing to `TolibovZafarali/any-to-pdf`. They will keep polling that repository after this source is uploaded elsewhere.

A new installer built with the new destination can be installed manually over the existing app while preserving the identity/data directory above. Automatic migration instead requires a separately planned bridge release through the old update feed. Do not claim existing clients migrated merely because the new source metadata or repository changed.

## Structure

- `main.cjs`, `preload.cjs`, `trusted-entry.cjs`: native window and constrained IPC
- `library.cjs`: copied PDFs and atomic local state persistence
- `updates.cjs`: checked updates and save-before-restart behavior
- `renderer/`: the reader interface and browser-side PDF rendering
- `scripts/`: PDF.js resource preparation and release verification
- `test/`: unit, native Electron, and Windows installed-app tests, with local fixtures
- `.github/workflows/`: standalone CI and Windows release automation

This handoff is a source transfer, not a newly published application release.
