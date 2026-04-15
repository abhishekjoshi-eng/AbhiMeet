/**
 * AbhiMeet v2 - File management.
 * Directory creation, FFmpeg conversion, audio+video merge.
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

/**
 * Naming convention: Subject_DDMMYY_HHMMam
 * Files inside: Subject_Audio_DDMMYY_HHMMam.mp3
 *               Subject_Video_DDMMYY_HHMMam.webm
 *               Subject_AV_DDMMYY_HHMMam.mp4
 */
function formatDateStamp(now) {
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yy = String(now.getFullYear()).slice(-2);
    return `${dd}${mm}${yy}`;
}

function formatTimeStamp(now) {
    let h = now.getHours();
    const m = String(now.getMinutes()).padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${String(h).padStart(2, '0')}${m}${ampm}`;
}

function safeTitle(title) {
    return title.replace(/[^a-zA-Z0-9\u0900-\u097F\u0A80-\u0AFF\u0980-\u09FF -]/g, '').replace(/\s+/g, '-').substring(0, 60) || 'Meeting';
}

function generateRecordingId(title = 'Meeting') {
    const now = new Date();
    return `${safeTitle(title)}_${formatDateStamp(now)}_${formatTimeStamp(now)}`;
}

/** Generate proper file names: Subject_Type_DDMMYY_HHMMam.ext */
function generateFileName(title, type, ext, dateObj) {
    const now = dateObj || new Date();
    const prefix = safeTitle(title);
    const date = formatDateStamp(now);
    const time = formatTimeStamp(now);
    return `${prefix}_${type}_${date}_${time}.${ext}`;
}

function createRecordingDir(storagePath, title) {
    const recordingId = generateRecordingId(title);
    const dirPath = path.join(storagePath, recordingId);
    fs.mkdirSync(dirPath, { recursive: true });
    return { recordingId, dirPath };
}

function writeMetadata(dirPath, metadata) {
    metadata.updated_at = new Date().toISOString();
    fs.writeFileSync(path.join(dirPath, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf-8');
}

function readMetadata(dirPath) {
    const p = path.join(dirPath, 'metadata.json');
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function listRecordings(storagePath) {
    if (!fs.existsSync(storagePath)) return [];
    const entries = fs.readdirSync(storagePath, { withFileTypes: true });
    const recs = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const meta = readMetadata(path.join(storagePath, entry.name));
        if (meta) {
            meta.has_transcription = fs.existsSync(path.join(storagePath, entry.name, 'transcription.md'));
            meta.has_summary = fs.existsSync(path.join(storagePath, entry.name, 'summary.md'));
            recs.push(meta);
        }
    }
    recs.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return recs;
}

function deleteRecording(storagePath, id) {
    const p = path.join(storagePath, id);
    if (!fs.existsSync(p)) return false;
    fs.rmSync(p, { recursive: true, force: true });
    return true;
}

function getFFmpegPath() {
    const bundled = path.join(__dirname, '..', '..', 'ffmpeg', 'ffmpeg.exe');
    if (fs.existsSync(bundled)) return bundled;
    return 'ffmpeg';
}

/** Convert WebM audio to MP3 */
function convertToMp3(inputPath, outputPath, quality = '128k') {
    return new Promise((resolve, reject) => {
        execFile(getFFmpegPath(), ['-i', inputPath, '-b:a', quality, '-ar', '44100', '-ac', '1', '-y', outputPath],
            (err, _, stderr) => err ? reject(new Error(stderr || err.message)) : resolve(outputPath));
    });
}

/** Combine audio + video into a single MP4 file */
function combineAudioVideo(audioPath, videoPath, outputPath) {
    return new Promise((resolve, reject) => {
        // Re-encode video to H.264 + AAC audio for universal MP4 compatibility
        execFile(getFFmpegPath(), [
            '-i', videoPath,
            '-i', audioPath,
            '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
            '-c:a', 'aac', '-b:a', '128k',
            '-map', '0:v:0',
            '-map', '1:a:0',
            '-shortest',
            '-movflags', '+faststart',
            '-y', outputPath
        ], { timeout: 300000 }, // 5 min timeout for long recordings
        (err, _, stderr) => err ? reject(new Error(stderr || err.message)) : resolve(outputPath));
    });
}

function fileSize(filePath) {
    if (!fs.existsSync(filePath)) return 0;
    return fs.statSync(filePath).size;
}

module.exports = {
    generateRecordingId, generateFileName, createRecordingDir, writeMetadata, readMetadata,
    listRecordings, deleteRecording, getFFmpegPath,
    convertToMp3, combineAudioVideo, fileSize,
};
