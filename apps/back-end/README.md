# CCTV Back End (Spring Boot)

구성

- Spring Boot 애플리케이션이 WebSocket 시그널링 엔드포인트 `/signal`을 제공
- Gateway(미디어 브리지)는 WebSocket에 `register` 메시지로 자신이 제공하는 스트림을 등록
- 브라우저가 `watch` 요청을 보내면 Spring이 해당 게이트웨이로 전달하고, 게이트웨이는 WebRTC offer/answer로 교환

빌드/실행

JDK 17+ 필요

1. 백엔드 실행

```bash
cd apps/back-end
./gradlew bootRun
```

(gradle wrapper가 없을 경우 `gradle bootRun` 또는 IntelliJ에서 실행)

설치되어야 할 외부 도구

- ffmpeg (macOS: `brew install ffmpeg`)
- rtsp-simple-server (`https://github.com/aler9/rtsp-simple-server`) — esp32cam(모사)이 RTSP로 푸시할 때 필요
- Python 3.9+ (aiortc) — 미디어 브리지 (gateway) 구현에 사용

간단 실행 스크립트

```bash
cd apps/back-end
chmod +x run.sh
./run.sh
```

유용한 엔드포인트

- Health: `GET /health` — 상태 확인
- Streams: `GET /streams` — 등록된 스트림 목록 (streamId -> gatewaySessionId)
