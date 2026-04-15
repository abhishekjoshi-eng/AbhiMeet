const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('abhimeet', {
    // Recording controls
    startRecording: (options) => ipcRenderer.invoke('start-recording', options),
    stopRecording: () => ipcRenderer.invoke('stop-recording'),
    getRecordingStatus: () => ipcRenderer.invoke('get-recording-status'),

    // Chunk streaming (renderer -> main)
    sendAudioChunk: (data) => ipcRenderer.send('audio-chunk', data),
    sendScreenChunk: (data) => ipcRenderer.send('screen-chunk', data),
    recordingStopped: (data) => ipcRenderer.send('recording-stopped', data),

    // Recordings management
    listRecordings: () => ipcRenderer.invoke('list-recordings'),
    getRecording: (id) => ipcRenderer.invoke('get-recording', id),
    deleteRecording: (id) => ipcRenderer.invoke('delete-recording', id),
    openRecordingFolder: (id) => ipcRenderer.invoke('open-recording-folder', id),
    setRecordingTitle: (id, title) => ipcRenderer.invoke('set-recording-title', id, title),

    // Settings
    getSettings: () => ipcRenderer.invoke('get-settings'),
    updateSettings: (settings) => ipcRenderer.invoke('update-settings', settings),
    selectFolder: () => ipcRenderer.invoke('select-folder'),

    // Events from main process
    onRecordingStatus: (callback) => {
        ipcRenderer.on('recording-status', (_, data) => callback(data));
    },
    onRecordingTime: (callback) => {
        ipcRenderer.on('recording-time', (_, data) => callback(data));
    },
    onProcessingStatus: (callback) => {
        ipcRenderer.on('processing-status', (_, data) => callback(data));
    },

    // Get desktop sources for screen capture
    getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),

    // App info
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
});
