const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createTrustedEntry, isTrustedSender } = require('../trusted-entry.cjs');

const entry = 'C:\\Users\\RUNNER~1\\AppData\\Local\\Folio Reader\\resources\\app.asar\\ui\\index.html';
const literalTilde = 'file:///C:/Users/RUNNER~1/AppData/Local/Folio%20Reader/resources/app.asar/ui/index.html';
const encodedTilde = 'file:///C:/Users/RUNNER%7E1/AppData/Local/Folio%20Reader/resources/app.asar/ui/index.html';
const windowsTrust = () => createTrustedEntry(entry, { platform: 'win32' });

test('the installed Windows entry accepts Chromium literal tildes and Node encoded tildes', () => {
  const trusted = windowsTrust();
  assert(trusted(literalTilde));
  assert(trusted(encodedTilde));
  assert(trusted(encodedTilde.replace('%7E', '%7e')));
  assert(trusted(literalTilde.replace('Folio%20Reader', 'Folio Reader')));
});

test('spaces, literal percent signs, and hash characters remain part of the exact file path', () => {
  const trusted = createTrustedEntry('C:\\Books #1 100%\\app.asar\\ui\\index.html', { platform: 'win32' });
  assert(trusted('file:///C:/Books%20%231%20100%25/app.asar/ui/index.html'));
  assert(!trusted('file:///C:/Books%20%231%20100%2525/app.asar/ui/index.html'));
  assert(!trusted('file:///C:/Books%20#1%20100%25/app.asar/ui/index.html'));
  assert(!trusted('file:///C:/Books%20%231%20100%25/app.asar/ui/other.html'));
});

test('URL normalization does not admit other documents, frames, queries, or remote hosts', () => {
  const trusted = windowsTrust();
  for (const url of [
    literalTilde.replace('index.html', 'other.html'),
    literalTilde.replace('/ui/', '/other/'),
    literalTilde.replace('index.html', 'INDEX.HTML'),
    literalTilde.replace('RUNNER~1', 'another-user'),
    `${literalTilde}?test=true`,
    `${literalTilde}#fragment`,
    literalTilde.replace('/ui/index.html', '/ui%2Findex.html'),
    'https://example.com/index.html',
    'data:text/html,example',
    'about:blank',
    'file://other-server/share/app.asar/ui/index.html',
    'not a URL',
  ]) assert.equal(trusted(url), false, url);
});

test('ordinary POSIX entry paths use the same URL encoding and remain case-sensitive', () => {
  const trusted = createTrustedEntry('/workspace/My Reader #1/ui/index.html', { platform: 'linux' });
  assert(trusted('file:///workspace/My%20Reader%20%231/ui/index.html'));
  assert(!trusted('file:///workspace/My%20reader%20%231/ui/index.html'));
  assert(!trusted('file:///workspace/My%20Reader%20%231/ui/missing.html'));
});

test('sender trust still requires the exact window and live main-frame identity', () => {
  const mainFrame = { url: literalTilde };
  const contents = { isDestroyed: () => false, mainFrame };
  const event = { sender: contents, senderFrame: mainFrame };
  const trusted = windowsTrust();
  assert(isTrustedSender(event, contents, trusted));
  assert(!isTrustedSender({ ...event, sender: {} }, contents, trusted));
  assert(!isTrustedSender({ ...event, senderFrame: { ...mainFrame } }, contents, trusted));
  assert(!isTrustedSender({ ...event, senderFrame: null }, contents, trusted));
  assert(!isTrustedSender(event, null, trusted));
  mainFrame.url = 'https://example.com/';
  assert(!isTrustedSender(event, contents, trusted));
  mainFrame.url = literalTilde;
  contents.isDestroyed = () => true;
  assert(!isTrustedSender(event, contents, trusted));
});
