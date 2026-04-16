const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('abhimeet', {
    // Recording
    startRecording: (opts) => ipcRenderer.invoke('start-recording', opts),
    stopRecording: () => ipcRenderer.invoke('stop-recording'),
    sendAudioChunk: (buf) => ipcRenderer.send('audio-chunk', buf),
    sendScreenChunk: (buf) => ipcRenderer.send('screen-chunk', buf),
    getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),

    // Recordings management
    listRecordings: () => ipcRenderer.invoke('list-recordings'),
    getRecording: (id) => ipcRenderer.invoke('get-recording', id),
    deleteRecording: (id) => ipcRenderer.invoke('delete-recording', id),
    openFolder: (id) => ipcRenderer.invoke('open-recording-folder', id),
    getFileUrl: (id, filename) => ipcRenderer.invoke('get-file-url', id, filename),

    // Transcription
    readTranscription: (id) => ipcRenderer.invoke('read-transcription', id),

    // Settings
    getSettings: () => ipcRenderer.invoke('get-settings'),
    updateSettings: (s) => ipcRenderer.invoke('update-settings', s),
    selectFolder: () => ipcRenderer.invoke('select-folder'),

    // Events from main process
    onRecordingTime: (cb) => ipcRenderer.on('recording-time', cb),
    onProcessingStatus: (cb) => ipcRenderer.on('processing-status', cb),
});
