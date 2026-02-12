# ESP32-CAM 펌웨어 (PlatformIO)

이 폴더는 ESP32‑CAM이 HTTP로 MJPEG 스트림을 내보내는 PlatformIO 프로젝트를 포함합니다.

## 프로젝트 위치

- `apps/cctv/device/`

## PlatformIO (VS Code) 업로드 요약

1) VS Code 설치
2) PlatformIO IDE 확장 설치
3) 폴더 열기: `apps/cctv/device`
4) `main.cpp`에서 Wi‑Fi 정보 수정

```cpp
const char *WIFI_SSID = "YOUR_WIFI_SSID";
const char *WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
```

5) 업로드 모드 진입

- `IO0` -> `GND` 연결
- `RST` 버튼 눌러 리셋

6) PlatformIO에서 Upload 실행

- 좌측 PlatformIO 탭 -> `Upload`
- 또는 단축키: `Ctrl+Alt+U`

7) 업로드 후

- `IO0` -> `GND` 연결 해제
- `RST` 버튼 눌러 재부팅

8) 시리얼 모니터

- PlatformIO 탭 -> `Monitor`
- 보드레이트: `115200`

※ 업로드가 자주 실패하면 `platformio.ini`의 `upload_speed`를 `115200`으로 낮춰보세요.

## URL

- 상태 페이지: `http://<device-ip>/`
- MJPEG 스트림: `http://<device-ip>:81/stream`

## 연동

테스트 중계 실행 시 아래 환경 변수를 사용합니다.

```bash
export SOURCE_MODE=mjpeg
export MJPEG_URL=http://<device-ip>:81/stream
python apps/cctv/test/webrtc_relay.py
```

더 자세한 설명은 `apps/cctv/test/README.md`를 참고하세요.
