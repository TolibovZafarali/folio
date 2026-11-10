const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const yaml = require('js-yaml');
const { verifyUpdate } = require('../scripts/verify-update.cjs');

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'folio-release-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const version = '1.1.0';
  const filename = `Folio-Reader-Setup-${version}-x64.exe`;
  const bytes = Buffer.alloc(1024 * 1024, 42);
  bytes.write('MZ', 0);
  const sha512 = createHash('sha512').update(bytes).digest('base64');
  const manifest = { version, path: filename, sha512, files: [{ url: filename, sha512, size: bytes.length }] };
  const saveManifest = () => writeFile(path.join(directory, 'latest.yml'), yaml.dump(manifest));
  await writeFile(path.join(directory, filename), bytes);
  await writeFile(path.join(directory, `${filename}.blockmap`), 'test-blockmap');
  await saveManifest();
  return { directory, version, filename, bytes, manifest, saveManifest };
}

test('release verification checks the installer and hashes every published update file', async t => {
  const f = await fixture(t);
  const files = await verifyUpdate(f.directory, f.version);
  assert.deepEqual(files, [f.filename, `${f.filename}.blockmap`, 'latest.yml']);
  const hashes = (await readFile(path.join(f.directory, 'SHA256SUMS.txt'), 'utf8')).trim().split('\n');
  assert.equal(hashes.length, 3);
  for (const [index, filename] of files.entries()) {
    const expected = createHash('sha256').update(await readFile(path.join(f.directory, filename))).digest('hex');
    assert.equal(hashes[index], `${expected}  ${filename}`);
  }
});

test('release verification rejects altered installer bytes before generating checksums', async t => {
  const f = await fixture(t);
  f.bytes[100] ^= 1;
  await writeFile(path.join(f.directory, f.filename), f.bytes);
  await assert.rejects(verifyUpdate(f.directory, f.version), /SHA-512/);
  await assert.rejects(readFile(path.join(f.directory, 'SHA256SUMS.txt')), { code: 'ENOENT' });
});

test('release verification rejects wrong versions, unexpected URLs, sizes, and missing blockmaps', async t => {
  const f = await fixture(t);
  f.manifest.version = '1.2.0'; await f.saveManifest();
  await assert.rejects(verifyUpdate(f.directory, f.version), /version/);
  f.manifest.version = f.version;
  f.manifest.files[0].url = 'https://example.com/installer.exe'; await f.saveManifest();
  await assert.rejects(verifyUpdate(f.directory, f.version), /basename/);
  f.manifest.files[0].url = f.filename;
  f.manifest.files[0].size = 10; await f.saveManifest();
  await assert.rejects(verifyUpdate(f.directory, f.version), /size/);
  f.manifest.files[0].size = f.bytes.length; await f.saveManifest();
  await rm(path.join(f.directory, `${f.filename}.blockmap`));
  await assert.rejects(verifyUpdate(f.directory, f.version), { code: 'ENOENT' });
});
