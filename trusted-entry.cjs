const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');

function createTrustedEntry(entryPath, { platform = process.platform } = {}) {
  const windows = platform === 'win32';
  if (!(windows ? path.win32 : path.posix).isAbsolute(entryPath)) throw new Error('An absolute entry path is required.');
  const expected = pathToFileURL(entryPath, { windows }).href;
  return function isTrustedEntry(rawURL) {
    try {
      const url = new URL(rawURL);
      if (url.protocol !== 'file:' || url.hostname || url.search || url.hash || url.username || url.password || url.port) return false;
      // Chromium serializes a Windows short-path tilde literally, while Node
      // encodes it as %7E. Round-trip both URLs through the same encoder without
      // changing the file, broadening directories, or resolving other paths.
      return pathToFileURL(fileURLToPath(url, { windows }), { windows }).href === expected;
    } catch {
      return false;
    }
  };
}

function isTrustedSender(event, contents, isTrustedEntry) {
  try {
    return Boolean(contents && !contents.isDestroyed() && event.sender === contents && event.senderFrame && event.senderFrame === contents.mainFrame && isTrustedEntry(event.senderFrame.url));
  } catch {
    return false;
  }
}

module.exports = { createTrustedEntry, isTrustedSender };
