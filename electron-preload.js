const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openWidget:   ()     => ipcRenderer.send('open-widget'),
  closeWidget:  ()     => ipcRenderer.send('close-widget'),
  sendState:    (data) => ipcRenderer.send('timer-state', data),
  onTimerState: (cb)   => ipcRenderer.on('timer-state', (_, data) => cb(data)),
  isElectron:   true
});
