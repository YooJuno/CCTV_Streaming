# ESP32Cam Gateway (aiortc)

This directory hosts the Python WebRTC gateway and optional ESP32-CAM firmware.

- Gateway: `gateway.py` reads RTSP, MJPEG, or local files and publishes WebRTC.
- Firmware: `firmware/` contains an ESP32-CAM MJPEG streaming sketch.

## Requirements

- Python 3.11 recommended
- ffmpeg
- pkg-config (for PyAV builds)

## Install and Run (Gateway)

```bash
cd apps/esp32cam
python -m venv venv
venv\Scripts\activate  # Windows
# or: source venv/bin/activate  # macOS/Linux

pip install --upgrade pip setuptools wheel cython
pip install -r requirements.txt
python gateway.py
```

## Source Configuration

Environment variables:

- `SIGNAL_URL`: WebSocket signaling URL (default `ws://localhost:8080/signal`)
- `SOURCE_MODE`: `auto|rtsp|mjpeg|file` (default `auto`)
- `RTSP_URL`: RTSP URL (default `rtsp://localhost:8554/mystream`)
- `MJPEG_URL`: MJPEG stream URL (ex: `http://<device-ip>:81/stream`)
- `LOCAL_FILE`: fallback file (default `docs/video.mp4`)
- `LOOP_FILE`: loop local file (`true`/`false`)
- `ICE_SERVERS`: JSON array for ICE servers
- `RTSP_OPTIONS`: JSON options for ffmpeg RTSP input
- `MJPEG_OPTIONS`: JSON options for ffmpeg MJPEG input
- `LOG_LEVEL`: log level (default `INFO`)
- `STATS_INTERVAL`: seconds between outbound stats logs (0 disables)

### Example: ESP32-CAM MJPEG

```bash
export SOURCE_MODE=mjpeg
export MJPEG_URL=http://<device-ip>:81/stream
python gateway.py
```

### Example: RTSP

```bash
export SOURCE_MODE=rtsp
export RTSP_URL=rtsp://<rtsp-host>:8554/mystream
python gateway.py
```

## Firmware

See `apps/esp32cam/firmware/README.md` for the ESP32-CAM sketch.
