# Back End (Spring Boot)

이 앱은 **WebRTC 시그널링(WebSocket)**과 **HLS 정적 서빙**만 담당합니다.  
전체 실행 방법은 저장소 루트 `README.md`를 참고하세요.

기본 엔드포인트

- WebSocket: `/signal`
- Health: `/health`
- Streams: `/streams`
- HLS: `/hls/{streamId}.m3u8`
