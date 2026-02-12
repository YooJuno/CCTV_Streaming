# ESP32-CAM 개발 가이드 (Device + Test)

이 문서는 ESP32‑CAM 영상 스트리밍을 **실제 보드(Device)**와 **테스트 중계(Test)**로 나눠서 설명합니다.
임베디드 기기가 없을 때는 로컬 파일로 테스트 중계를 실행할 수 있습니다.

## 구조

- 테스트 중계: `apps/cctv/test/webrtc_relay.py`
- 펌웨어: `apps/cctv/device/`

## 전체 흐름

```
ESP32‑CAM -> MJPEG(HTTP) -> Python Relay(aiortc) -> Spring Boot(Signaling) -> React(WebRTC)
```

## 1. Device (ESP32‑CAM 펌웨어)

펌웨어 빌드/업로드는 `apps/cctv/device/README.md`를 참고하세요.

## 2. Test (Python Relay)

### 설치

```bash
cd apps/cctv/test
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
python webrtc_relay.py
```

macOS/Linux:

```bash
export SOURCE_MODE=mjpeg
export MJPEG_URL=http://<device-ip>:81/stream
python webrtc_relay.py
```

### 실행 (RTSP)

```bash
export SOURCE_MODE=rtsp
export RTSP_URL=rtsp://<rtsp-host>:8554/mystream
python webrtc_relay.py
```

### 실행 (임베디드 기기 없이 로컬 파일)

```bash
export SOURCE_MODE=file
export LOCAL_FILE=docs/video.mp4
python webrtc_relay.py
```

`LOCAL_FILE`가 상대 경로이면 프로젝트 루트 기준으로 해석됩니다.

## 3. 화면 보기 (전체 구동)

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

2) 테스트 중계 실행 (위 2번 참고)
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

## 참고

- 장치 펌웨어 가이드: `apps/cctv/device/README.md`
