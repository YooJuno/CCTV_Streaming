# ESP32-CAM firmware (PlatformIO)

이 폴더는 ESP32-CAM이 MJPEG HTTP 스트림을 출력하도록 하는 펌웨어입니다.

## 경로

- `apps/cctv/device`

## 빌드

```bash
cd apps/cctv/device
~/.platformio/penv/bin/pio run -e esp32cam
```

## 업로드

PlatformIO 업로드가 `tool-mkspiffs`에서 멈추면 직접 플래시를 권장합니다.

```bash
~/.platformio/penv/bin/python ~/.platformio/packages/tool-esptoolpy/esptool.py \
  --chip esp32 --port /dev/cu.usbserial-1130 --baud 115200 \
  --before default_reset --after hard_reset write_flash -z \
  --flash_mode dio --flash_freq 40m --flash_size detect \
  0x1000 .pio/build/esp32cam/bootloader.bin \
  0x8000 .pio/build/esp32cam/partitions.bin \
  0x10000 .pio/build/esp32cam/firmware.bin
```

## 시리얼 모니터

```bash
~/.platformio/penv/bin/pio device monitor -b 115200 --port /dev/cu.usbserial-1130
```

## 출력 URL

- 상태 페이지: `http://<device-ip>/`
- MJPEG 스트림: `http://<device-ip>:81/stream`

## 프로젝트 연동

프로젝트 루트에서 MJPEG를 HLS로 변환합니다.

```bash
MJPEG_URL=http://<device-ip>:81/stream STREAM_ID=mystream ./scripts/mjpeg_to_hls.sh
```
