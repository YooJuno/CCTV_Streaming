# CCTV_Streaming

ESP32(또는 RTSP 소스)에서 들어오는 영상을 **웹에서 실시간으로 확인**할 수 있는 PoC입니다.  
현재는 **Python 게이트웨이(aiortc)**로 RTSP/파일을 WebRTC로 변환하고, **Spring Boot는 시그널링**만 담당합니다.

---

## 구성 요약

### 기본 모드 (WebRTC)

```
RTSP/파일 → Python Gateway(aiortc) → Spring Boot(시그널링) → React(WebRTC)
```

- 장점: 지연이 낮음(실시간에 가까움)
- 단점: NAT 환경은 TURN 필요

### 선택 모드 (HLS, 저장/뒤로가기용)

```
RTSP → ffmpeg(HLS) → Spring Boot(정적 서빙) → React(HLS 재생)
```

- 장점: 저장/뒤로가기 구현 쉬움
- 단점: 지연(보통 수 초) 발생

---

## 빠른 시작 (WebRTC)

### 1) 필수 도구 설치

```bash
# macOS (예시)
brew install --cask temurin
brew install ffmpeg pkg-config
brew install node
```

### 2) 백엔드 실행 (시그널링)

```bash
apps/back-end/run.sh
```

### 3) 게이트웨이 실행 (파일 → WebRTC)

```bash
export SOURCE_MODE=file
export LOCAL_FILE=/Users/juno/Workspace/CCTV_Streaming/docs/video.mp4

cd apps/esp32cam
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip setuptools wheel cython
pip install -r requirements.txt
python gateway.py
```

현재는 스트림 ID가 `mystream`으로 **고정**되어 있습니다.

### 4) 프론트 실행

```bash
npm --prefix apps/front-end run dev
```

브라우저에서 `http://localhost:5173` 접속 후 **시작** 클릭.

---

## HLS 모드 실행 (선택)

### 1) 백엔드 실행

```bash
apps/back-end/run.sh
```

### 2) RTSP → HLS 변환

```bash
chmod +x scripts/rtsp_to_hls.sh
./scripts/rtsp_to_hls.sh
```

### 3) 프론트에서 HLS 플레이어 사용

현재 `App.jsx`는 WebRTC 플레이어를 기본으로 사용합니다.  
HLS 테스트를 하려면 `apps/front-end/src/App.jsx`에서 `HlsPlayer`로 바꾸세요.

HLS 기본 URL:
```
http://localhost:8080/hls/mystream.m3u8
```

---

## 환경 변수

### gateway.py

- `SIGNAL_URL` : 시그널링 서버 URL (기본 `ws://localhost:8080/signal`)
- `RTSP_URL` : RTSP 소스 URL (기본 `rtsp://localhost:8554/mystream`)
- `LOCAL_FILE` : 파일 폴백 경로 (기본 `docs/video.mp4`)
- `SOURCE_MODE` : `auto|rtsp|file` (기본 `auto`)
- `LOOP_FILE` : 로컬 파일 루프 (기본 `true`)
- `ICE_SERVERS` : WebRTC ICE 서버(JSON)
- `RTSP_OPTIONS` : ffmpeg RTSP 옵션(JSON)
- `LOG_LEVEL` : 로그 레벨 (기본 `INFO`)
- `STATS_INTERVAL` : 전송 통계 로그 주기(초, 기본 0)

### front-end

- `VITE_ICE_SERVERS` : ICE 서버(JSON)
- `VITE_DEBUG_WEBRTC` : `true`면 WebRTC 디버그 로그 출력
- `VITE_HLS_BASE_URL` : HLS 기본 URL
- `VITE_HLS_URL` : 전체 HLS URL

### back-end

- `hls.path` : HLS 파일 경로 (`apps/back-end/src/main/resources/application.properties`)

---

## 트러블슈팅

- **검은 화면**  
  - `gateway.py` 로그에서 `Added video track from source` 확인  
  - `STATS_INTERVAL=2`로 설정 후 `video_bytes` 증가 확인

- **WebSocket 연결 실패**  
  - `apps/back-end/run.sh`로 서버 실행 상태 확인  
  - `ws://localhost:8080/signal` 접근 가능 확인

- **외부망 연결 실패**  
  - TURN 서버 필요 가능성 높음  
  - `ICE_SERVERS`에 TURN 추가

---

## 폴더 구조

```
apps/
  back-end/     # Spring Boot (시그널링 + HLS 정적 서빙)
  esp32cam/     # Python 게이트웨이 (RTSP/파일 → WebRTC)
  front-end/    # React 플레이어
scripts/
  rtsp_to_hls.sh
docs/
  video.mp4
```
