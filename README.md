# CCTV_Streaming

RTSP 입력 영상을 HLS로 변환해 브라우저에서 재생하는 CCTV 스트리밍 프로젝트입니다.

현재 구조는 WebRTC 없이 다음 경로로 동작합니다.

```text
RTSP 소스 -> ffmpeg(HLS 변환) -> Spring Boot(/hls + /api) -> React(hls.js)
```

## 핵심 업그레이드

- 프론트엔드: React 19 + TypeScript 전환
- 프론트엔드: 로그인/JWT 기반 멀티 스트림 대시보드
- 프론트엔드: HLS 재생 안정화(재시도/복구) 및 지표(지연/버퍼/드롭프레임/stall) 표시
- 백엔드: JWT 인증 + 스트림별 권한 제어(`/hls/**` 접근 통제)
- 테스트: 백엔드(MockMvc), 프론트(Vitest) 추가

## 디렉터리 구성

- `apps/back-end`: Spring Boot API/인증/HLS 정적 서빙
- `apps/front-end`: React + Vite + TypeScript 대시보드
- `apps/cctv/device`: ESP32-CAM(MJPEG HTTP) + PC RTSP 테스트 퍼블리셔
- `scripts/rtsp_to_hls.sh`: RTSP -> HLS 변환
- `scripts/publish_rtsp.sh`: 로컬 영상 -> RTSP 송출

## 요구사항

- Linux
- Java 17+
- Node.js 18+
- ffmpeg (PATH 등록 필요)

## 빠른 시작 (Linux)

프로젝트 루트에서 실행합니다.

1) 백엔드 실행

```bash
cd apps/back-end
./gradlew bootRun
```

2) 테스트 RTSP 송출 (`docs/video.mp4` 무한 반복)

```bash
cd ../..
./scripts/publish_rtsp.sh
```

3) RTSP -> HLS 변환

```bash
./scripts/rtsp_to_hls.sh
```

4) 프론트 실행

```bash
npm --prefix apps/front-end install
npm --prefix apps/front-end run dev
```

5) 접속

- 대시보드: `http://localhost:5173`
- HLS 매니페스트: `http://localhost:8080/hls/mystream.m3u8`
- 헬스체크: `http://localhost:8080/health`

## 기본 로그인 계정 (PoC)

`apps/back-end/src/main/resources/application.properties` 기준:

- `admin / admin123` (모든 스트림 접근 가능: `*`)
- `viewer / viewer123` (`mystream`만 접근)

## 주요 API

- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/streams`
- `GET /hls/{streamId}.m3u8` (JWT 필요)
- `GET /health`

## 주요 설정값

`apps/back-end/src/main/resources/application.properties`

- `hls.path`: HLS 파일 디렉터리
- `hls.allowed-origins`: `/hls/**` CORS 허용 Origin
- `api.allowed-origins`: `/api/**` CORS 허용 Origin
- `auth.jwt.secret`: JWT 서명 키
- `auth.jwt.expiration-seconds`: 토큰 만료 시간(초)
- `auth.users`: 사용자/비밀번호/권한 스트림
- `streams.catalog`: 스트림 카탈로그 (`id:name;id:name`)

`apps/front-end` 환경변수:

- `VITE_API_BASE_URL`
- `VITE_HLS_BASE_URL`
- `VITE_HLS_URL` (단일 스트림 디버깅용 override)
- `VITE_DEFAULT_USERNAME`
- `VITE_DEFAULT_PASSWORD`

## 테스트

백엔드:

```bash
cd apps/back-end
./gradlew test
```

프론트:

```bash
cd apps/front-end
npm run test:run
```

## ESP32-CAM 연동 참고

`apps/cctv/device/main.cpp`는 RTSP가 아니라 MJPEG HTTP를 출력합니다.

- 상태 페이지: `http://<device-ip>/`
- MJPEG 스트림: `http://<device-ip>:81/stream`

RTSP 파이프라인에 붙이려면 재패키징 단계가 필요합니다.

```bash
ffmpeg -f mjpeg -i http://<device-ip>:81/stream -c:v libx264 -f rtsp rtsp://<rtsp-server>:8554/mystream
```

그 다음 `scripts/rtsp_to_hls.sh`를 실행하면 됩니다.
