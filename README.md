# CCTV_Streaming

RTSP to HLS CCTV streaming PoC.

## Architecture

```text
RTSP Camera -> ffmpeg (HLS) -> Spring Boot (/hls static) -> React (hls.js)
```

## Components

- `apps/back-end`: Spring Boot API + HLS static file serving
- `apps/front-end`: React player using `hls.js`
- `scripts/rtsp_to_hls.sh`: RTSP to HLS conversion
- `scripts/publish_rtsp.sh`: local RTSP source publisher (optional)
- `scripts/rtsp_to_hls.ps1`: Windows PowerShell RTSP to HLS conversion
- `scripts/publish_rtsp.ps1`: Windows PowerShell local RTSP source publisher
- `apps/cctv/device/pc_rtsp_publisher.py`: PC RTSP publisher using local video

## Quick Start (HLS only)

Prerequisites:

- Java 17+
- Node.js 18+
- `ffmpeg`

1) Start back-end

```bash
apps/back-end/run.sh
```

Windows (PowerShell):

```powershell
cd apps/back-end
.\gradlew.bat bootRun
```

2) Convert RTSP to HLS

```bash
# Example
RTSP_URL=rtsp://<camera-host>/stream1 STREAM_ID=mystream scripts/rtsp_to_hls.sh
```

If you need a local RTSP source for testing:

```bash
python apps/cctv/device/pc_rtsp_publisher.py --rtsp-url rtsp://localhost:8554/mystream
```

Windows users can use PowerShell scripts:

```powershell
.\scripts\publish_rtsp.ps1 -RtspUrl rtsp://localhost:8554/mystream
.\scripts\rtsp_to_hls.ps1 -RtspUrl rtsp://localhost:8554/mystream -StreamId mystream
```

3) Start front-end

```bash
npm --prefix apps/front-end install
npm --prefix apps/front-end run dev
```

4) Open player

- Front-end: `http://localhost:5173`
- HLS manifest example: `http://localhost:8080/hls/mystream.m3u8`

## RTSP to HLS script variables

- `RTSP_URL`: input RTSP URL
- `STREAM_ID`: output stream id (`<streamId>.m3u8`)
- `HLS_DIR`: output directory (default `apps/back-end/hls`)
- `HLS_TIME`: segment duration seconds (default `2`)
- `HLS_LIST_SIZE`: manifest window size (default `10`)
- `HLS_DELETE`: delete old segments (`true|false`)
- `RTSP_TRANSPORT`: `tcp|udp` (default `tcp`)
- `TRANSCODE`: force H.264/AAC transcoding (`true|false`, default `false`)
- `VIDEO_CODEC`: ffmpeg video codec when transcoding (default `libx264`)
- `AUDIO_CODEC`: ffmpeg audio codec when transcoding (default `aac`)

Front-end options:

- `VITE_HLS_BASE_URL`: base URL for manifests
- `VITE_HLS_URL`: full manifest URL override
- `VITE_STREAM_ID`: default stream id shown in UI

Back-end options:

- `hls.path`: directory served as `/hls/**`
- `hls.allowed-origins`: comma-separated CORS origins for HLS resources

## Notes for ESP32-CAM

Current firmware in `apps/cctv/device` outputs MJPEG over HTTP (`http://<device-ip>:81/stream`), not RTSP.

If you must keep RTSP-first architecture, put a small media gateway in front of ESP32 to republish as RTSP, then run `scripts/rtsp_to_hls.sh`.
