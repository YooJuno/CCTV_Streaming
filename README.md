# CCTV_Streaming

ESP32-CAM MJPEG 스트림을 HLS로 변환해 웹에서 재생하는 프로젝트입니다.

```text
ESP32-CAM(MJPEG) -> ffmpeg(HLS) -> Spring Boot(/hls + /api) -> React(hls.js)
```

## 필수 요구사항

- Java 17+
- Node.js 18+
- ffmpeg (PATH에 설치)
- PlatformIO (디바이스 펌웨어 업로드 시)

## 1분 실행 (권장)

프로젝트 루트(`/home/juno/Workspace/CCTV_Streaming`)에서:

```bash
# 1) 프론트 의존성 설치 (최초 1회)
npm --prefix apps/frontend install

# 2) ffmpeg 확인
ffmpeg -version

# 3) 통합 실행 (실장비 카메라)
./scripts/dev-up.sh --with-converter --mjpeg-url http://192.168.219.106:81/stream
```

접속:

- Dashboard: `http://localhost:5174`
- HLS: `http://localhost:8081/hls/mystream.m3u8`
- Health: `http://localhost:8081/health`

종료/상태:

```bash
./scripts/dev-status.sh
./scripts/dev-down.sh
```

로그/프로세스:

- 로그: `.run/logs`
- PID: `.run/pids`

## 더미 소스로 실행

```bash
# docs/video.mp4 기반
./scripts/dev-up.sh --with-dummy

# ffmpeg test pattern 강제
SOURCE_MODE=testsrc ./scripts/dev-up.sh --with-dummy
```

## dev-up / dev-down

`scripts/dev-up.sh`는 백엔드/프론트(선택적으로 converter)까지 한 번에 기동합니다.

```bash
# 백엔드 + 프론트
./scripts/dev-up.sh

# 백엔드 + 프론트 + converter(실장비)
./scripts/dev-up.sh --with-converter --mjpeg-url http://192.168.219.106:81/stream

# 백엔드 + 프론트 + 더미 소스 + converter
./scripts/dev-up.sh --with-dummy
```

중지/상태 확인:

```bash
./scripts/dev-down.sh
./scripts/dev-status.sh
```

자주 쓰는 옵션:

- `--with-converter`: MJPEG -> HLS converter 함께 실행
- `--mjpeg-url <url>`: 카메라 스트림 URL 지정
- `--with-dummy`: 더미 MJPEG 소스 + converter 실행
- `--stream-id <id>`: 스트림 ID 지정(기본 `mystream`)

## 수동 실행 (개별 프로세스)

```bash
# backend
export AUTH_JWT_SECRET='replace-with-long-random-secret-32bytes-min'
export AUTH_USERS='admin:{plain}admin123:*;viewer:{plain}viewer123:mystream'
export API_ALLOWED_ORIGINS='http://localhost:5174,http://127.0.0.1:5174'
export HLS_ALLOWED_ORIGINS="$API_ALLOWED_ORIGINS"
cd apps/backend && ./gradlew bootRun

# converter (새 터미널)
cd /home/juno/Workspace/CCTV_Streaming
MJPEG_URL=http://<device-ip>:81/stream STREAM_ID=mystream ./scripts/mjpeg_to_hls.sh

# frontend (새 터미널)
npm --prefix apps/frontend run dev
```

## 자주 막히는 포인트

- `ffmpeg command not found`: `ffmpeg` 설치 후 재실행.
- `mystream.m3u8` 없음: 카메라 URL 확인 후 converter 로그 점검.
- CORS 403: `API_ALLOWED_ORIGINS`, `HLS_ALLOWED_ORIGINS`에 실제 접속 Origin 추가.

## 참고

- ESP32-CAM Wi-Fi 자격증명은 `apps/cctv/device/main.cpp` 상단에서 설정합니다.
- `AUTH_USERS` 형식: `username:passwordSpec:stream1,stream2`

## 품질 게이트

```bash
# frontend
npm --prefix apps/frontend run typecheck
npm --prefix apps/frontend run test:run
npm --prefix apps/frontend run build
npm --prefix apps/frontend run e2e

# backend
cd apps/backend && ./gradlew test
```

CI 파이프라인은 `.github/workflows/ci.yml`에 정의되어 있으며, PR 기준으로 backend test + frontend typecheck/test/build/e2e를 모두 통과해야 합니다.

## 아키텍처 노트

- 프론트: feature hooks 중심(`src/features/*`) + presentational components 분리
- 백엔드: `api/*(controller/dto/mapper)` + `domain/*(service)` 구조
- API 계약: [`docs/api/API_CONTRACT.md`](docs/api/API_CONTRACT.md) (v1, backward compatible)
