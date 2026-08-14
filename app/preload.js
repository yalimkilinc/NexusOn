// Guvenlik: renderer tarafina yalnizca ihtiyaci olan, sinirli fonksiyonlari acar
// (contextIsolation acik, nodeIntegration kapali).

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('nexuson', {
  appVersion: ipcRenderer.sendSync('get-app-version'),

  pickFileToSend: () => ipcRenderer.invoke('pick-file-to-send'),
  readFileChunk: (args) => ipcRenderer.invoke('read-file-chunk', args),
  // Surukle-birak ile bir dosya bu pencereye birakildiginda, tarayicinin
  // verdigi File nesnesinden gercek diskteki dosya yolunu cozer.
  getPathForFile: (file) => webUtils.getPathForFile(file),

  startReceiveFile: (args) => ipcRenderer.invoke('start-receive-file', args),
  writeFileChunk: (args) => ipcRenderer.invoke('write-file-chunk', args),
  finishReceiveFile: (args) => ipcRenderer.invoke('finish-receive-file', args),
  showFileInFolder: (filePath) => ipcRenderer.invoke('show-file-in-folder', filePath),

  sendRemoteInput: (evt) => ipcRenderer.invoke('remote-input', evt),
  onRemoteInputError: (cb) => ipcRenderer.on('remote-input-error', (_e, message) => cb(message)),

  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  downloadAndInstallUpdate: (url) => ipcRenderer.invoke('download-and-install-update', url),

  debugLog: (msg) => ipcRenderer.send('debug-log', msg),

  dxgiInit: (screenNum) => ipcRenderer.invoke('dxgi-init', screenNum),
  dxgiGetFrame: () => ipcRenderer.invoke('dxgi-get-frame'),
  dxgiMonitorCount: () => ipcRenderer.invoke('dxgi-monitor-count'),
  getCursorPos: () => ipcRenderer.invoke('get-cursor-pos'),
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),

  // frame:false ile Windows'un kendi pencere dugmeleri kaldirildigi icin,
  // yerlerini alan ozel ust cubuk dugmeleri bunlari kullanir.
  windowMinimize: () => ipcRenderer.send('window-minimize'),
  windowMaximizeToggle: () => ipcRenderer.send('window-maximize-toggle'),
  windowClose: () => ipcRenderer.send('window-close'),
  onWindowMaximizedState: (cb) => ipcRenderer.on('window-maximized-state', (_e, isMaximized) => cb(isMaximized)),

  // Telegram bildirimindeki koda tiklaninca (nexuson://connect?...) gelen bilgi.
  onDeepLink: (cb) => ipcRenderer.on('deep-link', (_e, payload) => cb(payload)),
});
