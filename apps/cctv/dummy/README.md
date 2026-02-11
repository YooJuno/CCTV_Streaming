# ESP32-CAM 개발 가이드 (Gateway + Firmware)

이 문서는 ESP32‑CAM으로 촬영한 영상을 이 프로젝트에서 보는 전체 과정을 간단하고 쉽게 정리한 가이드입니다.

## 구조

- 게이트웨이: `apps/cctv/dummy/gateway.py`
- 펌웨어: `apps/cctv/firmware/esp32cam_mjpeg/esp32cam_mjpeg.ino`

## 전체 흐름

```
ESP32‑CAM -> MJPEG(HTTP) -> Python Gateway(aiortc) -> Spring Boot(Signaling) -> React(WebRTC)
```

## 준비물

- ESP32‑CAM 보드 (AI Thinker 권장)
- USB‑TTL(FTDI) 어댑터
- 점퍼 케이블
- (권장) 안정적인 5V 전원

## 1. 펌웨어 올리기 (Arduino IDE)

1) Arduino IDE 설치
2) 보드 매니저에서 `esp32 by Espressif Systems` 설치
3) 스케치 열기: `apps/cctv/firmware/esp32cam_mjpeg/esp32cam_mjpeg.ino`
4) Wi‑Fi 정보 입력

```cpp
const char *WIFI_SSID = "YOUR_WIFI_SSID";
const char *WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
```

5) 보드 선택: `AI Thinker ESP32-CAM`
6) 업로드 모드 진입

- `IO0` -> `GND` 연결
- `RST` 버튼 눌러 리셋
- 업로드 시작

7) 업로드 완료 후

- `IO0` -> `GND` 연결 해제
- `RST` 버튼 눌러 재부팅

8) 시리얼 모니터 열기

- 보드레이트: `115200`
- 출력 예시

```
WiFi connected. IP address: 192.168.0.25
MJPEG stream: http://192.168.0.25:81/stream
```

## 2. 동작 확인

- 상태 페이지: `http://<device-ip>/`
- MJPEG 스트림: `http://<device-ip>:81/stream`

브라우저에서 `http://<device-ip>/`로 접속하면 간단한 미리보기 페이지가 보입니다.

## 3. 게이트웨이 실행 (Python)

### 설치

```bash
cd apps/cctv/dummy
python -m venv venv
venv\Scripts\activate  # Windows
# 또는: source venv/bin/activate  # macOS/Linux

pip install --upgrade pip setuptools wheel cython
pip install -r requirements.txt
```

### 실행 (ESP32‑CAM MJPEG)

PowerShell:

```powershell
$env:SOURCE_MODE = "mjpeg"
$env:MJPEG_URL = "http://<device-ip>:81/stream"
python gateway.py
```

macOS/Linux:

```bash
export SOURCE_MODE=mjpeg
export MJPEG_URL=http://<device-ip>:81/stream
python gateway.py
```

### 실행 (RTSP)

```bash
export SOURCE_MODE=rtsp
export RTSP_URL=rtsp://<rtsp-host>:8554/mystream
python gateway.py
```

## 4. 화면 보기 (전체 구동)

1) 백엔드 실행

macOS/Linux:

```bash
apps/back-end/run.sh
```

Windows:

```powershell
cd apps/back-end
.\gradlew.bat bootRun
```

2) 게이트웨이 실행 (위 3번 참고)
3) 프론트엔드 실행

```bash
npm --prefix apps/front-end install
npm --prefix apps/front-end run dev
```

브라우저에서 `http://localhost:5173` 접속

## 환경 변수 요약

- `SIGNAL_URL`: signaling 서버 WebSocket (기본 `ws://localhost:8080/signal`)
- `SOURCE_MODE`: `auto|rtsp|mjpeg|file`
- `RTSP_URL`: RTSP 입력
- `MJPEG_URL`: ESP32‑CAM MJPEG 입력 (예: `http://<ip>:81/stream`)
- `LOCAL_FILE`: 로컬 파일 경로
- `ICE_SERVERS`: ICE 서버 JSON
- `RTSP_OPTIONS`: RTSP ffmpeg 옵션 JSON
- `MJPEG_OPTIONS`: MJPEG ffmpeg 옵션 JSON

## 자주 겪는 문제

- 업로드가 안 될 때: `IO0`가 `GND`에 연결된 상태에서 업로드했는지 확인하고, 업로드 후에는 `IO0` 연결을 해제해야 실행 모드로 부팅됩니다.
- 카메라 초기화 실패: 보드 종류가 `AI Thinker ESP32-CAM`인지 확인하고, 전원이 약하면 실패할 수 있습니다 (가능하면 5V 외부 전원 사용).
- 스트림이 끊김/느림: 해상도를 낮추거나(`FRAMESIZE_CIF`) JPEG 품질 값을 올려보세요. Wi‑Fi 신호가 약하면 끊길 수 있습니다.

## 참고

펌웨어 상세 설명은 `apps/cctv/firmware/README.md`를 참고하세요.
