/**
 * AbhiMeet - Settings management.
 * Wraps electron-store for persistent settings with MCP config sync.
 */

const fs = require('fs');
const path = require('path');

const MCP_CONFIG_PATH = path.join('C:', 'MCP', 'abhimeet', 'mcp-server', 'config.json');

/**
 * Sync the storage path to the MCP server config.json so both components share the same path.
 */
function syncStoragePathToMcp(storagePath) {
    try {
        let config = {};
        if (fs.existsSync(MCP_CONFIG_PATH)) {
            config = JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, 'utf-8'));
        }
        config.storage_path = storagePath;
        fs.writeFileSync(MCP_CONFIG_PATH, JSON.stringify(config, null, 2));
    } catch (err) {
        console.error('Failed to sync storage path to MCP config:', err);
    }
}

function getSettings(store) {
    return {
        storagePath: store.get('storagePath'),
        audioQuality: store.get('audioQuality'),
        recordScreen: store.get('recordScreen'),
        recordMicrophone: store.get('recordMicrophone'),
        recordSystemAudio: store.get('recordSystemAudio'),
        audioFormat: store.get('audioFormat'),
        minimizeToTray: store.get('minimizeToTray'),
    };
}

function updateSettings(store, newSettings) {
    for (const [key, value] of Object.entries(newSettings)) {
        store.set(key, value);
    }

    // Sync storage path to MCP config
    if (newSettings.storagePath) {
        syncStoragePathToMcp(newSettings.storagePath);
    }

    return getSettings(store);
}

function ensureStorageDir(store) {
    const storagePath = store.get('storagePath');
    if (!fs.existsSync(storagePath)) {
        fs.mkdirSync(storagePath, { recursive: true });
    }

    // Also sync to MCP on startup
    syncStoragePathToMcp(storagePath);

    return storagePath;
}

module.exports = { getSettings, updateSettings, ensureStorageDir, syncStoragePathToMcp };
