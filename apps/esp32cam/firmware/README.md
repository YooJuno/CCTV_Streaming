# ESP32-CAM Firmware

This folder contains a minimal ESP32-CAM sketch that serves an MJPEG stream over HTTP.

## Build and Flash (Arduino IDE)

1. Install the ESP32 boards package ("esp32" by Espressif Systems).
2. Open `esp32cam_mjpeg/esp32cam_mjpeg.ino`.
3. Set `WIFI_SSID` and `WIFI_PASSWORD`.
4. Select board: `AI Thinker ESP32-CAM`.
5. Select the correct COM port and upload speed (115200 or 921600).
6. Enter flash mode: connect `IO0` to `GND`, press `RST`, upload.
7. After upload, disconnect `IO0` from `GND` and press `RST`.
8. Open Serial Monitor at 115200 to see the IP address.

## URLs

- Status page: `http://<device-ip>/`
- MJPEG stream: `http://<device-ip>:81/stream`

## Use With This Project

Set the gateway to read the MJPEG stream:

```bash
export SOURCE_MODE=mjpeg
export MJPEG_URL=http://<device-ip>:81/stream
python gateway.py
```
