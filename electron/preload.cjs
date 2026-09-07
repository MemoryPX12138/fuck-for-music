const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fmf', {
  // 对话框
  selectAudioFiles: () => ipcRenderer.invoke('dialog:selectAudioFiles'),
  pickConvert: (mode) => ipcRenderer.invoke('convert:pick', mode),
  selectFolder: (title) => ipcRenderer.invoke('dialog:selectFolder', title),
  // 转换
  convertStart: (payload) => ipcRenderer.invoke('convert:start', payload),
  convertAbort: () => ipcRenderer.invoke('convert:abort'),
  onConvertProgress: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on('convert:progress', h); return () => ipcRenderer.removeListener('convert:progress', h); },
  // 设置
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  // 应用信息
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  // 本地文件
  scanAudio: (dir) => ipcRenderer.invoke('fs:scanAudio', dir),
  openPath: (p) => ipcRenderer.invoke('fs:openPath', p),
  exists: (p) => ipcRenderer.invoke('fs:exists', p),
  // WebDAV
  webdavTest: (cfg) => ipcRenderer.invoke('webdav:test', cfg),
  webdavList: (payload) => ipcRenderer.invoke('webdav:list', payload),
  webdavUpload: (payload) => ipcRenderer.invoke('webdav:upload', payload),
  onWebdavProgress: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on('webdav:progress', h); return () => ipcRenderer.removeListener('webdav:progress', h); },
  // 播放器
  audioPrepare: (filePath) => ipcRenderer.invoke('audio:prepare', filePath),
  metadataGet: (filePath) => ipcRenderer.invoke('metadata:get', filePath),
});
