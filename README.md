# CCTV_Streaming

ESP32-CAM MJPEG 스트림을 HLS로 변환해 웹에서 재생하는 프로젝트입니다.

현재 동작 경로:

```text
ESP32-CAM(MJPEG) -> ffmpeg(HLS) -> Spring Boot(/hls + /api) -> React(hls.js)
```

## 디렉터리

- `apps/back-end`: Spring Boot API, 인증, HLS 정적 서빙
- `apps/front-end`: React + Vite + TypeScript 대시보드
- `apps/cctv/device`: ESP32-CAM firmware (MJPEG HTTP)
- `scripts/mjpeg_to_hls.sh`: MJPEG -> HLS 변환 스크립트

## 요구사항

- Java 17+
- Node.js 18+
- ffmpeg
- PlatformIO (ESP32 업로드 시)

## 실행 순서

프로젝트 루트(`/Users/juno/Workspace/CCTV_Streaming`) 기준:

1) 백엔드 실행

```bash
cd apps/back-end
./gradlew bootRun
```

2) MJPEG -> HLS 변환 실행

```bash
cd ../..
MJPEG_URL=http://192.168.219.105:81/stream STREAM_ID=mystream ./scripts/mjpeg_to_hls.sh
```

3) 프론트 실행

```bash
npm --prefix apps/front-end install
npm --prefix apps/front-end run dev
```

4) 접속

- 대시보드: `http://localhost:5173`
- HLS 매니페스트: `http://localhost:8080/hls/mystream.m3u8`
- 헬스체크: `http://localhost:8080/health`

## 로그인 계정 (기본)

`apps/back-end/src/main/resources/application.properties`

- `admin / admin123`
- `viewer / viewer123`

## 문제 확인 포인트

- 카메라 스트림 확인: `http://<device-ip>:81/stream`
- HLS 파일 생성 확인: `ls apps/back-end/hls`
- `mystream.m3u8`가 없으면 웹 재생이 불가합니다.
