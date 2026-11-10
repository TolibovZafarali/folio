const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFile, stat, writeFile } = require('node:fs/promises');
const path = require('node:path');
const yaml = require('js-yaml');

async function verifyUpdate(directory, version) {
  assert.match(version, /^[0-9]+\.[0-9]+\.[0-9]+$/, 'Expected a stable package version');
  const filename = `Folio-Reader-Setup-${version}-x64.exe`;
  const blockmap = `${filename}.blockmap`;
  const installerPath = path.join(directory, filename);
  const manifestBytes = await readFile(path.join(directory, 'latest.yml'));
  const manifest = yaml.load(manifestBytes.toString('utf8'), { schema: yaml.JSON_SCHEMA });
  assert.equal(manifest?.version, version, 'Update manifest version must match package version');
  assert.equal(manifest.path, filename, 'Update manifest must reference the expected local installer');
  assert.equal(manifest.files?.length, 1, 'Exactly one Windows x64 installer is expected');
  const file = manifest.files[0];
  assert.equal(file.url, filename, 'Update file URL must be the installer basename');
  const bytes = await readFile(installerPath);
  assert(bytes.length >= 1024 * 1024, 'Windows installer is unexpectedly small');
  assert.equal(bytes.subarray(0, 2).toString(), 'MZ', 'Installer must be a Windows executable');
  assert.equal(file.size, bytes.length, 'Update manifest size must match installer bytes');
  const sha512 = createHash('sha512').update(bytes).digest('base64');
  assert.equal(file.sha512, sha512, 'Update file SHA-512 must match installer bytes');
  assert.equal(manifest.sha512, sha512, 'Update manifest SHA-512 must match installer bytes');
  assert((await stat(path.join(directory, blockmap))).size > 0, 'Installer blockmap must not be empty');
  const artifactNames = [filename, blockmap, 'latest.yml'];
  const hashes = await Promise.all(artifactNames.map(async name => {
    const content = name === filename ? bytes : name === 'latest.yml' ? manifestBytes : await readFile(path.join(directory, name));
    return `${createHash('sha256').update(content).digest('hex')}  ${name}`;
  }));
  await writeFile(path.join(directory, 'SHA256SUMS.txt'), `${hashes.join('\n')}\n`, 'utf8');
  return artifactNames;
}

if (require.main === module) {
  const version = require('../package.json').version;
  verifyUpdate(path.resolve(process.argv[2] || path.join(__dirname, '../release')), version)
    .then(files => console.log(`Verified update manifest and checksums for ${files.join(', ')}`))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { verifyUpdate };
