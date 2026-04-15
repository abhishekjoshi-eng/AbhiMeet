/**
 * AbhiMeet - System tray management.
 */

const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');

let tray = null;

function createTray(mainWindow, store) {
    // Create a simple 16x16 tray icon programmatically (no external file needed)
    const iconPath = path.join(__dirname, '..', '..', 'assets', 'icon.svg');

    // Use a default small icon if asset doesn't exist
    let icon;
    try {
        icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
    } catch {
        // Create a simple colored square as fallback
        icon = nativeImage.createEmpty();
    }

    tray = new Tray(icon);
    tray.setToolTip('AbhiMeet - Meeting Recorder');

    updateTrayMenu(mainWindow, false);

    tray.on('double-click', () => {
        mainWindow.show();
        mainWindow.focus();
    });

    return tray;
}

function updateTrayMenu(mainWindow, isRecording) {
    if (!tray) return;

    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'AbhiMeet',
            enabled: false,
        },
        { type: 'separator' },
        {
            label: isRecording ? '⏹ Stop Recording' : '🎙 Start Recording',
            click: () => {
                mainWindow.show();
                mainWindow.webContents.send('tray-toggle-recording');
            },
        },
        { type: 'separator' },
        {
            label: 'Show Window',
            click: () => {
                mainWindow.show();
                mainWindow.focus();
            },
        },
        {
            label: 'Quit',
            click: () => {
                app.isQuitting = true;
                app.quit();
            },
        },
    ]);

    tray.setContextMenu(contextMenu);
}

module.exports = { createTray, updateTrayMenu };
