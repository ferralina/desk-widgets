const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  getData:        () => ipcRenderer.invoke('get-data'),
  saveData:       (data) => ipcRenderer.invoke('save-data', data),
  closeWindow:    () => ipcRenderer.send('window-close'),
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  openApp:        (p) => ipcRenderer.send('open-app', p),
  openUrl:        (u) => ipcRenderer.send('open-url', u),
  getPinned:      () => ipcRenderer.invoke('get-pinned'),
  togglePin:      () => ipcRenderer.invoke('toggle-pin'),
  collapseWindow: (h) => ipcRenderer.invoke('collapse-window', h),
  snapMouseEnter: () => ipcRenderer.send('snap-mouse-enter'),
  snapMouseLeave: () => ipcRenderer.send('snap-mouse-leave'),
  snapRelease:    () => ipcRenderer.send('snap-release'),
  copyFileIn:     (p) => ipcRenderer.invoke('copy-file-in', p),
  getFileIcon:    (p) => ipcRenderer.invoke('get-file-icon', p),
  onSnapChanged:  (cb) => ipcRenderer.on('snap-changed', (_, edge) => cb(edge)),
  getWidgetOpacity:  () => ipcRenderer.invoke('get-opacity'),
  setWidgetOpacity:  (alpha) => ipcRenderer.invoke('set-opacity', alpha),
  onInitOpacity:     (cb) => ipcRenderer.on('init-opacity', (_, alpha) => cb(alpha)),
})
