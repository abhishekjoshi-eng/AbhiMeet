/**
 * AbhiMeet - File management for recordings.
 * Handles directory creation, naming, metadata, and file operations.
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

/**
 * Generate a recording folder name: YYYY-MM-DD_Title_HHmmss
 */
function generateRecordingId(title = 'Meeting') {
    const now = new Date();
    const date = now.toISOString().split('T')[0];
    const time = now.toTimeString().split(' ')[0].replace(/:/g, '');
    const safeTitle = title.replace(/[^a-zA-Z0-9\u0900-\u097F\u0A80-\u0AFF\u0980-\u09FF -]/g, '').replace(/\s+/g, '-');
    return `${date}_${safeTitle}_${time}`;
}

/**
 * Create a recording directory and return its path.
 */
function createRecordingDir(storagePath, title = 'Meeting') {
    const recordingId = generateRecordingId(title);
    const dirPath = path.join(storagePath, recordingId);
    fs.mkdirSync(dirPath, { recursive: true });
    return { recordingId, dirPath };
}

/**
 * Write metadata.json for a recording.
 */
function writeMetadata(dirPath, metadata) {
    const metaPath = path.join(dirPath, 'metadata.json');
    metadata.updated_at = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');
}

/**
 * Read metadata.json from a recording directory.
 */
function readMetadata(dirPath) {
    const metaPath = path.join(dirPath, 'metadata.json');
    if (!fs.existsSync(metaPath)) return null;
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
}

/**
 * List all recordings from storage path.
 */
function listRecordings(storagePath) {
    if (!fs.existsSync(storagePath)) return [];

    const entries = fs.readdirSync(storagePath, { withFileTypes: true });
    const recordings = [];

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dirPath = path.join(storagePath, entry.name);
        const meta = readMetadata(dirPath);
        if (meta) {
            meta.has_transcription = fs.existsSync(path.join(dirPath, 'transcription.md'));
            meta.has_summary = fs.existsSync(path.join(dirPath, 'summary.md'));
            meta.has_report = fs.existsSync(path.join(dirPath, 'report.md'));
            recordings.push(meta);
        }
    }

    // Sort newest first
    recordings.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return recordings;
}

/**
 * Delete a recording directory.
 */
function deleteRecording(storagePath, recordingId) {
    const dirPath = path.join(storagePath, recordingId);
    if (!fs.existsSync(dirPath)) return false;
    fs.rmSync(dirPath, { recursive: true, force: true });
    return true;
}

/**
 * Get the FFmpeg binary path (bundled or system).
 */
function getFFmpegPath() {
    const bundled = path.join(__dirname, '..', '..', 'ffmpeg', 'ffmpeg.exe');
    if (fs.existsSync(bundled)) return bundled;

    // Try system ffmpeg
    return 'ffmpeg';
}

/**
 * Convert WebM audio to MP3 using FFmpeg.
 * Returns a promise that resolves with the output path.
 */
function convertToMp3(inputPath, outputPath, quality = '128k') {
    return new Promise((resolve, reject) => {
        const ffmpeg = getFFmpegPath();
        const args = [
            '-i', inputPath,
            '-b:a', quality,
            '-ar', '44100',
            '-ac', '1', // mono for speech (saves space)
            '-y', // overwrite
            outputPath
        ];

        execFile(ffmpeg, args, (error, stdout, stderr) => {
            if (error) {
                console.error('FFmpeg error:', stderr);
                reject(error);
            } else {
                resolve(outputPath);
            }
        });
    });
}

/**
 * Merge two audio files using FFmpeg (mic + system audio).
 */
function mergeAudioFiles(micPath, systemPath, outputPath, quality = '128k') {
    return new Promise((resolve, reject) => {
        const ffmpeg = getFFmpegPath();
        const args = [
            '-i', micPath,
            '-i', systemPath,
            '-filter_complex', 'amix=inputs=2:duration=longest',
            '-b:a', quality,
            '-ar', '44100',
            '-ac', '1',
            '-y',
            outputPath
        ];

        execFile(ffmpeg, args, (error, stdout, stderr) => {
            if (error) {
                console.error('FFmpeg merge error:', stderr);
                reject(error);
            } else {
                resolve(outputPath);
            }
        });
    });
}

/**
 * Calculate file size in MB.
 */
function getFileSizeMB(filePath) {
    if (!fs.existsSync(filePath)) return 0;
    return Math.round(fs.statSync(filePath).size / (1024 * 1024) * 100) / 100;
}

module.exports = {
    generateRecordingId,
    createRecordingDir,
    writeMetadata,
    readMetadata,
    listRecordings,
    deleteRecording,
    getFFmpegPath,
    convertToMp3,
    mergeAudioFiles,
    getFileSizeMB,
};
