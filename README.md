# CCTV_Streaming

PoC for real-time CCTV streaming with a Python WebRTC relay (test app), Spring Boot signaling, and a React player.

## Architecture

WebRTC (default):

```
RTSP/MJPEG/Local File -> Python Relay (aiortc) -> Spring Boot (signaling) -> React WebRTC Player
```

Optional HLS:

```
RTSP -> ffmpeg (HLS) -> Spring Boot (static /hls) -> React HLS Player
```

## Quick Start (WebRTC)

1) Start back-end (signaling server)

```bash
apps/back-end/run.sh
```

2) Start test relay

```bash
cd apps/cctv/test
python -m venv venv
venv\Scripts\activate  # Windows
# or: source venv/bin/activate  # macOS/Linux
pip install --upgrade pip setuptools wheel cython
pip install -r requirements.txt
python webrtc_relay.py
```

3) Start front-end

```bash
npm --prefix apps/front-end install
npm --prefix apps/front-end run dev
```

Open `http://localhost:5173` in the browser.

## Quick Start (HLS)

1) Start back-end

```bash
apps/back-end/run.sh
```

2) Convert RTSP to HLS

```bash
scripts/rtsp_to_hls.sh
```

3) Switch front-end to HLS (optional)

`apps/front-end/src/App.jsx` can be updated to render `HlsPlayer` instead of `StreamPlayer`.

HLS base URL:

```
http://localhost:8080/hls/mystream.m3u8
```

## ESP32-CAM

Firmware project (PlatformIO):

- `apps/cctv/device/platformio-esp32cam-mjpeg`

After flashing, configure the test relay to read the MJPEG stream:

```bash
export SOURCE_MODE=mjpeg
export MJPEG_URL=http://<device-ip>:81/stream
python apps/cctv/test/webrtc_relay.py
```

## Environment Variables

### Test Relay (`apps/cctv/test/webrtc_relay.py`)

- `SIGNAL_URL`: signaling server WebSocket URL (`ws://localhost:8080/signal`)
- `SOURCE_MODE`: `auto|rtsp|mjpeg|file` (default `auto`)
- `RTSP_URL`: RTSP URL (`rtsp://localhost:8554/mystream`)
- `MJPEG_URL`: MJPEG URL (`http://<device-ip>:81/stream`)
- `LOCAL_FILE`: local fallback file (`docs/video.mp4`)
- `LOOP_FILE`: loop local file (`true`/`false`)
- `ICE_SERVERS`: JSON array for ICE servers
- `RTSP_OPTIONS`: JSON for ffmpeg RTSP options
- `MJPEG_OPTIONS`: JSON for ffmpeg MJPEG options
- `LOG_LEVEL`: log level (default `INFO`)
- `STATS_INTERVAL`: outbound stats interval in seconds (0 disables)

### Front-end

- `VITE_SIGNAL_URL`: WebSocket signaling URL
- `VITE_ICE_SERVERS`: JSON array for ICE servers
- `VITE_DEBUG_WEBRTC`: `true` to enable logs
- `VITE_HLS_BASE_URL`: HLS base URL
- `VITE_HLS_URL`: full HLS URL override

### Back-end

- `hls.path`: HLS output path (`apps/back-end/src/main/resources/application.properties`)

## Directory Layout

```
apps/
  back-end/     # Spring Boot (signaling + HLS static)
  cctv/
    device/     # ESP32-CAM firmware (PlatformIO)
    test/       # Python WebRTC relay (local/MJPEG/RTSP test)
  front-end/    # React player
scripts/
  rtsp_to_hls.sh
```
