// electron-updater owns provider discovery, version comparison, installer caching,
// and verification. This controller only coordinates user intent and UI state.
function createUpdater({ autoUpdater, enabled, currentVersion, beforeInstall = async () => {}, onState = () => {} }) {
  const usable = enabled === true;
  if (usable && !autoUpdater) throw new Error('An updater is required for installed Windows builds.');
  let disposed = false;
  let state = {
    status: usable ? 'idle' : 'disabled',
    version: currentVersion,
    availableVersion: null,
    percent: 0,
    message: usable ? 'Check for a newer version.' : 'Automatic updates are available in the installed Windows app.',
  };
  let checkPromise, downloadPromise, installPromise;
  let installRequested = false;
  let installEpoch = 0;
  let previousCheckState;
  const listeners = [];
  const snapshot = () => ({ ...state });

  function publish(patch) {
    if (disposed) return;
    const next = { ...state, ...patch };
    if (JSON.stringify(next) === JSON.stringify(state)) return;
    state = next;
    // A detached window must not interrupt a download or its integrity checks.
    try { onState(snapshot()); } catch { /* The next window can request snapshot(). */ }
  }
  function versionOf(info) {
    return typeof info?.version === 'string' && info.version.length <= 100 && /^\d+\.\d+\.\d+(?:-[\da-z.-]+)?(?:\+[\da-z.-]+)?$/i.test(info.version) ? info.version : state.availableVersion;
  }
  function errorMessage(error, operation) {
    // Never expose updater response bodies, URLs, tokens, local paths, or stacks.
    const description = `${error?.code || ''} ${error?.message || ''}`;
    if (/sha512|checksum|signature|verification|integrity/i.test(description)) return 'The update could not be verified. Check for updates and try again.';
    if (/ENOTFOUND|ECONN|ETIMEDOUT|ERR_NETWORK|ERR_INTERNET|timeout|network|offline/i.test(description)) return 'Couldn’t reach the update service. Check your internet connection and try again.';
    if (operation === 'install') return 'Couldn’t prepare the restart. Your app is still open. Check for updates and try again.';
    if (operation === 'download') return 'Couldn’t download the update. Check for updates and try again.';
    return 'Couldn’t check for updates. Try again later.';
  }
  function fail(error, operation) {
    if (disposed) return;
    installRequested = false;
    if (operation === 'install') installEpoch++;
    const message = errorMessage(error, operation);
    // A background refresh failure does not erase an already discovered release.
    if (operation === 'check' && previousCheckState?.status === 'available') {
      publish({ ...previousCheckState, message: `${message} Version ${previousCheckState.availableVersion} is still available.` });
    } else publish({ status: 'error', message });
  }
  function listen(name, callback) {
    autoUpdater.on(name, callback);
    listeners.push([name, callback]);
  }

  function beginInstall() {
    if (installPromise) return installPromise;
    if (disposed || !usable || state.status !== 'ready') return Promise.resolve(snapshot());
    const epoch = ++installEpoch;
    publish({ status: 'installing', percent: 100, message: 'Saving your place and restarting to install…' });
    installPromise = Promise.resolve()
      .then(() => { if (!disposed) return beforeInstall(); })
      .then(() => {
        if (!disposed && epoch === installEpoch && state.status === 'installing') autoUpdater.quitAndInstall(true, true);
        return snapshot();
      })
      .catch(error => { fail(error, 'install'); return snapshot(); })
      .finally(() => { installPromise = null; installRequested = false; });
    return installPromise;
  }

  if (autoUpdater) {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.allowPrerelease = false;
  }
  if (usable) {
    listen('checking-for-update', () => {
      if (!disposed && !['downloading', 'ready', 'installing'].includes(state.status)) publish({ status: 'checking', message: 'Checking for updates…' });
    });
    listen('update-available', info => {
      if (disposed || ['downloading', 'ready', 'installing'].includes(state.status)) return;
      const version = versionOf(info);
      publish({ status: 'available', availableVersion: version, percent: 0, message: version ? `Version ${version} is available.` : 'An update is available.' });
    });
    listen('update-not-available', () => {
      if (disposed || ['downloading', 'ready', 'installing'].includes(state.status)) return;
      publish({ status: 'current', availableVersion: null, percent: 0, message: 'You have the latest version.' });
    });
    listen('download-progress', progress => {
      if (state.status !== 'downloading' || !Number.isFinite(progress?.percent)) return;
      publish({ percent: Math.max(0, Math.min(100, Math.round(progress.percent))), message: 'Downloading the update…' });
    });
    listen('update-downloaded', info => {
      if (disposed || state.status === 'installing') return;
      publish({ status: 'ready', availableVersion: versionOf(info), percent: 100, message: 'Update downloaded. Restart to install.' });
      if (installRequested) void beginInstall();
    });
    listen('error', error => {
      if (disposed) return;
      const operation = state.status === 'installing' ? 'install' : downloadPromise || state.status === 'downloading' ? 'download' : 'check';
      fail(error, operation);
    });
  }

  function check() {
    if (checkPromise) return checkPromise;
    if (disposed || !usable || downloadPromise || installPromise || ['downloading', 'ready', 'installing'].includes(state.status)) return Promise.resolve(snapshot());
    previousCheckState = snapshot();
    publish({ status: 'checking', message: 'Checking for updates…' });
    checkPromise = Promise.resolve()
      .then(() => { if (!disposed) return autoUpdater.checkForUpdates(); })
      .then(() => snapshot())
      .catch(error => { fail(error, 'check'); return snapshot(); })
      .finally(() => { checkPromise = null; previousCheckState = null; });
    return checkPromise;
  }

  function install() {
    if (installPromise) return installPromise;
    if (downloadPromise) return downloadPromise;
    if (disposed || !usable) return Promise.resolve(snapshot());
    if (state.status === 'ready') { installRequested = true; return beginInstall(); }
    if (state.status !== 'available') return Promise.resolve(snapshot());
    installRequested = true;
    publish({ status: 'downloading', percent: 0, message: 'Downloading the update…' });
    downloadPromise = Promise.resolve()
      .then(() => { if (!disposed) return autoUpdater.downloadUpdate(); })
      .then(async () => { if (installPromise) await installPromise; return snapshot(); })
      .catch(error => { fail(error, 'download'); return snapshot(); })
      .finally(() => { downloadPromise = null; });
    return downloadPromise;
  }

  function dispose() {
    disposed = true; installRequested = false;
    for (const [name, listener] of listeners) autoUpdater.removeListener(name, listener);
    listeners.length = 0;
  }

  return { snapshot, check, install, dispose };
}

module.exports = { createUpdater };
