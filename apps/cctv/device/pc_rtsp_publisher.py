#!/usr/bin/env python3
"""
PC RTSP publisher for local CCTV pipeline testing.

Behavior:
- reads a local video file
- loops forever
- publishes to an RTSP server

Default input:
  <repo-root>/docs/video.mp4

Default output:
  rtsp://localhost:8554/mystream
"""

from __future__ import annotations

import argparse
import shutil
import signal
import subprocess
import sys
from pathlib import Path


def repo_root() -> Path:
    # apps/cctv/device/pc_rtsp_publisher.py -> repo root is 3 levels up
    return Path(__file__).resolve().parents[3]


def parse_args() -> argparse.Namespace:
    root = repo_root()
    default_video = root / "docs" / "video.mp4"

    parser = argparse.ArgumentParser(
        description="Loop local video and publish as RTSP stream with ffmpeg."
    )
    parser.add_argument(
        "--video",
        type=Path,
        default=default_video,
        help=f"Input video path (default: {default_video})",
    )
    parser.add_argument(
        "--rtsp-url",
        default="rtsp://localhost:8554/mystream",
        help="Target RTSP URL",
    )
    parser.add_argument(
        "--transport",
        choices=("tcp", "udp"),
        default="tcp",
        help="RTSP transport (default: tcp)",
    )
    parser.add_argument(
        "--transcode",
        action="store_true",
        help="Force H.264/AAC encoding instead of stream copy",
    )
    return parser.parse_args()


def build_ffmpeg_cmd(video: Path, rtsp_url: str, transport: str, transcode: bool) -> list[str]:
    base = [
        "ffmpeg",
        "-re",
        "-stream_loop",
        "-1",
        "-i",
        str(video),
        "-rtsp_transport",
        transport,
    ]

    if transcode:
        codec = [
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-tune",
            "zerolatency",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
        ]
    else:
        codec = ["-c", "copy"]

    return [*base, *codec, "-f", "rtsp", rtsp_url]


def main() -> int:
    args = parse_args()
    video_path = args.video.resolve()

    if shutil.which("ffmpeg") is None:
        print("ERROR: ffmpeg is not installed or not in PATH.", file=sys.stderr)
        return 1

    if not video_path.exists():
        print(f"ERROR: video file not found: {video_path}", file=sys.stderr)
        return 1

    cmd = build_ffmpeg_cmd(
        video=video_path,
        rtsp_url=args.rtsp_url,
        transport=args.transport,
        transcode=args.transcode,
    )

    print(f"Input : {video_path}")
    print(f"Output: {args.rtsp_url}")
    print("Command:")
    print(" ".join(cmd))
    print("Press Ctrl+C to stop.")

    proc = subprocess.Popen(cmd)

    def _stop(_sig: int, _frame: object) -> None:
        if proc.poll() is None:
            proc.terminate()

    signal.signal(signal.SIGINT, _stop)
    signal.signal(signal.SIGTERM, _stop)

    try:
        return proc.wait()
    except KeyboardInterrupt:
        _stop(signal.SIGINT, None)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
