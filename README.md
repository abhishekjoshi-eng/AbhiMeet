# AbhiMeet

**Local meeting recorder with AI-powered transcription and reporting via Claude MCP.**

A free, open-source alternative to Fireflies.ai — record meetings locally, transcribe in multiple languages using Whisper AI, and generate reports directly through Claude.

Created by **Abhishek Joshi** ([@abhishekjoshi-eng](https://github.com/abhishekjoshi-eng))

---

## Features

- **Audio + Screen Recording** — Single-click recording with mic + system audio combined, plus screen capture
- **3 Output Files** — Every recording generates:
  - `Subject_Audio_DDMMYY_HHMMam.mp3` — Audio only
  - `Subject_Video_DDMMYY_HHMMam.webm` — Screen only
  - `Subject_AV_DDMMYY_HHMMam.mp4` — Combined audio + video
- **Live Waveform** — Real-time audio visualization during recording so you know it's working
- **Built-in Player** — Play audio, video, and combined files directly in the app
- **Whisper Transcription** — Local speech-to-text via faster-whisper (no cloud, no API key)
- **Multi-Language** — Supports English, Hindi, Gujarati, Kutchi, Marathi, Bengali, and 90+ more
- **Claude MCP Integration** — 15 MCP tools for Claude to transcribe, summarize, extract action items, generate MOM reports
- **Video Frame Extraction** — Claude can "see" what was on screen by analyzing extracted frames
- **Configurable Storage** — Set your own recording folder path
- **No Subscription** — Everything runs locally, no cloud dependency

## Architecture

```
abhimeet/
  app/                    # Electron desktop app
    src/
      main/               # Main process (IPC, file management, settings)
      renderer/           # UI (HTML, CSS, JS with live waveform)
    ffmpeg/               # Bundled FFmpeg for audio/video processing
    assets/               # App icon
  mcp-server/             # Python MCP server for Claude integration
    main.py               # 15 MCP tools + Whisper transcription
    config.json           # Storage path and language config
  recordings/             # Your meeting recordings (auto-created)
```

## Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) v18+
- [Python](https://python.org/) v3.10+
- [uv](https://docs.astral.sh/uv/) (Python package manager)
- [FFmpeg](https://ffmpeg.org/) (or let the installer download it)

### Installation

```bash
# Clone the repo
git clone https://github.com/abhishekjoshi-eng/AbhiMeet.git
cd abhimeet

# Install Electron app
cd app
npm install
cd ..

# Install MCP server
cd mcp-server
uv sync
cd ..
```

### Download FFmpeg

Download FFmpeg essentials from [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) and place `ffmpeg.exe` and `ffprobe.exe` in the `app/ffmpeg/` folder.

### Run the App

```bash
cd app
npx electron .
```

### Connect to Claude

Add to your Claude Desktop config (`%APPDATA%/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "abhimeet": {
      "command": "uv",
      "args": ["--directory", "/path/to/abhimeet/mcp-server", "run", "main.py"]
    }
  }
}
```

Or for Claude Code (`.claude/.mcp.json`):

```json
{
  "mcpServers": {
    "abhimeet": {
      "command": "uv",
      "args": ["--directory", "/path/to/abhimeet/mcp-server", "run", "main.py"]
    }
  }
}
```

Restart Claude and you'll have 15 AbhiMeet tools available.

## MCP Tools (15)

| Tool | Description |
|------|-------------|
| `list_recordings` | List all recordings with metadata |
| `get_recording_info` | Detailed info about a recording |
| `get_audio_file_path` | Get path to audio MP3 file |
| `get_video_file_path` | Get path to video WebM file |
| `get_combined_file_path` | Get path to combined MP4 file |
| `transcribe_recording` | Transcribe audio using Whisper AI (local, no API key) |
| `extract_video_frames` | Extract screen frames for Claude to analyze |
| `save_transcription` | Save a transcription to the recording |
| `read_transcription` | Read a saved transcription |
| `save_summary` | Save a meeting summary |
| `read_summary` | Read a saved summary |
| `save_report` | Save reports (MOM, action items, decisions, follow-ups) |
| `search_recordings` | Search across all recordings |
| `get_storage_stats` | Storage usage statistics |
| `delete_recording` | Delete a recording |

## Usage with Claude

After connecting, just talk naturally:

- *"List my recordings"*
- *"Transcribe my latest recording"*
- *"Generate meeting minutes with action items"*
- *"Extract frames and describe what was shown on screen"*
- *"Summarize the discussion about budget in Hindi"*
- *"Create a MOM report for the client meeting"*

## File Naming Convention

```
Folder:    Budget-Review_160426_0230PM/
Audio:     Budget-Review_Audio_160426_0230PM.mp3
Video:     Budget-Review_Video_160426_0230PM.webm
Combined:  Budget-Review_AV_160426_0230PM.mp4
```

Format: `Subject_Type_DDMMYY_HHMMam/pm.ext`

## Supported Languages

Whisper AI supports 90+ languages. Primary tested languages:
- English
- Hindi
- Gujarati
- Kutchi
- Marathi
- Bengali

## Tech Stack

- **Electron** — Desktop app framework
- **FFmpeg** — Audio/video processing
- **faster-whisper** — Local speech-to-text (CTranslate2 + Whisper)
- **MCP (Model Context Protocol)** — Claude integration
- **FastMCP** — Python MCP server framework

## License

MIT License - see [LICENSE](LICENSE)

## Author

**Abhishek Joshi**
- Director, Prakash Trading Co.
- GitHub: [@abhishekjoshi-eng](https://github.com/abhishekjoshi-eng)

---

*Built with Claude AI assistance. No Fireflies subscription needed.*
