/**
 * AbhiMeet - IPC Handlers between main and renderer process.
 */

const { ipcMain, dialog, shell, desktopCapturer, app } = require('electron');
const path = require('path');
const fs = require('fs');
const { getSettings, updateSettings, ensureStorageDir } = require('./settings');
const {
    createRecordingDir,
    writeMetadata,
    listRecordings,
    deleteRecording,
    convertToMp3,
    mergeAudioFiles,
    getFileSizeMB,
    getFFmpegPath,
} = require('./file-manager');
const { updateTrayMenu } = require('./tray');

let currentRecording = null;
let recordingStartTime = null;
let recordingTimer = null;

function setupIpcHandlers(mainWindow, store) {
    // Ensure storage directory exists on startup
    ensureStorageDir(store);

    // ── Recording Controls ──────────────────────────────────────────────

    ipcMain.handle('start-recording', async (_, options = {}) => {
        const storagePath = store.get('storagePath');
        const title = options.title || 'Meeting';
        const { recordingId, dirPath } = createRecordingDir(storagePath, title);

        currentRecording = {
            id: recordingId,
            dirPath,
            title,
            startTime: new Date(),
            micChunks: [],
            systemChunks: [],
            screenChunks: [],
            audioWriteStream: null,
            screenWriteStream: null,
        };

        // Create write streams for chunked recording
        currentRecording.audioWriteStream = fs.createWriteStream(path.join(dirPath, 'raw_audio.webm'));
        const recordScreen = options.recordScreen ?? store.get('recordScreen');
        if (recordScreen) {
            currentRecording.screenWriteStream = fs.createWriteStream(path.join(dirPath, 'screen.webm'));
        }

        recordingStartTime = Date.now();

        // Send elapsed time every second
        recordingTimer = setInterval(() => {
            const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
            mainWindow.webContents.send('recording-time', { elapsed });
        }, 1000);

        updateTrayMenu(mainWindow, true);

        return { success: true, recordingId, dirPath };
    });

    ipcMain.handle('stop-recording', async () => {
        if (!currentRecording) {
            return { success: false, error: 'No active recording' };
        }

        clearInterval(recordingTimer);
        updateTrayMenu(mainWindow, false);

        const recording = currentRecording;
        currentRecording = null;

        // Close write streams
        if (recording.audioWriteStream) {
            recording.audioWriteStream.end();
        }
        if (recording.screenWriteStream) {
            recording.screenWriteStream.end();
        }

        const duration = Math.floor((Date.now() - recordingStartTime) / 1000);
        recordingStartTime = null;

        mainWindow.webContents.send('processing-status', { status: 'processing', message: 'Converting audio...' });

        // Post-process: convert to MP3
        const rawAudioPath = path.join(recording.dirPath, 'raw_audio.webm');
        const mp3Path = path.join(recording.dirPath, 'audio.mp3');
        const quality = store.get('audioQuality') || '128k';

        let audioConverted = false;
        try {
            if (fs.existsSync(rawAudioPath) && fs.statSync(rawAudioPath).size > 0) {
                await convertToMp3(rawAudioPath, mp3Path, quality);
                audioConverted = true;
                // Clean up raw file to save space
                fs.unlinkSync(rawAudioPath);
            }
        } catch (err) {
            console.error('FFmpeg conversion failed:', err.message);
            // Keep raw WebM as fallback if conversion fails
            if (fs.existsSync(rawAudioPath)) {
                const fallbackPath = path.join(recording.dirPath, 'audio.webm');
                fs.renameSync(rawAudioPath, fallbackPath);
            }
        }

        // Write metadata
        const metadata = {
            id: recording.id,
            title: recording.title,
            date: recording.startTime.toISOString(),
            duration_seconds: duration,
            duration_formatted: formatDuration(duration),
            files: {},
            transcription: { exists: false },
            summary: { exists: false },
            report: { exists: false },
            created_at: recording.startTime.toISOString(),
        };

        if (audioConverted && fs.existsSync(mp3Path)) {
            metadata.files.audio = {
                filename: 'audio.mp3',
                size_bytes: fs.statSync(mp3Path).size,
                format: 'mp3',
                bitrate: quality,
            };
        } else {
            const webmPath = path.join(recording.dirPath, 'audio.webm');
            if (fs.existsSync(webmPath)) {
                metadata.files.audio = {
                    filename: 'audio.webm',
                    size_bytes: fs.statSync(webmPath).size,
                    format: 'webm',
                };
            }
        }

        const screenPath = path.join(recording.dirPath, 'screen.webm');
        if (fs.existsSync(screenPath) && fs.statSync(screenPath).size > 0) {
            metadata.files.screen = {
                filename: 'screen.webm',
                size_bytes: fs.statSync(screenPath).size,
                format: 'webm',
            };
        }

        writeMetadata(recording.dirPath, metadata);

        mainWindow.webContents.send('processing-status', { status: 'done', message: 'Recording saved!' });

        return { success: true, recordingId: recording.id, duration, metadata };
    });

    ipcMain.handle('get-recording-status', () => {
        if (!currentRecording) return { recording: false };
        return {
            recording: true,
            recordingId: currentRecording.id,
            elapsed: Math.floor((Date.now() - recordingStartTime) / 1000),
        };
    });

    // ── Audio/Screen Chunk Handlers ─────────────────────────────────────

    ipcMain.on('audio-chunk', (_, data) => {
        if (currentRecording && currentRecording.audioWriteStream) {
            currentRecording.audioWriteStream.write(Buffer.from(data));
        }
    });

    ipcMain.on('screen-chunk', (_, data) => {
        if (currentRecording && currentRecording.screenWriteStream) {
            currentRecording.screenWriteStream.write(Buffer.from(data));
        }
    });

    // Handle recording data from renderer when MediaRecorder stops
    ipcMain.on('recording-stopped', (_, data) => {
        // This is a fallback for when chunks are sent as complete blobs
    });

    // ── Recordings Management ───────────────────────────────────────────

    ipcMain.handle('list-recordings', () => {
        const storagePath = store.get('storagePath');
        return listRecordings(storagePath);
    });

    ipcMain.handle('get-recording', (_, id) => {
        const storagePath = store.get('storagePath');
        const dirPath = path.join(storagePath, id);
        const metaPath = path.join(dirPath, 'metadata.json');
        if (!fs.existsSync(metaPath)) return null;
        return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    });

    ipcMain.handle('delete-recording', (_, id) => {
        const storagePath = store.get('storagePath');
        return deleteRecording(storagePath, id);
    });

    ipcMain.handle('open-recording-folder', (_, id) => {
        const storagePath = store.get('storagePath');
        const dirPath = path.join(storagePath, id);
        if (fs.existsSync(dirPath)) {
            shell.openPath(dirPath);
            return true;
        }
        return false;
    });

    ipcMain.handle('set-recording-title', (_, id, title) => {
        const storagePath = store.get('storagePath');
        const dirPath = path.join(storagePath, id);
        const metaPath = path.join(dirPath, 'metadata.json');
        if (!fs.existsSync(metaPath)) return false;
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        meta.title = title;
        meta.updated_at = new Date().toISOString();
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
        return true;
    });

    // ── Settings ────────────────────────────────────────────────────────

    ipcMain.handle('get-settings', () => {
        return getSettings(store);
    });

    ipcMain.handle('update-settings', (_, settings) => {
        return updateSettings(store, settings);
    });

    ipcMain.handle('select-folder', async () => {
        const result = await dialog.showOpenDialog({
            properties: ['openDirectory'],
            title: 'Select Recording Storage Folder',
        });
        if (!result.canceled && result.filePaths.length > 0) {
            return result.filePaths[0];
        }
        return null;
    });

    // ── Desktop Sources ─────────────────────────────────────────────────

    ipcMain.handle('get-desktop-sources', async () => {
        const sources = await desktopCapturer.getSources({
            types: ['screen', 'window'],
            thumbnailSize: { width: 150, height: 100 },
        });
        return sources.map(s => ({
            id: s.id,
            name: s.name,
            thumbnail: s.thumbnail.toDataURL(),
        }));
    });

    // ── App Info ────────────────────────────────────────────────────────

    ipcMain.handle('get-app-version', () => {
        return app.getVersion();
    });
}

function formatDuration(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [hours, minutes, seconds].map(v => String(v).padStart(2, '0')).join(':');
}

module.exports = { setupIpcHandlers };
