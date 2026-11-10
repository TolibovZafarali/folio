const assert = require('node:assert/strict');
const { test } = require('node:test');
const { EventEmitter } = require('node:events');
const { createUpdater } = require('../updates.cjs');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
class FakeUpdater extends EventEmitter {
  constructor() { super(); this.checks = 0; this.downloads = 0; this.installs = []; }
  async checkForUpdates() { this.checks++; this.emit('checking-for-update'); return this.onCheck?.(); }
  async downloadUpdate() { this.downloads++; return this.onDownload?.(); }
  quitAndInstall(...args) { this.installs.push(args); }
}
function fixture(options = {}) {
  const autoUpdater = new FakeUpdater();
  const states = [];
  const controller = createUpdater({ autoUpdater, enabled: true, currentVersion: '1.0.0', onState: value => states.push(value), ...options });
  return { autoUpdater, states, controller };
}

test('creation is offline and locks updater policy to user-requested stable upgrades', () => {
  const { autoUpdater, controller } = fixture();
  assert.equal(autoUpdater.checks, 0);
  assert.equal(autoUpdater.downloads, 0);
  for (const key of ['autoDownload', 'autoInstallOnAppQuit', 'allowDowngrade', 'allowPrerelease']) assert.equal(autoUpdater[key], false);
  assert.equal(controller.snapshot().status, 'idle');
  const copy = controller.snapshot(); copy.status = 'error';
  assert.equal(controller.snapshot().status, 'idle');
  controller.dispose();
});

test('one click downloads, verifies completion, flushes local state, then installs exactly once', async () => {
  const flush = deferred();
  const order = [];
  const { autoUpdater, controller, states } = fixture({ beforeInstall: () => { order.push('flush'); return flush.promise; } });
  autoUpdater.onCheck = () => autoUpdater.emit('update-available', { version: '1.1.0' });
  await controller.check();
  assert.equal(controller.snapshot().availableVersion, '1.1.0');
  const download = deferred();
  autoUpdater.onDownload = () => download.promise;
  autoUpdater.quitAndInstall = (...args) => { order.push('install'); autoUpdater.installs.push(args); };
  const first = controller.install(), second = controller.install();
  assert.strictEqual(first, second);
  await tick();
  assert.equal(autoUpdater.downloads, 1);
  autoUpdater.emit('download-progress', { percent: 42.4 });
  assert.equal(controller.snapshot().percent, 42);
  autoUpdater.emit('update-downloaded', { version: '1.1.0' });
  download.resolve(['/verified/installer.exe']);
  await tick();
  assert.equal(controller.snapshot().status, 'installing');
  assert.deepEqual(order, ['flush']);
  assert.equal(autoUpdater.installs.length, 0);
  void controller.install();
  autoUpdater.emit('update-downloaded', { version: '1.1.0' });
  flush.resolve(); await first;
  assert.deepEqual(order, ['flush', 'install']);
  assert.deepEqual(autoUpdater.installs, [[true, true]]);
  assert(states.some(value => value.status === 'ready'));
  assert.equal(controller.snapshot().version, '1.0.0');
  controller.dispose();
});

test('checks cannot overlap and a no-update result resets stale release details', async () => {
  const { autoUpdater, controller } = fixture();
  const pending = deferred();
  autoUpdater.onCheck = () => pending.promise;
  const first = controller.check(), second = controller.check();
  assert.strictEqual(first, second);
  await tick();
  assert.equal(autoUpdater.checks, 1);
  autoUpdater.emit('update-not-available', { version: '1.0.0' });
  pending.resolve(); await first;
  assert.equal(controller.snapshot().status, 'current');
  assert.equal(controller.snapshot().availableVersion, null);
  assert.equal(autoUpdater.downloads, 0);
  controller.dispose();
});

test('check errors are sanitized, do not quit, and can be retried', async () => {
  const { autoUpdater, controller } = fixture();
  autoUpdater.onCheck = () => {
    const error = new Error('Network failure for https://token:secret@example.com/releases');
    autoUpdater.emit('error', error); throw error;
  };
  await controller.check();
  assert.equal(controller.snapshot().status, 'error');
  assert(!JSON.stringify(controller.snapshot()).includes('secret'));
  assert(!JSON.stringify(controller.snapshot()).includes('example.com'));
  assert.deepEqual(autoUpdater.installs, []);
  autoUpdater.onCheck = () => autoUpdater.emit('update-available', { version: '1.2.0' });
  await controller.check();
  assert.equal(controller.snapshot().status, 'available');
  controller.dispose();
});

test('a failed refresh keeps an already discovered update available', async () => {
  const { autoUpdater, controller } = fixture();
  autoUpdater.onCheck = () => autoUpdater.emit('update-available', { version: '1.1.0' });
  await controller.check();
  autoUpdater.onCheck = () => { throw new Error('ETIMEDOUT'); };
  await controller.check();
  assert.equal(controller.snapshot().status, 'available');
  assert.equal(controller.snapshot().availableVersion, '1.1.0');
  assert.match(controller.snapshot().message, /still available/);
  controller.dispose();
});

test('a failed checksum or download never closes the app', async () => {
  const { autoUpdater, controller } = fixture();
  autoUpdater.onCheck = () => autoUpdater.emit('update-available', { version: '1.1.0' });
  await controller.check();
  autoUpdater.onDownload = () => {
    const error = new Error('sha512 checksum mismatch at https://secret@example.com');
    autoUpdater.emit('error', error); throw error;
  };
  await controller.install();
  assert.equal(controller.snapshot().status, 'error');
  assert.match(controller.snapshot().message, /could not be verified/);
  assert(!controller.snapshot().message.includes('secret'));
  assert.equal(autoUpdater.installs.length, 0);
  controller.dispose();
});

test('a failed pre-install save prevents the installer from quitting the app', async () => {
  const { autoUpdater, controller } = fixture({ beforeInstall: async () => { throw new Error('EACCES /private/path'); } });
  autoUpdater.onCheck = () => autoUpdater.emit('update-available', { version: '1.1.0' });
  autoUpdater.onDownload = async () => { autoUpdater.emit('update-downloaded', { version: '1.1.0' }); return ['installer.exe']; };
  await controller.check(); await controller.install();
  assert.equal(controller.snapshot().status, 'error');
  assert.match(controller.snapshot().message, /app is still open/);
  assert(!controller.snapshot().message.includes('private'));
  assert.equal(autoUpdater.installs.length, 0);
  controller.dispose();
});

test('an unsolicited downloaded installer waits for a deliberate install click', async () => {
  let flushed = false;
  const { autoUpdater, controller } = fixture({ beforeInstall: () => { flushed = true; } });
  autoUpdater.emit('update-downloaded', { version: '1.1.0' });
  assert.equal(controller.snapshot().status, 'ready');
  assert.equal(autoUpdater.installs.length, 0);
  await controller.install();
  assert(flushed);
  assert.equal(autoUpdater.downloads, 0);
  assert.deepEqual(autoUpdater.installs, [[true, true]]);
  controller.dispose();
});

test('disabled and disposed controllers never start downloads or install', async () => {
  const { autoUpdater, controller, states } = fixture({ enabled: false });
  await controller.check(); await controller.install();
  assert.equal(controller.snapshot().status, 'disabled');
  assert.equal(autoUpdater.checks, 0);
  assert.equal(autoUpdater.downloads, 0);
  assert.equal(autoUpdater.eventNames().length, 0);
  assert.deepEqual(states, []);
  controller.dispose();
  const active = fixture();
  active.autoUpdater.emit('update-downloaded', { version: '1.1.0' });
  active.controller.dispose();
  assert.equal(active.autoUpdater.eventNames().length, 0);
  await active.controller.check(); await active.controller.install();
  assert.equal(active.autoUpdater.installs.length, 0);
});

test('disposing during a pending state flush prevents a late install', async () => {
  const flush = deferred();
  const { autoUpdater, controller } = fixture({ beforeInstall: () => flush.promise });
  autoUpdater.emit('update-downloaded', { version: '1.1.0' });
  const installing = controller.install();
  await tick();
  controller.dispose(); flush.resolve(); await installing;
  assert.equal(autoUpdater.installs.length, 0);
});

test('an updater error while saving prevents a delayed restart after the save resolves', async () => {
  const flush = deferred();
  const { autoUpdater, controller } = fixture({ beforeInstall: () => flush.promise });
  autoUpdater.emit('update-downloaded', { version: '1.1.0' });
  const installing = controller.install();
  await tick();
  autoUpdater.emit('error', new Error('installer disappeared'));
  flush.resolve(); await installing;
  assert.equal(controller.snapshot().status, 'error');
  assert.equal(autoUpdater.installs.length, 0);
  controller.dispose();
});
