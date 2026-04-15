"""AbhiMeet MCP Server - Meeting Recording Manager for Claude
With built-in Whisper transcription for speech-to-text."""

import json
import os
import shutil
from datetime import datetime
from pathlib import Path

from mcp.server.fastmcp import FastMCP

# Lazy-load Whisper to avoid slow startup
_whisper_model = None
def get_whisper_model():
    global _whisper_model
    if _whisper_model is None:
        from faster_whisper import WhisperModel
        # Use "base" model for balance of speed + quality. "small" is better but slower.
        _whisper_model = WhisperModel("base", device="cpu", compute_type="int8")
    return _whisper_model

mcp = FastMCP("abhimeet")

CONFIG_PATH = Path(__file__).parent / "config.json"

def load_config():
    if CONFIG_PATH.exists():
        return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    return {"storage_path": str(Path.home() / "AbhiMeet-Recordings")}

def get_storage_path():
    config = load_config()
    p = Path(config["storage_path"])
    p.mkdir(parents=True, exist_ok=True)
    return p

def get_recording_dirs():
    storage = get_storage_path()
    dirs = []
    for d in sorted(storage.iterdir(), reverse=True):
        if d.is_dir() and (d / "metadata.json").exists():
            dirs.append(d)
    return dirs


@mcp.tool()
def list_recordings(limit: int = 20, status_filter: str = "all") -> str:
    """List all meeting recordings with metadata.

    Args:
        limit: Max recordings to return (default 20)
        status_filter: Filter by status - 'all', 'pending', 'transcribed', 'summarized'
    """
    dirs = get_recording_dirs()
    results = []
    for d in dirs[:limit]:
        meta = json.loads((d / "metadata.json").read_text(encoding="utf-8"))
        status = "pending"
        if (d / "transcription.md").exists():
            status = "transcribed"
        if (d / "summary.md").exists():
            status = "summarized"
        if (d / "report.md").exists():
            status = "reported"
        if status_filter != "all" and status != status_filter:
            continue
        audio_size = 0
        if (d / "audio.mp3").exists():
            audio_size = (d / "audio.mp3").stat().st_size
        results.append({
            "id": d.name,
            "title": meta.get("title", d.name),
            "date": meta.get("date", ""),
            "duration": meta.get("duration_formatted", meta.get("duration", "00:00:00")),
            "audio_size_kb": round(audio_size / 1024, 1),
            "has_screen": (d / "screen.webm").exists(),
            "status": status,
            "languages": meta.get("languages", []),
        })
    return json.dumps({"recordings": results, "total": len(dirs)}, indent=2)


@mcp.tool()
def get_recording_info(recording_id: str) -> str:
    """Get detailed info about a specific recording.

    Args:
        recording_id: The recording folder ID (e.g. '2026-04-15_Meeting_143000')
    """
    storage = get_storage_path()
    d = storage / recording_id
    if not d.exists():
        return json.dumps({"error": f"Recording '{recording_id}' not found"})

    meta = json.loads((d / "metadata.json").read_text(encoding="utf-8"))

    files = {}
    for f in d.iterdir():
        if f.is_file():
            files[f.name] = {
                "size_kb": round(f.stat().st_size / 1024, 1),
                "modified": datetime.fromtimestamp(f.stat().st_mtime).isoformat()
            }

    return json.dumps({
        "id": d.name,
        "metadata": meta,
        "files": files,
        "path": str(d),
        "has_transcription": (d / "transcription.md").exists(),
        "has_summary": (d / "summary.md").exists(),
        "has_report": (d / "report.md").exists(),
    }, indent=2)


def _find_file(recording_dir, keyword_or_ext):
    """Find a file in recording dir by keyword in name or extension."""
    for f in recording_dir.iterdir():
        if f.is_file() and keyword_or_ext.lower() in f.name.lower():
            return f
    return None


@mcp.tool()
def get_audio_file_path(recording_id: str) -> str:
    """Get the full path to a recording's audio-only file (MP3).

    Args:
        recording_id: The recording folder ID
    """
    storage = get_storage_path()
    d = storage / recording_id
    if not d.exists():
        return json.dumps({"error": f"Recording '{recording_id}' not found"})
    audio = _find_file(d, "_Audio_") or _find_file(d, "audio.mp3") or _find_file(d, "audio.webm")
    if not audio:
        return json.dumps({"error": f"Audio file not found for '{recording_id}'"})
    return json.dumps({
        "path": str(audio),
        "filename": audio.name,
        "size_kb": round(audio.stat().st_size / 1024, 1),
        "format": audio.suffix.lstrip('.'),
    })


@mcp.tool()
def get_video_file_path(recording_id: str) -> str:
    """Get the full path to a recording's video-only file (screen recording, no audio).

    Args:
        recording_id: The recording folder ID
    """
    storage = get_storage_path()
    d = storage / recording_id
    if not d.exists():
        return json.dumps({"error": f"Recording '{recording_id}' not found"})
    video = _find_file(d, "_Video_") or _find_file(d, "video.webm")
    if not video:
        return json.dumps({"error": f"Video file not found for '{recording_id}'"})
    return json.dumps({
        "path": str(video),
        "filename": video.name,
        "size_mb": round(video.stat().st_size / (1024 * 1024), 2),
        "format": video.suffix.lstrip('.'),
    })


@mcp.tool()
def get_combined_file_path(recording_id: str) -> str:
    """Get the full path to a recording's combined audio+video file (MP4).

    Args:
        recording_id: The recording folder ID
    """
    storage = get_storage_path()
    d = storage / recording_id
    if not d.exists():
        return json.dumps({"error": f"Recording '{recording_id}' not found"})
    combined = _find_file(d, "_AV_") or _find_file(d, "combined.mp4")
    if not combined:
        return json.dumps({"error": f"Combined file not found for '{recording_id}'"})
    return json.dumps({
        "path": str(combined),
        "filename": combined.name,
        "size_mb": round(combined.stat().st_size / (1024 * 1024), 2),
        "format": combined.suffix.lstrip('.'),
    })


@mcp.tool()
def transcribe_recording(recording_id: str, model_size: str = "base") -> str:
    """Transcribe a recording's audio using Whisper AI speech-to-text.
    Supports: English, Hindi, Gujarati, Marathi, Bengali, and many more languages.
    Auto-detects language. Saves transcription to recording folder.

    Args:
        recording_id: The recording folder ID
        model_size: Whisper model - 'tiny' (fastest), 'base' (balanced), 'small' (best quality)
    """
    storage = get_storage_path()
    d = storage / recording_id
    if not d.exists():
        return json.dumps({"error": f"Recording '{recording_id}' not found"})

    # Find audio file
    audio = _find_file(d, "_Audio_") or _find_file(d, "audio.mp3") or _find_file(d, "audio.webm")
    if not audio:
        return json.dumps({"error": "No audio file found to transcribe"})

    try:
        from faster_whisper import WhisperModel
        model = WhisperModel(model_size, device="cpu", compute_type="int8")

        segments_list, info = model.transcribe(str(audio), beam_size=5)

        full_text = []
        seg_data = []
        for seg in segments_list:
            h = int(seg.start // 3600)
            m = int((seg.start % 3600) // 60)
            s = int(seg.start % 60)
            timestamp = f"{h:02d}:{m:02d}:{s:02d}"
            full_text.append(f"[{timestamp}] {seg.text.strip()}")
            seg_data.append({
                "start": round(seg.start, 2),
                "end": round(seg.end, 2),
                "time": timestamp,
                "text": seg.text.strip()
            })

        language = info.language or "unknown"
        lang_prob = round((info.language_probability or 0) * 100, 1)
        transcription_md = f"# Transcription: {recording_id}\n"
        transcription_md += f"**Language**: {language} ({lang_prob}% confidence)\n"
        transcription_md += f"**Duration**: {info.duration:.1f}s\n\n"
        transcription_md += "\n".join(full_text)

        # Save files
        (d / "transcription.md").write_text(transcription_md, encoding="utf-8")
        json_data = {
            "recording_id": recording_id,
            "language": language,
            "language_probability": lang_prob,
            "duration": round(info.duration, 2),
            "transcribed_at": datetime.now().isoformat(),
            "model": model_size,
            "full_text": "\n".join([s["text"] for s in seg_data]),
            "segments": seg_data
        }
        (d / "transcription.json").write_text(json.dumps(json_data, indent=2, ensure_ascii=False), encoding="utf-8")

        # Update metadata
        meta_path = d / "metadata.json"
        if meta_path.exists():
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            meta["transcription_status"] = "completed"
            meta["transcription_language"] = language
            meta["transcribed_at"] = datetime.now().isoformat()
            meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")

        return json.dumps({
            "success": True,
            "language": language,
            "confidence": lang_prob,
            "segments_count": len(seg_data),
            "duration": round(info.duration, 2),
            "preview": "\n".join(full_text[:5]) + ("\n..." if len(full_text) > 5 else ""),
            "message": f"Transcribed {len(seg_data)} segments in {language} ({lang_prob}%)"
        }, ensure_ascii=False)

    except Exception as e:
        return json.dumps({"error": f"Transcription failed: {str(e)}"})


@mcp.tool()
def save_transcription(recording_id: str, transcription_text: str, language: str = "english", segments: str = "[]") -> str:
    """Save a transcription for a recording.

    Args:
        recording_id: The recording folder ID
        transcription_text: Full transcription text (markdown format)
        language: Primary language detected
        segments: JSON array of timestamped segments [{"time": "00:01:23", "speaker": "Person", "text": "..."}]
    """
    storage = get_storage_path()
    d = storage / recording_id
    if not d.exists():
        return json.dumps({"error": f"Recording '{recording_id}' not found"})

    # Save markdown version
    (d / "transcription.md").write_text(transcription_text, encoding="utf-8")

    # Save structured JSON version
    seg_data = json.loads(segments) if isinstance(segments, str) else segments
    json_data = {
        "recording_id": recording_id,
        "language": language,
        "transcribed_at": datetime.now().isoformat(),
        "full_text": transcription_text,
        "segments": seg_data
    }
    (d / "transcription.json").write_text(json.dumps(json_data, indent=2, ensure_ascii=False), encoding="utf-8")

    # Update metadata
    meta_path = d / "metadata.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    meta["transcription_status"] = "completed"
    meta["transcription_language"] = language
    meta["transcribed_at"] = datetime.now().isoformat()
    meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")

    return json.dumps({"success": True, "message": f"Transcription saved for {recording_id}", "language": language})


@mcp.tool()
def read_transcription(recording_id: str, format: str = "markdown") -> str:
    """Read the transcription of a recording.

    Args:
        recording_id: The recording folder ID
        format: 'markdown' for full text or 'json' for structured segments
    """
    storage = get_storage_path()
    d = storage / recording_id

    if format == "json":
        f = d / "transcription.json"
        if not f.exists():
            return json.dumps({"error": "No transcription found"})
        return f.read_text(encoding="utf-8")
    else:
        f = d / "transcription.md"
        if not f.exists():
            return json.dumps({"error": "No transcription found"})
        return f.read_text(encoding="utf-8")


@mcp.tool()
def save_summary(recording_id: str, summary_text: str) -> str:
    """Save a meeting summary for a recording.

    Args:
        recording_id: The recording folder ID
        summary_text: Meeting summary in markdown format
    """
    storage = get_storage_path()
    d = storage / recording_id
    if not d.exists():
        return json.dumps({"error": f"Recording '{recording_id}' not found"})

    (d / "summary.md").write_text(summary_text, encoding="utf-8")

    meta_path = d / "metadata.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    meta["summary_status"] = "completed"
    meta["summarized_at"] = datetime.now().isoformat()
    meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")

    return json.dumps({"success": True, "message": f"Summary saved for {recording_id}"})


@mcp.tool()
def read_summary(recording_id: str) -> str:
    """Read the summary of a recording.

    Args:
        recording_id: The recording folder ID
    """
    storage = get_storage_path()
    f = storage / recording_id / "summary.md"
    if not f.exists():
        return json.dumps({"error": "No summary found"})
    return f.read_text(encoding="utf-8")


@mcp.tool()
def save_report(recording_id: str, report_text: str, report_type: str = "general") -> str:
    """Save a report for a recording (action items, decisions, follow-ups, etc).

    Args:
        recording_id: The recording folder ID
        report_text: Report content in markdown format
        report_type: Type of report - 'general', 'action_items', 'decisions', 'follow_ups', 'mom'
    """
    storage = get_storage_path()
    d = storage / recording_id
    if not d.exists():
        return json.dumps({"error": f"Recording '{recording_id}' not found"})

    filename = f"report_{report_type}.md" if report_type != "general" else "report.md"
    (d / filename).write_text(report_text, encoding="utf-8")

    meta_path = d / "metadata.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    if "reports" not in meta:
        meta["reports"] = []
    if report_type not in meta["reports"]:
        meta["reports"].append(report_type)
    meta["report_status"] = "completed"
    meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")

    return json.dumps({"success": True, "message": f"{report_type} report saved for {recording_id}"})


@mcp.tool()
def search_recordings(query: str, search_in: str = "all") -> str:
    """Search across all recordings by title, transcription content, or summary.

    Args:
        query: Search term
        search_in: Where to search - 'all', 'title', 'transcription', 'summary'
    """
    dirs = get_recording_dirs()
    results = []
    query_lower = query.lower()

    for d in dirs:
        meta = json.loads((d / "metadata.json").read_text(encoding="utf-8"))
        matched = False
        match_locations = []

        if search_in in ("all", "title"):
            if query_lower in meta.get("title", "").lower() or query_lower in d.name.lower():
                matched = True
                match_locations.append("title")

        if search_in in ("all", "transcription"):
            tf = d / "transcription.md"
            if tf.exists() and query_lower in tf.read_text(encoding="utf-8").lower():
                matched = True
                match_locations.append("transcription")

        if search_in in ("all", "summary"):
            sf = d / "summary.md"
            if sf.exists() and query_lower in sf.read_text(encoding="utf-8").lower():
                matched = True
                match_locations.append("summary")

        if matched:
            results.append({
                "id": d.name,
                "title": meta.get("title", d.name),
                "date": meta.get("date", ""),
                "matched_in": match_locations
            })

    return json.dumps({"query": query, "results": results, "count": len(results)}, indent=2)


@mcp.tool()
def get_storage_stats() -> str:
    """Get storage statistics - total recordings, sizes, disk space."""
    storage = get_storage_path()
    dirs = get_recording_dirs()

    total_size = 0
    for d in dirs:
        for f in d.rglob("*"):
            if f.is_file():
                total_size += f.stat().st_size

    disk = shutil.disk_usage(storage)

    return json.dumps({
        "storage_path": str(storage),
        "total_recordings": len(dirs),
        "total_size_mb": round(total_size / (1024 * 1024), 2),
        "disk_free_gb": round(disk.free / (1024**3), 2),
        "disk_total_gb": round(disk.total / (1024**3), 2),
    }, indent=2)


@mcp.tool()
def extract_video_frames(recording_id: str, interval_seconds: int = 30) -> str:
    """Extract key frames from a screen recording video so Claude can see what was on screen.
    Frames are saved as PNG images in a 'frames' subfolder within the recording.
    Claude can then read these images to understand the visual content of the meeting.

    Args:
        recording_id: The recording folder ID
        interval_seconds: Extract one frame every N seconds (default 30). Use 10 for detailed, 60 for overview.
    """
    storage = get_storage_path()
    d = storage / recording_id
    if not d.exists():
        return json.dumps({"error": f"Recording '{recording_id}' not found"})

    # Find video file
    video = _find_file(d, "_Video_") or _find_file(d, "video.webm") or _find_file(d, "_AV_") or _find_file(d, "combined.mp4")
    if not video:
        return json.dumps({"error": "No video file found"})

    # Find ffmpeg
    ffmpeg_paths = [
        Path(__file__).parent.parent / "app" / "ffmpeg" / "ffmpeg.exe",
        Path("ffmpeg"),
    ]
    ffmpeg = None
    for p in ffmpeg_paths:
        if p.exists() or str(p) == "ffmpeg":
            ffmpeg = str(p)
            break
    if not ffmpeg:
        return json.dumps({"error": "FFmpeg not found"})

    # Create frames directory
    frames_dir = d / "frames"
    frames_dir.mkdir(exist_ok=True)

    # Extract frames using FFmpeg
    import subprocess
    try:
        cmd = [
            ffmpeg,
            "-i", str(video),
            "-vf", f"fps=1/{interval_seconds}",
            "-q:v", "2",
            "-y",
            str(frames_dir / "frame_%04d.png")
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)

        # List extracted frames
        frames = sorted(frames_dir.glob("frame_*.png"))
        frame_list = []
        for i, f in enumerate(frames):
            timestamp_sec = i * interval_seconds
            h = timestamp_sec // 3600
            m = (timestamp_sec % 3600) // 60
            s = timestamp_sec % 60
            frame_list.append({
                "filename": f.name,
                "path": str(f),
                "timestamp": f"{h:02d}:{m:02d}:{s:02d}",
                "size_kb": round(f.stat().st_size / 1024, 1),
            })

        return json.dumps({
            "success": True,
            "frames_count": len(frames),
            "interval_seconds": interval_seconds,
            "frames_dir": str(frames_dir),
            "frames": frame_list,
            "message": f"Extracted {len(frames)} frames at {interval_seconds}s intervals. Use Read tool on frame paths to view them."
        }, indent=2)

    except Exception as e:
        return json.dumps({"error": f"Frame extraction failed: {str(e)}"})


@mcp.tool()
def delete_recording(recording_id: str) -> str:
    """Delete a recording and all its associated files.

    Args:
        recording_id: The recording folder ID to delete
    """
    storage = get_storage_path()
    d = storage / recording_id
    if not d.exists():
        return json.dumps({"error": f"Recording '{recording_id}' not found"})

    shutil.rmtree(d)
    return json.dumps({"success": True, "message": f"Recording '{recording_id}' deleted"})


if __name__ == "__main__":
    mcp.run()
