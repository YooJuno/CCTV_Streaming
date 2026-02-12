# ESP32-CAM firmware (PlatformIO)

This folder contains a PlatformIO project that streams MJPEG over HTTP from ESP32-CAM.

## Project path

- `apps/cctv/device/`

## PlatformIO upload summary

1) Install VS Code
2) Install PlatformIO IDE extension
3) Open folder: `apps/cctv/device`
4) Configure Wi-Fi (choose one)

- Option A: set build flags in `platformio.ini` (recommended)
- Option B: keep defaults in `main.cpp` and replace placeholder macros

```cpp
#ifndef WIFI_SSID
#define WIFI_SSID "YOUR_WIFI_SSID"
#endif
#ifndef WIFI_PASSWORD
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"
#endif
```

5) Enter upload mode

- Connect `IO0` to `GND`
- Press `RST`

6) Upload from PlatformIO (`Ctrl+Alt+U`)

7) After upload

- Disconnect `IO0` from `GND`
- Press `RST` again

8) Serial monitor at `115200`

## URLs

- Status page: `http://<device-ip>/`
- MJPEG stream: `http://<device-ip>:81/stream`

## Integration with this repo

The current app path is RTSP -> HLS.

This firmware outputs MJPEG, so you need a gateway step before HLS generation.

Example gateway command:

```bash
ffmpeg -f mjpeg -i http://<device-ip>:81/stream -c:v libx264 -f rtsp rtsp://<rtsp-server>:8554/mystream
```

Then run:

```bash
RTSP_URL=rtsp://<rtsp-server>:8554/mystream scripts/rtsp_to_hls.sh
```

## PC test publisher (local file -> RTSP)

`apps/cctv/device/pc_rtsp_publisher.py` provides a PC-side test source that loops `docs/video.mp4` forever and publishes to RTSP.

PowerShell example:

```powershell
python .\apps\cctv\device\pc_rtsp_publisher.py --rtsp-url rtsp://localhost:8554/mystream
```

Options:

- `--video`: input file path (default: `<repo>/docs/video.mp4`)
- `--rtsp-url`: target RTSP URL
- `--transport`: `tcp` or `udp` (default: `tcp`)
- `--transcode`: force H.264/AAC encoding instead of stream copy
