const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktopReader', {
  getLibrary: () => ipcRenderer.invoke('reader:get-library'),
  importBooks: () => ipcRenderer.invoke('reader:import-books'),
  readBook: id => ipcRenderer.invoke('reader:read-book', id),
  saveProgress: progress => ipcRenderer.invoke('reader:save-progress', progress),
  removeBook: id => ipcRenderer.invoke('reader:remove-book', id),
  setAlwaysOnTop: value => ipcRenderer.invoke('reader:set-always-on-top', value),
  getUpdateState: () => ipcRenderer.invoke('reader:get-update-state'),
  checkForUpdates: () => ipcRenderer.invoke('reader:check-updates'),
  installUpdate: () => ipcRenderer.invoke('reader:install-update'),
  onUpdateState: callback => {
    if (typeof callback !== 'function') throw new TypeError('Expected a callback.');
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('reader:update-state', listener);
    return () => ipcRenderer.removeListener('reader:update-state', listener);
  },
});
