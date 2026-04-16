/**
 * AbhiMeet v2 - Renderer
 * Single audio toggle, live waveform, 3-file output, built-in player
 */

// ═══ State ═══
let isRecording = false;
let audioContext = null;
let analyserNode = null;
let waveformAnimId = null;
let micStream = null;
let desktopStream = null;
let audioRecorder = null;
let screenRecorder = null;

// ═══ DOM ═══
const $ = id => document.getElementById(id);
const recordBtn = $('recordBtn');
const recordLabel = $('recordLabel');
const timerDisplay = $('timerDisplay');
const timerValue = timerDisplay.querySelector('.timer-value');
const optAudio = $('optAudio');
const optScreen = $('optScreen');
const statusBar = $('statusBar');
const statusText = $('statusText');
const waveformContainer = $('waveformContainer');
const waveformCanvas = $('waveformCanvas');
const feedbackStrip = $('feedbackStrip');
const meetingTitle = $('meetingTitle');

// ═══ Navigation ═══
document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        $('panel-' + btn.dataset.panel).classList.add('active');
        if (btn.dataset.panel === 'recordings') loadRecordings();
    });
});

// ═══ Recording ═══
recordBtn.addEventListener('click', () => {
    if (isRecording) stopRecording();
    else startRecording();
});

async function startRecording() {
    const wantAudio = optAudio.checked;
    const wantScreen = optScreen.checked;
    if (!wantAudio && !wantScreen) {
        setStatus('Enable at least Audio or Screen', 'error');
        return;
    }

    try {
        setStatus('Starting...', 'processing');

        // 1. Start recording on main process (creates folder + write streams)
        const title = meetingTitle.value.trim() || 'Meeting';
        const result = await window.abhimeet.startRecording({ title, recordAudio: wantAudio, recordScreen: wantScreen });
        if (!result.success) throw new Error(result.error || 'Failed to start');

        // 2. Capture audio (mic + system combined into one stream)
        audioContext = new AudioContext();
        const mixDest = audioContext.createMediaStreamDestination();
        analyserNode = audioContext.createAnalyser();
        analyserNode.fftSize = 256;

        if (wantAudio) {
            // Mic
            try {
                micStream = await navigator.mediaDevices.getUserMedia({
                    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
                });
                const micSource = audioContext.createMediaStreamSource(micStream);
                micSource.connect(mixDest);
                micSource.connect(analyserNode);
            } catch (e) { console.warn('Mic unavailable:', e.message); }

            // System audio via desktop capturer
            try {
                const sources = await window.abhimeet.getDesktopSources();
                if (sources.length > 0) {
                    const sysStream = await navigator.mediaDevices.getUserMedia({
                        audio: { mandatory: { chromeMediaSource: 'desktop' } },
                        video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sources[0].id, maxWidth: 1, maxHeight: 1 } }
                    });
                    // Remove the tiny video track, keep only audio
                    sysStream.getVideoTracks().forEach(t => t.stop());
                    const sysTracks = sysStream.getAudioTracks();
                    if (sysTracks.length > 0) {
                        const sysSource = audioContext.createMediaStreamSource(new MediaStream(sysTracks));
                        sysSource.connect(mixDest);
                        sysSource.connect(analyserNode);
                    }
                }
            } catch (e) { console.warn('System audio unavailable:', e.message); }

            // Record mixed audio stream
            const audioStream = mixDest.stream;
            if (audioStream.getAudioTracks().length > 0) {
                audioRecorder = new MediaRecorder(audioStream, { mimeType: 'audio/webm;codecs=opus' });
                audioRecorder.ondataavailable = e => {
                    if (e.data.size > 0) {
                        e.data.arrayBuffer().then(buf => window.abhimeet.sendAudioChunk(buf));
                    }
                };
                audioRecorder.start(3000);
            }
        }

        // 3. Capture screen (video only, no audio)
        if (wantScreen) {
            const sources = await window.abhimeet.getDesktopSources();
            if (sources.length > 0) {
                desktopStream = await navigator.mediaDevices.getUserMedia({
                    audio: false,
                    video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sources[0].id, maxFrameRate: 15 } }
                });
                screenRecorder = new MediaRecorder(desktopStream, {
                    mimeType: 'video/webm;codecs=vp8',
                    videoBitsPerSecond: 1500000
                });
                screenRecorder.ondataavailable = e => {
                    if (e.data.size > 0) {
                        e.data.arrayBuffer().then(buf => window.abhimeet.sendScreenChunk(buf));
                    }
                };
                screenRecorder.start(3000);
            }
        }

        // 4. UI → recording state
        isRecording = true;
        recordBtn.classList.add('recording');
        recordLabel.textContent = 'RECORDING...';
        recordLabel.classList.add('recording');
        timerDisplay.classList.add('recording');
        optAudio.disabled = true;
        optScreen.disabled = true;
        meetingTitle.disabled = true;
        setStatus('Recording in progress', 'ok');

        // Show waveform + feedback
        if (wantAudio && analyserNode) {
            waveformContainer.classList.add('active');
            drawWaveform();
        }
        feedbackStrip.classList.add('active');
        updateFeedbackStrip(wantAudio, wantScreen);

    } catch (err) {
        console.error('Start error:', err);
        setStatus('Error: ' + err.message, 'error');
        cleanupStreams();
    }
}

async function stopRecording() {
    if (!isRecording) return;

    // Stop recorders
    if (audioRecorder && audioRecorder.state !== 'inactive') audioRecorder.stop();
    if (screenRecorder && screenRecorder.state !== 'inactive') screenRecorder.stop();

    // Wait for final chunks
    await new Promise(r => setTimeout(r, 600));

    // Tell main process to finalize (convert, merge, save metadata)
    setStatus('Processing... converting files', 'processing');
    const result = await window.abhimeet.stopRecording();

    // Cleanup
    cleanupStreams();
    isRecording = false;
    recordBtn.classList.remove('recording');
    recordLabel.textContent = 'CLICK TO START';
    recordLabel.classList.remove('recording');
    timerDisplay.classList.remove('recording');
    timerValue.textContent = '00:00:00';
    optAudio.disabled = false;
    optScreen.disabled = false;
    meetingTitle.disabled = false;
    meetingTitle.value = '';
    waveformContainer.classList.remove('active');
    feedbackStrip.classList.remove('active');
    cancelAnimationFrame(waveformAnimId);

    if (result.success) {
        const dur = formatDuration(result.duration);
        setStatus(`Saved: ${result.recordingId} (${dur})`, 'ok');
    } else {
        setStatus('Error saving: ' + (result.error || 'unknown'), 'error');
    }
}

function cleanupStreams() {
    if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
    if (desktopStream) { desktopStream.getTracks().forEach(t => t.stop()); desktopStream = null; }
    if (audioContext) { audioContext.close().catch(() => {}); audioContext = null; }
    analyserNode = null; audioRecorder = null; screenRecorder = null;
}

// ═══ Live Waveform Visualization ═══
function drawWaveform() {
    if (!analyserNode || !isRecording) return;
    const canvas = waveformCanvas;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    ctx.scale(dpr, dpr);
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    const bufLen = analyserNode.frequencyBinCount;
    const timeData = new Uint8Array(bufLen);
    const freqData = new Uint8Array(bufLen);

    function render() {
        if (!isRecording) return;
        waveformAnimId = requestAnimationFrame(render);
        analyserNode.getByteTimeDomainData(timeData);
        analyserNode.getByteFrequencyData(freqData);

        // Clear
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(0, 0, W, H);

        // Frequency bars (background)
        const barCount = 40;
        const barW = W / barCount - 1;
        for (let i = 0; i < barCount; i++) {
            const val = freqData[i * Math.floor(bufLen / barCount)] / 255;
            const barH = val * H * 0.85;
            const hue = 210 + val * 30;
            ctx.fillStyle = `hsla(${hue}, 80%, 55%, ${0.08 + val * 0.15})`;
            ctx.fillRect(i * (barW + 1), H - barH, barW, barH);
        }

        // Center line
        ctx.strokeStyle = 'rgba(100,116,139,0.2)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, H / 2);
        ctx.lineTo(W, H / 2);
        ctx.stroke();

        // Waveform line
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#3b82f6';
        ctx.shadowColor = 'rgba(59,130,246,0.6)';
        ctx.shadowBlur = 6;
        ctx.beginPath();
        const step = W / bufLen;
        for (let i = 0; i < bufLen; i++) {
            const y = (timeData[i] / 128.0) * (H / 2);
            if (i === 0) ctx.moveTo(0, y);
            else ctx.lineTo(i * step, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
    }
    render();
}

function updateFeedbackStrip(hasAudio, hasScreen) {
    const fbAudio = $('fbAudio');
    const fbScreen = $('fbScreen');
    const fbDisk = $('fbDisk');
    if (fbAudio) fbAudio.style.display = hasAudio ? 'flex' : 'none';
    if (fbScreen) fbScreen.style.display = hasScreen ? 'flex' : 'none';
    if (fbDisk) fbDisk.style.display = 'flex';
}

// ═══ Timer from main process ═══
window.abhimeet.onRecordingTime((_, data) => {
    timerValue.textContent = formatDuration(data.elapsed);
});

window.abhimeet.onProcessingStatus((_, data) => {
    if (data.status === 'processing') setStatus(data.message, 'processing');
    else if (data.status === 'done') setStatus(data.message, 'ok');
});

function formatDuration(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
}

function setStatus(msg, type = 'ok') {
    statusText.textContent = msg;
    statusBar.className = 'status-bar' + (type !== 'ok' ? ' ' + type : '');
}

// ═══ Recordings List ═══
async function loadRecordings() {
    const list = $('recordingsList');
    const recordings = await window.abhimeet.listRecordings();
    if (!recordings || recordings.length === 0) {
        list.innerHTML = '<div class="empty-state"><p>No recordings yet</p></div>';
        return;
    }
    const search = ($('searchRecordings')?.value || '').toLowerCase();
    const filtered = search ? recordings.filter(r => (r.title || r.id).toLowerCase().includes(search)) : recordings;

    list.innerHTML = filtered.map(r => {
        const files = r.files || {};
        const badges = [];
        if (files.audio) badges.push('<span class="file-badge audio">MP3</span>');
        if (files.video) badges.push('<span class="file-badge video">Video</span>');
        if (files.combined) badges.push('<span class="file-badge combined">A+V</span>');
        // Transcription status badge
        if (r.has_transcription) badges.push('<span class="file-badge transcribed">Transcribed</span>');
        else if (r.transcription_status === 'in_progress') badges.push('<span class="file-badge transcribing">Transcribing...</span>');
        if (badges.length === 0) badges.push('<span class="file-badge pending">Pending</span>');
        const date = r.date ? new Date(r.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
        return `<div class="recording-card" data-id="${r.id}">
            <div class="rec-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>
            <div class="rec-info">
                <div class="rec-title">${r.title || r.id}</div>
                <div class="rec-meta"><span>${date}</span><span>${r.duration_formatted || ''}</span></div>
                <div class="rec-files">${badges.join('')}</div>
            </div>
            <div class="rec-actions">
                <button class="rec-action-btn" data-action="folder" data-id="${r.id}" title="Open Folder"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></button>
                <button class="rec-action-btn" data-action="delete" data-id="${r.id}" title="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
            </div>
        </div>`;
    }).join('');

    list.querySelectorAll('.recording-card').forEach(card => {
        card.addEventListener('click', e => {
            if (e.target.closest('[data-action]')) return;
            openPlayer(card.dataset.id);
        });
    });
    list.querySelectorAll('[data-action="folder"]').forEach(btn => {
        btn.addEventListener('click', e => { e.stopPropagation(); window.abhimeet.openFolder(btn.dataset.id); });
    });
    list.querySelectorAll('[data-action="delete"]').forEach(btn => {
        btn.addEventListener('click', async e => {
            e.stopPropagation();
            if (confirm('Delete this recording permanently?')) {
                await window.abhimeet.deleteRecording(btn.dataset.id);
                loadRecordings();
            }
        });
    });
}

$('refreshRecordings')?.addEventListener('click', loadRecordings);
$('searchRecordings')?.addEventListener('input', loadRecordings);

// ═══ Player Modal ═══
async function openPlayer(recordingId) {
    const meta = await window.abhimeet.getRecording(recordingId);
    if (!meta) return;
    const modal = $('playerModal');
    const files = meta.files || {};

    $('playerTitle').textContent = meta.title || recordingId;
    const date = meta.date ? new Date(meta.date).toLocaleString('en-IN') : '';
    $('playerInfo').innerHTML = `<span>${date}</span><span>${meta.duration_formatted || ''}</span>`;

    // Setup media tabs
    await setupPlayerTab('audio', files.audio, recordingId, 'audioPlayer', 'audioFileInfo');
    await setupPlayerTab('video', files.video, recordingId, 'videoPlayer', 'videoFileInfo');
    await setupPlayerTab('combined', files.combined, recordingId, 'combinedPlayer', 'combinedFileInfo');

    // Setup transcript tab
    await loadTranscriptTab(recordingId);

    // Select first available
    const first = files.audio ? 'audio' : files.video ? 'video' : files.combined ? 'combined' : 'audio';
    switchPlayerTab(first);

    $('btnOpenFolder').onclick = () => window.abhimeet.openFolder(recordingId);
    $('btnDelete').onclick = async () => {
        if (confirm('Delete this recording permanently?')) {
            await window.abhimeet.deleteRecording(recordingId);
            modal.style.display = 'none';
            stopAllPlayers();
            loadRecordings();
        }
    };
    modal.style.display = 'flex';
}

// ═══ Transcript Tab ═══
async function loadTranscriptTab(recordingId) {
    const transcriptTab = document.querySelector('[data-tab="transcript"]');
    const statusDiv = $('transcriptStatus');
    const contentDiv = $('transcriptContent');

    const result = await window.abhimeet.readTranscription(recordingId);

    if (result.status === 'done' && result.data) {
        transcriptTab.classList.remove('disabled');
        // Show language badge + content
        const lang = result.data.language || '';
        const model = result.data.model || '';
        const segments = result.data.segments || [];

        statusDiv.innerHTML = `<span class="status-badge-lg done">Transcription Complete</span>`;

        let html = '';
        if (lang) html += `<span class="lang-badge">${lang.toUpperCase()}${model ? ' \u2022 ' + model : ''}</span>\n`;

        if (segments.length > 0) {
            html += segments.map(s =>
                `<span class="ts">[${s.time}]</span> ${s.text}`
            ).join('\n');
        } else if (result.data.full_text) {
            html += result.data.full_text;
        }
        contentDiv.innerHTML = html;
        contentDiv.style.display = 'block';
    } else if (result.status === 'in_progress') {
        transcriptTab.classList.remove('disabled');
        statusDiv.innerHTML = `<span class="status-badge-lg progress"><span class="spinner-sm"></span> Transcription in progress...</span>`;
        contentDiv.innerHTML = '<p class="transcript-hint">Whisper AI is processing your audio. This takes 3-5 minutes.</p>';
        contentDiv.style.display = 'block';
    } else {
        transcriptTab.classList.remove('disabled');
        statusDiv.innerHTML = `<span class="status-badge-lg pending">Not transcribed yet</span>`;
        contentDiv.innerHTML = '<p class="transcript-hint">Ask Claude: "Transcribe my latest recording" to generate the transcript.</p>';
        contentDiv.style.display = 'block';
    }
}

async function setupPlayerTab(tabName, fileInfo, recordingId, playerId, infoId) {
    const player = $(playerId);
    const tab = document.querySelector(`[data-tab="${tabName}"]`);
    const pane = $('pane-' + tabName);
    if (fileInfo) {
        const url = await window.abhimeet.getFileUrl(recordingId, fileInfo.filename);
        player.src = url || '';
        $(infoId).textContent = `${fileInfo.filename} (${formatBytes(fileInfo.size_bytes)})`;
        tab.classList.remove('disabled');
        pane.querySelector('.no-file')?.remove();
    } else {
        player.src = '';
        player.style.display = 'none';
        $(infoId).textContent = '';
        tab.classList.add('disabled');
        if (!pane.querySelector('.no-file')) {
            const div = document.createElement('div');
            div.className = 'no-file';
            div.textContent = tabName === 'combined' ? 'Combined file not available (needs both audio + screen)' : 'Not recorded';
            pane.prepend(div);
        }
    }
    // Show player element when file exists
    if (fileInfo) player.style.display = '';
}

function switchPlayerTab(tab) {
    document.querySelectorAll('.player-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    document.querySelectorAll('.player-pane').forEach(p => p.classList.toggle('active', p.id === 'pane-' + tab));
}

document.querySelectorAll('.player-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        if (tab.classList.contains('disabled')) return;
        stopAllPlayers();
        switchPlayerTab(tab.dataset.tab);
    });
});

$('playerClose')?.addEventListener('click', () => { $('playerModal').style.display = 'none'; stopAllPlayers(); });
$('playerModal')?.addEventListener('click', e => {
    if (e.target === $('playerModal')) { $('playerModal').style.display = 'none'; stopAllPlayers(); }
});

function stopAllPlayers() {
    ['audioPlayer', 'videoPlayer', 'combinedPlayer'].forEach(id => {
        const el = $(id); if (el) { el.pause(); el.currentTime = 0; }
    });
}

function formatBytes(bytes) {
    if (!bytes) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
}

// ═══ Settings ═══
async function loadSettings() {
    const settings = await window.abhimeet.getSettings();
    if (!settings) return;
    $('settStoragePath').value = settings.storagePath || '';
    $('settAudioQuality').value = settings.audioQuality || '128k';
    if ($('settDefaultAudio')) $('settDefaultAudio').checked = settings.recordAudio !== false;
    if ($('settDefaultScreen')) $('settDefaultScreen').checked = settings.recordScreen !== false;
    if ($('settMinToTray')) $('settMinToTray').checked = settings.minimizeToTray !== false;
    optAudio.checked = settings.recordAudio !== false;
    optScreen.checked = settings.recordScreen !== false;
}

$('settBrowse')?.addEventListener('click', async () => {
    const folder = await window.abhimeet.selectFolder();
    if (folder) { $('settStoragePath').value = folder; await window.abhimeet.updateSettings({ storagePath: folder }); }
});
$('settAudioQuality')?.addEventListener('change', () => window.abhimeet.updateSettings({ audioQuality: $('settAudioQuality').value }));
$('settDefaultAudio')?.addEventListener('change', () => window.abhimeet.updateSettings({ recordAudio: $('settDefaultAudio').checked }));
$('settDefaultScreen')?.addEventListener('change', () => window.abhimeet.updateSettings({ recordScreen: $('settDefaultScreen').checked }));
$('settMinToTray')?.addEventListener('change', () => window.abhimeet.updateSettings({ minimizeToTray: $('settMinToTray').checked }));

// ═══ Init ═══
loadSettings();
