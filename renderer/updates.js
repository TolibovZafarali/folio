export async function wireUpdates(api) {
  const $ = id => document.getElementById(id);
  let state, showResult = false, dismissedVersion = null;
  function render(next) {
    state = next;
    const status = state.status;
    const working = ['checking', 'downloading', 'installing'].includes(status);
    const available = ['available', 'ready'].includes(status);
    $('app-version').textContent = `v${state.version}`;
    $('check-updates').disabled = working;
    $('check-updates').querySelector('.update-dot').hidden = !available;
    $('check-updates').title = available ? `Version ${state.availableVersion} is available` : `Check for updates · v${state.version}`;
    $('update-banner').hidden = !(showResult || status === 'downloading' || status === 'installing' || (available && dismissedVersion !== state.availableVersion));
    $('update-action').hidden = !available && status !== 'error';
    $('update-action').disabled = working;
    $('update-action').textContent = status === 'error' ? 'Try again' : 'Update and restart';
    $('dismiss-update').hidden = status === 'downloading' || status === 'installing';
    const messages = {
      idle: `Folio Reader v${state.version}`,
      disabled: 'Updates are available in the installed Windows app.',
      checking: 'Checking for updates…',
      current: `You’re up to date · v${state.version}`,
      available: `Folio Reader ${state.availableVersion} is available. Your books and place will be kept.`,
      downloading: `Downloading update… ${Math.round(state.percent || 0)}%. The app will restart when it’s ready.`,
      ready: `Version ${state.availableVersion} is ready to install.`,
      installing: 'Saving your place and restarting…',
      error: state.message || 'Couldn’t update right now. Try again when you’re connected.',
    };
    $('update-message').textContent = messages[status] || 'Checking update status…';
  }
  async function check() {
    showResult = true; dismissedVersion = null;
    if (state) render({ ...state, status: 'checking' });
    try { render(await api.checkForUpdates()); }
    catch { render({ ...state, status: 'error', message: 'Couldn’t check for updates. Please try again.' }); }
  }
  $('check-updates').onclick = check;
  $('update-action').onclick = async () => {
    if (state?.status === 'error') { await check(); return; }
    showResult = true;
    // Main process owns checksums, installer paths, and shutdown. Renderer only
    // requests the already-advertised update; it cannot supply a URL or command.
    $('update-action').disabled = true;
    try { render(await api.installUpdate()); }
    catch { render({ ...state, status: 'error', message: 'Couldn’t install the update. Your books are still saved.' }); }
  };
  $('dismiss-update').onclick = () => { showResult = false; dismissedVersion = state?.availableVersion; $('update-banner').hidden = true; };
  const unsubscribe = api.onUpdateState(render);
  window.addEventListener('beforeunload', unsubscribe, { once: true });
  try { render(await api.getUpdateState()); }
  catch { $('check-updates').disabled = true; }
}
