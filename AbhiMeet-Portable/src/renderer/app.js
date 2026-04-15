/**
 * AbhiMeet - Main renderer UI logic.
 * Handles navigation, recording controls, recordings list, and settings.
 */

// ═══════════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════════

let isRecording = false;
let audioContext = null;
let micStream = null;
let screenStream = null;
let mediaRecorder = null;        // audio MediaRecorder
let screenRecorder = null;       // screen MediaRecorder
let audioAnalyser = null;
let levelAnimFrame = null;

// ═══════════════════════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════════════════════

document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
        const panelId = btn.dataset.panel;

        // Update nav
        document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Update panels
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        document.getElementById(`panel-${panelId}`).classList.add('active');

        // Load data for panel
        if (panelId === 'recordings') loadRecordings();
        if (panelId === 'settings') loadSettings();
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// RECORDER
// ═══════════════════════════════════════════════════════════════════════════

const recordBtn = document.getElementById('recordBtn');
const recordLabel = document.getElementById('recordLabel');
const timerDisplay = document.getElementById('timerDisplay');
const timerValue = timerDisplay.querySelector('.timer-value');
const levelMeterContainer = document.getElementById('levelMeterContainer');
const levelBar = document.getElementById('levelBar');
const statusBar = document.getElementById('statusBar');
const statusText = document.getElementById('statusText');

recordBtn.addEventListener('click', async () => {
    if (isRecording) {
        await stopRecording();
    } else {
        await startRecording();
    }
});

async function startRecording() {
    const optMic = document.getElementById('optMic').checked;
    const optSystemAudio = document.getElementById('optSystemAudio').checked;
    const optScreen = document.getElementById('optScreen').checked;
    const title = document.getElementById('meetingTitle').value.trim() || 'Meeting';

    setStatus('Initializing...', 'processing');

    try {
        // Start recording on main process (creates directory)
        const result = await window.abhimeet.startRecording({
            title,
            recordMic: optMic,
            recordSystemAudio: optSystemAudio,
            recordScreen: optScreen,
        });

        if (!result.success) {
            setStatus('Failed to start: ' + (result.error || 'Unknown error'), 'error');
            return;
        }

        const streams = [];

        // Get microphone stream
        if (optMic) {
            try {
                micStream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true,
                    },
                    video: false,
                });
                streams.push(micStream);
            } catch (err) {
                console.warn('Microphone access denied:', err);
                setStatus('Microphone not available - recording without mic', 'error');
            }
        }

        // Get screen + system audio stream
        if (optScreen || optSystemAudio) {
            try {
                const sources = await window.abhimeet.getDesktopSources();
                const screenSource = sources.find(s => s.id.startsWith('screen:')) || sources[0];

                if (screenSource) {
                    const constraints = {
                        audio: optSystemAudio ? {
                            mandatory: {
                                chromeMediaSource: 'desktop',
                            }
                        } : false,
                        video: optScreen ? {
                            mandatory: {
                                chromeMediaSource: 'desktop',
                                chromeMediaSourceId: screenSource.id,
                                maxFrameRate: 15,
                            }
                        } : false,
                    };

                    screenStream = await navigator.mediaDevices.getUserMedia(constraints);
                    streams.push(screenStream);
                }
            } catch (err) {
                console.warn('Screen/system audio capture failed:', err);
                setStatus('Screen capture not available', 'error');
            }
        }

        if (streams.length === 0) {
            setStatus('No audio/video sources available', 'error');
            await window.abhimeet.stopRecording();
            return;
        }

        // Combine audio tracks from all streams
        const audioTracks = [];
        streams.forEach(s => {
            s.getAudioTracks().forEach(t => audioTracks.push(t));
        });

        // Create combined audio stream for recording
        if (audioTracks.length > 0) {
            audioContext = new AudioContext();
            const destination = audioContext.createMediaStreamDestination();

            audioTracks.forEach(track => {
                const source = audioContext.createMediaStreamSource(new MediaStream([track]));
                source.connect(destination);
            });

            // Set up level meter
            if (micStream) {
                audioAnalyser = audioContext.createAnalyser();
                audioAnalyser.fftSize = 256;
                const micSource = audioContext.createMediaStreamSource(micStream);
                micSource.connect(audioAnalyser);
                levelMeterContainer.style.display = 'flex';
                updateLevelMeter();
            }

            // Record mixed audio
            mediaRecorder = new MediaRecorder(destination.stream, {
                mimeType: getSupportedMimeType('audio'),
            });

            mediaRecorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) {
                    e.data.arrayBuffer().then(buffer => {
                        window.abhimeet.sendAudioChunk(buffer);
                    });
                }
            };

            mediaRecorder.start(5000); // Chunk every 5 seconds
        }

        // Record screen video separately
        if (optScreen && screenStream && screenStream.getVideoTracks().length > 0) {
            const videoStream = new MediaStream(screenStream.getVideoTracks());

            screenRecorder = new MediaRecorder(videoStream, {
                mimeType: getSupportedMimeType('video'),
                videoBitsPerSecond: 1000000, // 1 Mbps - space efficient
            });

            screenRecorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) {
                    e.data.arrayBuffer().then(buffer => {
                        window.abhimeet.sendScreenChunk(buffer);
                    });
                }
            };

            screenRecorder.start(5000);
        }

        // Update UI
        isRecording = true;
        recordBtn.classList.add('recording');
        recordLabel.textContent = 'Recording...';
        recordLabel.classList.add('recording');
        timerDisplay.classList.add('recording');
        document.getElementById('meetingTitle').disabled = true;
        setStatus('Recording in progress', '');

        // Disable toggle options during recording
        document.querySelectorAll('.recording-options input').forEach(el => el.disabled = true);

    } catch (err) {
        console.error('Recording start failed:', err);
        setStatus('Error: ' + err.message, 'error');
    }
}

async function stopRecording() {
    setStatus('Stopping...', 'processing');

    // Stop media recorders
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
    if (screenRecorder && screenRecorder.state !== 'inactive') {
        screenRecorder.stop();
    }

    // Stop all streams
    if (micStream) {
        micStream.getTracks().forEach(t => t.stop());
        micStream = null;
    }
    if (screenStream) {
        screenStream.getTracks().forEach(t => t.stop());
        screenStream = null;
    }

    // Stop audio context
    if (audioContext) {
        await audioContext.close();
        audioContext = null;
    }

    // Stop level meter
    if (levelAnimFrame) {
        cancelAnimationFrame(levelAnimFrame);
        levelAnimFrame = null;
    }
    levelMeterContainer.style.display = 'none';
    audioAnalyser = null;

    // Give a brief moment for final chunks to be sent
    await new Promise(r => setTimeout(r, 500));

    // Tell main process to finalize
    const result = await window.abhimeet.stopRecording();

    // Reset UI
    isRecording = false;
    mediaRecorder = null;
    screenRecorder = null;
    recordBtn.classList.remove('recording');
    recordLabel.textContent = 'Click to Start';
    recordLabel.classList.remove('recording');
    timerDisplay.classList.remove('recording');
    timerValue.textContent = '00:00:00';
    document.getElementById('meetingTitle').disabled = false;
    document.getElementById('meetingTitle').value = '';

    // Re-enable toggles
    document.querySelectorAll('.recording-options input').forEach(el => el.disabled = false);

    if (result && result.success) {
        setStatus(`Saved: ${result.recordingId} (${formatDuration(result.duration)})`, '');
    } else {
        setStatus('Recording saved (raw format)', '');
    }
}

function getSupportedMimeType(kind) {
    const audioTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
    ];
    const videoTypes = [
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
    ];

    const types = kind === 'audio' ? audioTypes : videoTypes;
    for (const type of types) {
        if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return undefined;
}

function updateLevelMeter() {
    if (!audioAnalyser) return;

    const data = new Uint8Array(audioAnalyser.frequencyBinCount);
    audioAnalyser.getByteFrequencyData(data);

    const avg = data.reduce((sum, val) => sum + val, 0) / data.length;
    const level = Math.min(100, (avg / 128) * 100);
    levelBar.style.width = level + '%';

    levelAnimFrame = requestAnimationFrame(updateLevelMeter);
}

function setStatus(message, type) {
    statusText.textContent = message;
    statusBar.className = 'status-bar' + (type ? ` ${type}` : '');
}

// Listen for timer updates from main process
window.abhimeet.onRecordingTime(({ elapsed }) => {
    timerValue.textContent = formatDuration(elapsed);
});

// Listen for processing status
window.abhimeet.onProcessingStatus(({ status, message }) => {
    setStatus(message, status === 'done' ? '' : 'processing');
});

// ═══════════════════════════════════════════════════════════════════════════
// RECORDINGS LIST
// ═══════════════════════════════════════════════════════════════════════════

const recordingsList = document.getElementById('recordingsList');
const searchInput = document.getElementById('searchRecordings');
const refreshBtn = document.getElementById('refreshRecordings');

let allRecordings = [];

async function loadRecordings() {
    try {
        allRecordings = await window.abhimeet.listRecordings();
        renderRecordings(allRecordings);
    } catch (err) {
        console.error('Failed to load recordings:', err);
    }
}

function renderRecordings(recordings) {
    if (!recordings || recordings.length === 0) {
        recordingsList.innerHTML = `
            <div class="empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                    <line x1="12" y1="19" x2="12" y2="23"/>
                    <line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
                <p>No recordings yet</p>
                <p class="empty-hint">Start your first recording from the Record tab</p>
            </div>`;
        return;
    }

    recordingsList.innerHTML = recordings.map(rec => {
        const date = rec.date ? new Date(rec.date).toLocaleDateString('en-IN', {
            day: '2-digit', month: 'short', year: 'numeric'
        }) : '';
        const duration = rec.duration_formatted || formatDuration(rec.duration_seconds || 0);
        const audioSize = rec.files?.audio?.size_bytes
            ? formatFileSize(rec.files.audio.size_bytes)
            : '';

        let badge = '';
        if (rec.has_transcription) {
            badge = '<span class="badge badge-transcribed">Transcribed</span>';
        } else {
            badge = '<span class="badge badge-pending">Pending</span>';
        }

        return `
            <div class="recording-card" data-id="${rec.id}">
                <div class="recording-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                    </svg>
                </div>
                <div class="recording-info">
                    <div class="recording-title">${escapeHtml(rec.title || 'Untitled')}</div>
                    <div class="recording-meta">
                        <span>${date}</span>
                        <span>${duration}</span>
                        ${audioSize ? `<span>${audioSize}</span>` : ''}
                    </div>
                </div>
                <div class="recording-badges">${badge}</div>
                <div class="recording-actions">
                    <button class="icon-btn" title="Open Folder" onclick="openFolder('${rec.id}'); event.stopPropagation();">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                        </svg>
                    </button>
                    <button class="icon-btn danger" title="Delete" onclick="deleteRec('${rec.id}'); event.stopPropagation();">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                    </button>
                </div>
            </div>`;
    }).join('');

    // Click to show details
    document.querySelectorAll('.recording-card').forEach(card => {
        card.addEventListener('click', () => showRecordingDetail(card.dataset.id));
    });
}

// Search
searchInput.addEventListener('input', () => {
    const query = searchInput.value.toLowerCase().trim();
    if (!query) {
        renderRecordings(allRecordings);
        return;
    }
    const filtered = allRecordings.filter(r =>
        (r.title || '').toLowerCase().includes(query) ||
        (r.id || '').toLowerCase().includes(query)
    );
    renderRecordings(filtered);
});

refreshBtn.addEventListener('click', loadRecordings);

// Recording detail modal
function showRecordingDetail(id) {
    const rec = allRecordings.find(r => r.id === id);
    if (!rec) return;

    const modal = document.getElementById('recordingModal');
    document.getElementById('modalTitle').textContent = rec.title || 'Recording Details';

    const duration = rec.duration_formatted || formatDuration(rec.duration_seconds || 0);
    const audioFile = rec.files?.audio;
    const screenFile = rec.files?.screen;

    let html = `
        <div class="detail-row"><span class="detail-label">ID</span><span class="detail-value">${rec.id}</span></div>
        <div class="detail-row"><span class="detail-label">Date</span><span class="detail-value">${rec.date ? new Date(rec.date).toLocaleString('en-IN') : 'N/A'}</span></div>
        <div class="detail-row"><span class="detail-label">Duration</span><span class="detail-value">${duration}</span></div>
    `;

    if (audioFile) {
        html += `<div class="detail-row"><span class="detail-label">Audio</span><span class="detail-value">${audioFile.filename} (${formatFileSize(audioFile.size_bytes)})</span></div>`;
    }
    if (screenFile) {
        html += `<div class="detail-row"><span class="detail-label">Screen</span><span class="detail-value">${screenFile.filename} (${formatFileSize(screenFile.size_bytes)})</span></div>`;
    }

    html += `
        <div class="detail-row"><span class="detail-label">Transcription</span><span class="detail-value">${rec.has_transcription ? 'Yes' : 'Not yet'}</span></div>
        <div class="detail-row"><span class="detail-label">Summary</span><span class="detail-value">${rec.has_summary ? 'Yes' : 'Not yet'}</span></div>
    `;

    html += `
        <div class="modal-actions">
            <button class="btn btn-secondary" onclick="openFolder('${rec.id}')">Open Folder</button>
            <button class="btn btn-danger" onclick="deleteRec('${rec.id}'); document.getElementById('recordingModal').style.display='none';">Delete</button>
        </div>
    `;

    document.getElementById('modalBody').innerHTML = html;
    modal.style.display = 'flex';
}

document.getElementById('modalClose').addEventListener('click', () => {
    document.getElementById('recordingModal').style.display = 'none';
});

document.getElementById('recordingModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
        e.currentTarget.style.display = 'none';
    }
});

async function openFolder(id) {
    await window.abhimeet.openRecordingFolder(id);
}

async function deleteRec(id) {
    if (!confirm(`Delete recording "${id}"? This cannot be undone.`)) return;
    await window.abhimeet.deleteRecording(id);
    loadRecordings();
}

// ═══════════════════════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════════════════════

async function loadSettings() {
    const settings = await window.abhimeet.getSettings();
    if (!settings) return;

    document.getElementById('settStoragePath').value = settings.storagePath || '';
    document.getElementById('settAudioQuality').value = settings.audioQuality || '128k';
    document.getElementById('settDefaultMic').checked = settings.recordMicrophone !== false;
    document.getElementById('settDefaultSystem').checked = settings.recordSystemAudio !== false;
    document.getElementById('settDefaultScreen').checked = settings.recordScreen !== false;
    document.getElementById('settMinToTray').checked = settings.minimizeToTray !== false;
}

document.getElementById('settBrowse').addEventListener('click', async () => {
    const folder = await window.abhimeet.selectFolder();
    if (folder) {
        document.getElementById('settStoragePath').value = folder;
        await window.abhimeet.updateSettings({ storagePath: folder });
    }
});

document.getElementById('settAudioQuality').addEventListener('change', async (e) => {
    await window.abhimeet.updateSettings({ audioQuality: e.target.value });
});

['settDefaultMic', 'settDefaultSystem', 'settDefaultScreen', 'settMinToTray'].forEach(id => {
    document.getElementById(id).addEventListener('change', async (e) => {
        const map = {
            settDefaultMic: 'recordMicrophone',
            settDefaultSystem: 'recordSystemAudio',
            settDefaultScreen: 'recordScreen',
            settMinToTray: 'minimizeToTray',
        };
        await window.abhimeet.updateSettings({ [map[id]]: e.target.checked });
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

function formatDuration(totalSeconds) {
    if (!totalSeconds || totalSeconds < 0) return '00:00:00';
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
}

function formatFileSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ═══════════════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════════════

(async function init() {
    // Load settings and apply defaults to recorder toggles
    try {
        const settings = await window.abhimeet.getSettings();
        if (settings) {
            document.getElementById('optMic').checked = settings.recordMicrophone !== false;
            document.getElementById('optSystemAudio').checked = settings.recordSystemAudio !== false;
            document.getElementById('optScreen').checked = settings.recordScreen !== false;
        }
    } catch (err) {
        console.warn('Could not load settings:', err);
    }
})();
