/**
 * AbhiMeet v2 - Settings management with MCP config sync.
 */
const fs = require('fs');
const path = require('path');

const MCP_CONFIG_PATH = path.join(__dirname, '..', '..', '..', 'mcp-server', 'config.json');

function syncStoragePathToMcp(storagePath) {
    try {
        let config = {};
        if (fs.existsSync(MCP_CONFIG_PATH)) {
            config = JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, 'utf-8'));
        }
        config.storage_path = storagePath;
        const dir = path.dirname(MCP_CONFIG_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(MCP_CONFIG_PATH, JSON.stringify(config, null, 2));
    } catch (err) {
        console.error('MCP config sync failed:', err.message);
    }
}

function getSettings(store) {
    return {
        storagePath: store.get('storagePath'),
        audioQuality: store.get('audioQuality'),
        recordScreen: store.get('recordScreen'),
        recordAudio: store.get('recordAudio'),
        audioFormat: store.get('audioFormat'),
        minimizeToTray: store.get('minimizeToTray'),
    };
}

function updateSettings(store, newSettings) {
    for (const [key, value] of Object.entries(newSettings)) {
        store.set(key, value);
    }
    if (newSettings.storagePath) syncStoragePathToMcp(newSettings.storagePath);
    return getSettings(store);
}

function ensureStorageDir(store) {
    let storagePath = store.get('storagePath');
    try {
        if (!fs.existsSync(storagePath)) fs.mkdirSync(storagePath, { recursive: true });
    } catch (err) {
        console.error('Storage dir fallback:', err.message);
        storagePath = path.join(__dirname, '..', '..', '..', 'recordings');
        fs.mkdirSync(storagePath, { recursive: true });
        store.set('storagePath', storagePath);
    }
    syncStoragePathToMcp(storagePath);
    return storagePath;
}

module.exports = { getSettings, updateSettings, ensureStorageDir, syncStoragePathToMcp };
