# Dummy CCTV Test Source

`docs/video.mp4`를 ESP32-CAM처럼 MJPEG 스트림으로 송출해서,
백엔드/HLS 파이프라인을 카메라 없이 테스트하기 위한 도구입니다.

## Quick Start

프로젝트 루트에서:

```bash
./apps/cctv/test/run_test_stream.sh
```

이 스크립트는 다음을 자동으로 수행합니다.

1. `docs/video.mp4`를 MJPEG로 송출 (`http://127.0.0.1:18081/stream`)
2. `scripts/mjpeg_to_hls.sh`를 `STREAM_ID=mystream`으로 실행
3. `apps/backend/hls`에 HLS 파일 생성

백엔드가 `8081`에서 실행 중이면 프론트에서 바로 `mystream` 재생이 가능합니다.

`run_test_stream.sh`는 더미 소스 특성상 변환 단계에서 `SOURCE_PROBE_ENABLED=false`로 실행됩니다.

## Commands

더미 카메라만 단독 실행:

```bash
./apps/cctv/test/dummy_mjpeg_camera.sh
```

환경변수로 세부 조정:

```bash
DUMMY_PORT=18081 STREAM_ID=mystream VIDEO_FILE=./docs/video.mp4 STARTUP_DELAY_SECONDS=1 ./apps/cctv/test/run_test_stream.sh
```

## Notes

- 기본 포트는 `18081`입니다. (`81`은 로컬에서 root 권한이 필요할 수 있음)
- 현재 백엔드 파이프라인은 RTSP가 아니라 MJPEG 입력(`-f mjpeg`) 기준이므로,
  테스트 소스도 MJPEG로 맞춰 제공됩니다.
- `run_test_stream.sh`는 더미 소스 특성상 readiness probe 대신 짧은 startup delay 후 변환을 시작합니다.
