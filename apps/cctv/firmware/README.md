# ESP32-CAM 펌웨어 (MJPEG)

이 폴더는 ESP32‑CAM이 HTTP로 MJPEG 스트림을 내보내는 간단한 스케치를 포함합니다.

## 스케치

- 파일: `esp32cam_mjpeg/esp32cam_mjpeg.ino`

## 업로드 요약 (Arduino IDE)

1) Arduino IDE 설치
2) 보드 매니저에서 `esp32 by Espressif Systems` 설치
3) 스케치 열기
4) `WIFI_SSID`, `WIFI_PASSWORD` 설정
5) 보드 선택: `AI Thinker ESP32-CAM`
6) 업로드 모드: `IO0` -> `GND` 연결 후 `RST` 누르고 업로드
7) 업로드 후 `IO0` 분리, `RST` 재부팅
8) 시리얼 모니터(115200)에서 IP 확인

## URL

- 상태 페이지: `http://<device-ip>/`
- MJPEG 스트림: `http://<device-ip>:81/stream`

## 연동

게이트웨이 실행 시 아래 환경 변수를 사용합니다.

```bash
export SOURCE_MODE=mjpeg
export MJPEG_URL=http://<device-ip>:81/stream
python apps/cctv/dummy/gateway.py
```

더 자세한 설명은 `apps/cctv/dummy/README.md`를 참고하세요.
