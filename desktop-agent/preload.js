const { contextBridge, ipcRenderer } = require('electron');

// SEC-07: Safe context bridge exposure with strict whitelist validation of IPC channels
const VALID_CHANNELS_TO_MAIN = ['desktop-action', 'register-shortcut'];
const VALID_CHANNELS_FROM_MAIN = ['shortcut-triggered', 'window-state-changed'];

contextBridge.revealInMainWorld('nexalinkDesktop', {
  sendAction: (channel, data) => {
    if (VALID_CHANNELS_TO_MAIN.includes(channel)) {
      ipcRenderer.send(channel, data);
    } else {
      console.warn(`[Preload] Blocked unauthorized IPC channel send: ${channel}`);
    }
  },
  onEvent: (channel, callback) => {
    if (VALID_CHANNELS_FROM_MAIN.includes(channel)) {
      // Strip the electron event object to prevent exposing privileged internals to the client
      const subscription = (_event, ...args) => callback(...args);
      ipcRenderer.on(channel, subscription);
      return () => {
        ipcRenderer.removeListener(channel, subscription);
      };
    } else {
      console.warn(`[Preload] Blocked unauthorized IPC event listener registration: ${channel}`);
      return () => {};
    }
  }
});
