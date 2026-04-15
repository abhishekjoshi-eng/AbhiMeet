/**
 * AbhiMeet v2 - IPC Handlers.
 * Generates 3 output files: audio.mp3, video.webm, combined.mp4
 */
const { ipcMain, dialog, shell, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const { getSettings, updateSettings, ensureStorageDir } = require('./settings');
const {
    createRecordingDir, generateFileName, writeMetadata, listRecordings, deleteRecording,
    convertToMp3, combineAudioVideo, fileSize,
} = require('./file-manager');
const { updateTrayMenu } = require('./tray');

let currentRecording = null;
let recordingStartTime = null;
let recordingTimer = null;

function setupIpcHandlers(mainWindow, store) {
    ensureStorageDir(store);

    // ── Start Recording ──
    ipcMain.handle('start-recording', async (_, options = {}) => {
        const storagePath = store.get('storagePath');
        const title = options.title || 'Meeting';
        const { recordingId, dirPath } = createRecordingDir(storagePath, title);

        currentRecording = {
            id: recordingId, dirPath, title,
            startTime: new Date(),
            hasAudio: !!options.recordAudio,
            hasScreen: !!options.recordScreen,
            audioWriteStream: null,
            screenWriteStream: null,
        };

        if (options.recordAudio) {
            currentRecording.audioWriteStream = fs.createWriteStream(path.join(dirPath, 'raw_audio.webm'));
        }
        if (options.recordScreen) {
            currentRecording.screenWriteStream = fs.createWriteStream(path.join(dirPath, 'raw_screen.webm'));
        }

        recordingStartTime = Date.now();
        recordingTimer = setInterval(() => {
            const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
            mainWindow.webContents.send('recording-time', { elapsed });
        }, 1000);

        updateTrayMenu(mainWindow, true);
        return { success: true, recordingId, dirPath };
    });

    // ── Stop Recording → produce 3 files ──
    ipcMain.handle('stop-recording', async () => {
        if (!currentRecording) return { success: false, error: 'No active recording' };

        clearInterval(recordingTimer);
        updateTrayMenu(mainWindow, false);

        const rec = currentRecording;
        currentRecording = null;
        const duration = Math.floor((Date.now() - recordingStartTime) / 1000);
        recordingStartTime = null;

        // Close write streams
        await closeStream(rec.audioWriteStream);
        await closeStream(rec.screenWriteStream);

        const rawAudio = path.join(rec.dirPath, 'raw_audio.webm');
        const rawScreen = path.join(rec.dirPath, 'raw_screen.webm');
        const quality = store.get('audioQuality') || '128k';

        // Generate proper file names: Subject_Type_DDMMYY_HHMMam.ext
        const audioName = generateFileName(rec.title, 'Audio', 'mp3', rec.startTime);
        const videoName = generateFileName(rec.title, 'Video', 'webm', rec.startTime);
        const combinedName = generateFileName(rec.title, 'AV', 'mp4', rec.startTime);
        const mp3Path = path.join(rec.dirPath, audioName);
        const videoPath = path.join(rec.dirPath, videoName);
        const combinedPath = path.join(rec.dirPath, combinedName);

        const metadata = {
            id: rec.id, title: rec.title,
            date: rec.startTime.toISOString(),
            duration_seconds: duration,
            duration_formatted: formatDuration(duration),
            files: {},
            transcription: { exists: false },
            summary: { exists: false },
            report: { exists: false },
            created_at: rec.startTime.toISOString(),
        };

        // ── FILE 1: Subject_Audio_DDMMYY_HHMMam.mp3 ──
        if (rec.hasAudio && fs.existsSync(rawAudio) && fileSize(rawAudio) > 0) {
            mainWindow.webContents.send('processing-status', { status: 'processing', message: 'Converting audio to MP3...' });
            try {
                await convertToMp3(rawAudio, mp3Path, quality);
                metadata.files.audio = {
                    filename: audioName,
                    size_bytes: fileSize(mp3Path),
                    format: 'mp3', bitrate: quality,
                };
            } catch (err) {
                console.error('MP3 conversion failed:', err.message);
                const fallbackName = generateFileName(rec.title, 'Audio', 'webm', rec.startTime);
                const fallback = path.join(rec.dirPath, fallbackName);
                fs.renameSync(rawAudio, fallback);
                metadata.files.audio = { filename: fallbackName, size_bytes: fileSize(fallback), format: 'webm' };
            }
        }

        // ── FILE 2: Subject_Video_DDMMYY_HHMMam.webm ──
        if (rec.hasScreen && fs.existsSync(rawScreen) && fileSize(rawScreen) > 0) {
            mainWindow.webContents.send('processing-status', { status: 'processing', message: 'Finalizing video...' });
            fs.renameSync(rawScreen, videoPath);
            metadata.files.video = {
                filename: videoName,
                size_bytes: fileSize(videoPath),
                format: 'webm',
            };
        }

        // ── FILE 3: combined.mp4 (audio + video merged) ──
        const audioForMerge = fs.existsSync(mp3Path) ? mp3Path : (fs.existsSync(rawAudio) ? rawAudio : null);
        if (audioForMerge && fs.existsSync(videoPath)) {
            mainWindow.webContents.send('processing-status', { status: 'processing', message: 'Merging audio + video...' });
            try {
                await combineAudioVideo(audioForMerge, videoPath, combinedPath);
                metadata.files.combined = {
                    filename: combinedName,
                    size_bytes: fileSize(combinedPath),
                    format: 'mp4',
                };
            } catch (err) {
                console.error('Combine failed:', err.message);
                // Not critical - user still has separate audio and video
            }
        }

        // Cleanup raw files
        try { if (fs.existsSync(rawAudio)) fs.unlinkSync(rawAudio); } catch {}
        try { if (fs.existsSync(rawScreen)) fs.unlinkSync(rawScreen); } catch {}

        writeMetadata(rec.dirPath, metadata);
        mainWindow.webContents.send('processing-status', { status: 'done', message: 'Recording saved!' });
        return { success: true, recordingId: rec.id, duration, metadata };
    });

    // ── Audio/Screen Chunks ──
    ipcMain.on('audio-chunk', (_, data) => {
        if (currentRecording?.audioWriteStream) currentRecording.audioWriteStream.write(Buffer.from(data));
    });
    ipcMain.on('screen-chunk', (_, data) => {
        if (currentRecording?.screenWriteStream) currentRecording.screenWriteStream.write(Buffer.from(data));
    });

    // ── Recordings Management ──
    ipcMain.handle('list-recordings', () => listRecordings(store.get('storagePath')));

    ipcMain.handle('get-recording', (_, id) => {
        const metaPath = path.join(store.get('storagePath'), id, 'metadata.json');
        if (!fs.existsSync(metaPath)) return null;
        return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    });

    ipcMain.handle('delete-recording', (_, id) => deleteRecording(store.get('storagePath'), id));

    ipcMain.handle('open-recording-folder', (_, id) => {
        const dirPath = path.join(store.get('storagePath'), id);
        if (fs.existsSync(dirPath)) { shell.openPath(dirPath); return true; }
        // If no id, open the storage root
        shell.openPath(store.get('storagePath'));
        return true;
    });

    // ── File URL for playback ──
    ipcMain.handle('get-file-url', (_, recordingId, filename) => {
        const filePath = path.join(store.get('storagePath'), recordingId, filename);
        if (!fs.existsSync(filePath)) return null;
        const urlPath = filePath.replace(/\\/g, '/');
        return `file:///${urlPath}`;
    });

    // ── Desktop Sources ──
    ipcMain.handle('get-desktop-sources', async () => {
        const sources = await desktopCapturer.getSources({
            types: ['screen', 'window'],
            thumbnailSize: { width: 150, height: 100 },
        });
        return sources.map(s => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL() }));
    });

    // ── Settings ──
    ipcMain.handle('get-settings', () => getSettings(store));
    ipcMain.handle('update-settings', (_, settings) => updateSettings(store, settings));
    ipcMain.handle('select-folder', async () => {
        const result = await dialog.showOpenDialog({ properties: ['openDirectory'], title: 'Select Recording Folder' });
        if (!result.canceled && result.filePaths.length > 0) return result.filePaths[0];
        return null;
    });

    ipcMain.handle('get-recording-status', () => {
        if (!currentRecording) return { recording: false };
        return { recording: true, recordingId: currentRecording.id, elapsed: Math.floor((Date.now() - recordingStartTime) / 1000) };
    });
}

function closeStream(stream) {
    return new Promise(resolve => {
        if (!stream) return resolve();
        stream.end(() => resolve());
    });
}

function formatDuration(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
}

module.exports = { setupIpcHandlers };
