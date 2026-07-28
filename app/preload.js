// Guvenlik: renderer tarafina yalnizca ihtiyaci olan, sinirli fonksiyonlari acar
// (contextIsolation acik, nodeIntegration kapali).

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('nexusgo', {
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

  openExternal: (url) => ipcRenderer.invoke('open-external', url),
});
