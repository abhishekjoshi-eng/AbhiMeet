const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, shell } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { setupIpcHandlers } = require('./ipc-handlers');
const { createTray } = require('./tray');

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
}

const store = new Store({
    defaults: {
        storagePath: path.join('D:', 'Calude Code Abhishek', 'AbhiMeet-Recordings'),
        defaultStoragePath: path.join(__dirname, '..', '..', 'recordings'),
        audioQuality: '128k',
        recordScreen: true,
        recordMicrophone: true,
        recordSystemAudio: true,
        audioFormat: 'mp3',
        minimizeToTray: true,
        windowBounds: { width: 900, height: 680 }
    }
});

let mainWindow = null;
let tray = null;
let isRecording = false;

function createWindow() {
    const bounds = store.get('windowBounds');

    mainWindow = new BrowserWindow({
        width: bounds.width,
        height: bounds.height,
        minWidth: 750,
        minHeight: 550,
        title: 'AbhiMeet',
        icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
        webPreferences: {
            preload: path.join(__dirname, '..', 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
        show: false,
        backgroundColor: '#0f172a',
    });

    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    mainWindow.on('close', (e) => {
        if (store.get('minimizeToTray') && !app.isQuitting) {
            e.preventDefault();
            mainWindow.hide();
        }
    });

    mainWindow.on('resize', () => {
        const { width, height } = mainWindow.getBounds();
        store.set('windowBounds', { width, height });
    });
}

app.whenReady().then(() => {
    createWindow();
    tray = createTray(mainWindow, store);
    setupIpcHandlers(mainWindow, store);
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

app.on('second-instance', () => {
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
    }
});

app.on('before-quit', () => {
    app.isQuitting = true;
});

module.exports = { getMainWindow: () => mainWindow, getStore: () => store };
