# CCTV_Streaming

ESP32-CAM MJPEG 스트림을 HLS로 변환해 웹에서 재생하는 프로젝트입니다.

현재 동작 경로:

```text
ESP32-CAM(MJPEG) -> ffmpeg(HLS) -> Spring Boot(/hls + /api) -> React(hls.js)
```

## 디렉터리

- `apps/backend`: Spring Boot API, 인증, HLS 정적 서빙
- `apps/frontend`: React + Vite + TypeScript 대시보드
- `apps/cctv/device`: ESP32-CAM firmware (MJPEG HTTP)
- `scripts/mjpeg_to_hls.sh`: MJPEG -> HLS 변환 스크립트

## 요구사항

- Java 17+
- Node.js 18+
- ffmpeg (system PATH)
- PlatformIO (ESP32 업로드 시)

## 실행 순서

프로젝트 루트(`/home/juno/Workspace/CCTV_Streaming`) 기준:

1) 백엔드 실행

```bash
export AUTH_JWT_SECRET='replace-with-long-random-secret-32bytes-min'
export AUTH_USERS='admin:{plain}admin123:*;viewer:{plain}viewer123:mystream'
# Optional: if frontend origin is not localhost:5174, allow it explicitly.
# Example: http://122.45.250.216:5174
export API_ALLOWED_ORIGINS='http://localhost:5174,http://127.0.0.1:5174'
export HLS_ALLOWED_ORIGINS="$API_ALLOWED_ORIGINS"
cd apps/backend
./gradlew bootRun
```

`AUTH_USERS` 포맷: `username:passwordSpec:stream1,stream2`

- `passwordSpec` 권장: `{bcrypt}<hash>`
- 개발용(임시): `{plain}<password>`

2) MJPEG -> HLS 변환 실행

```bash
cd ../..
MJPEG_URL=http://<device-ip>:81/stream STREAM_ID=mystream ./scripts/mjpeg_to_hls.sh
```

3) 프론트 실행

```bash
npm --prefix apps/frontend install
npm --prefix apps/frontend run dev
```

4) 접속

- 대시보드: `http://localhost:5174`
- HLS 매니페스트: `http://localhost:8081/hls/mystream.m3u8`
- 헬스체크: `http://localhost:8081/health`
- 스트림 상태 API: `http://localhost:8081/api/streams/health`
- 통합 헬스 API: `http://localhost:8081/api/system/health`

## 통합 실행 스크립트

개별 명령 대신 아래 스크립트로 실행/종료를 일원화할 수 있습니다.

```bash
# 백엔드 + 프론트
./scripts/dev-up.sh

# 백엔드 + 프론트 + 더미 스트림(docs/video.mp4 기반)
./scripts/dev-up.sh --with-dummy

# 선택: ffmpeg test pattern 기반으로 실행
SOURCE_MODE=testsrc ./scripts/dev-up.sh --with-dummy
```

상태 확인/종료:

```bash
./scripts/dev-status.sh
./scripts/dev-down.sh
```

PID/로그:

- PID: `.run/pids`
- 로그: `.run/logs`

## 로그인 계정 (기본)

백엔드는 더 이상 코드에 기본 계정을 하드코딩하지 않습니다.
실행 전 `AUTH_USERS` 환경변수를 반드시 설정해야 합니다.

예시:

- `admin / admin123` -> `admin:{plain}admin123:*`
- `viewer / viewer123` -> `viewer:{plain}viewer123:mystream`

## 문제 확인 포인트

- 카메라 스트림 확인: `http://<device-ip>:81/stream`
- HLS 파일 생성 확인: `ls apps/backend/hls`
- `mystream.m3u8`가 없으면 웹 재생이 불가합니다.
- 버퍼링/지연이 크면 GOP를 세그먼트 길이에 맞춰 실행:

```bash
FRAMERATE=15 KEYINT=15 HLS_TIME=1 HLS_LIST_SIZE=4 ./scripts/dev-up.sh --with-dummy
```

ESP32-CAM Wi-Fi 자격증명은 `apps/cctv/device/main.cpp` 상단에서 직접 설정합니다.

## 운영 팁

`scripts/mjpeg_to_hls.sh`는 동일 `STREAM_ID` 중복 실행을 lock으로 차단하고,
실패 반복 시 자동 백오프 재시도를 수행합니다.

추가로 입력 MJPEG URL 사전 프로브를 수행해(기본 `SOURCE_PROBE_ENABLED=true`)
소스가 죽은 상태에서 ffmpeg 프로세스를 무의미하게 반복 기동하지 않도록 되어 있습니다.
