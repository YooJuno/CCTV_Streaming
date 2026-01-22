# ESP32Cam (모사) - Gateway (aiortc)

이 항목은 ESP32보드가 없을 때 로컬 `video.mp4` 또는 RTSP 소스로부터 WebRTC 게이트웨이를 실행하는 방법을 정리합니다.  
전체 실행 흐름은 저장소 루트 `README.md`를 참고하세요.

간단 요약 (macOS)

- 추천 Python: 3.11 (Python 3.12에서는 PyAV 빌드 문제가 발생할 수 있음)
- 필수: `ffmpeg`, `pkg-config`, Xcode Command Line Tools
- 작업: 가상환경 생성 → 의존성 설치 → `python gateway.py` 실행

설치 및 실행 (권장 순서)

1) 시스템 의존성 설치

```bash
# Xcode CLI (한 번만)
xcode-select --install

# Homebrew로 필수 패키지 설치
brew install python@3.11 ffmpeg pkg-config
```

1) 프로젝트 가상환경(venv) 생성 — Python 3.11 사용 권장

```bash
cd apps/esp32cam
python3.11 -m venv venv
source venv/bin/activate
```

1) pip / 빌드 도구 업그레이드

```bash
pip install --upgrade pip setuptools wheel cython
```

1) FFmpeg 관련 환경변수(필요 시)

```bash
# 필요하면 pkg-config 경로 및 컴파일 플래그 지정
export PKG_CONFIG_PATH="$(brew --prefix ffmpeg)/lib/pkgconfig:$PKG_CONFIG_PATH"
export CPPFLAGS="-I$(brew --prefix ffmpeg)/include $CPPFLAGS"
export LDFLAGS="-L$(brew --prefix ffmpeg)/lib $LDFLAGS"
```

1) Python 의존성 설치

```bash
pip install -r requirements.txt
# (문제가 있으면 먼저 av만 설치하여 디버깅)
pip install av
```

1) 게이트웨이 실행

```bash
# 가상환경이 활성화된 상태에서
python gateway.py
```

환경 변수(선택)

- `SIGNAL_URL` : 시그널링 서버(WebSocket) URL (기본 `ws://localhost:8080/signal`)
- `RTSP_URL` : RTSP 소스 URL (기본 `rtsp://localhost:8554/mystream`)
- `LOCAL_FILE` : RTSP 연결 실패 시 폴백할 로컬 파일 경로 (기본 `docs/video.mp4`)
- `SOURCE_MODE` : 소스 선택 (`auto`|`rtsp`|`file`, 기본 `auto`)
- `LOOP_FILE` : 로컬 파일 루프 재생 여부 (기본 `true`)
- `ICE_SERVERS` : WebRTC ICE 서버 목록(JSON 배열). 예: `[{"urls":["stun:stun.l.google.com:19302"]}]`
- `RTSP_OPTIONS` : ffmpeg RTSP 옵션(JSON). 예: `{"rtsp_transport":"tcp","fflags":"nobuffer","flags":"low_delay"}`
- `LOG_LEVEL` : 로그 레벨 (기본 `INFO`)
- `STATS_INTERVAL` : 전송 바이트 로그 주기(초). `0`이면 비활성(기본 `0`)

디버깅 / 자주 발생하는 문제

- PyAV(av) 빌드 오류
  - 주원인: Python 버전(3.12 등)과의 호환성 또는 FFmpeg 개발 헤더(pkg-config 경로)가 설정되지 않음
  - 해결: Python 3.11 사용, Xcode CLI 설치, `brew install ffmpeg pkg-config`, 위의 환경변수 설정 후 재시도
  - 자세한 빌드 로그: `pip install av -v` 또는 `pip install -r requirements.txt -v`

- aiortc/av 설치 전에 ffmpeg가 설치되어 있어야 합니다.

- 게이트웨이가 RTSP 서버에 연결 실패하면 `gateway.py`는 `docs/video.mp4`로 자동 폴백합니다.

자동화 스크립트(옵션)

- 필요하면 가상환경 생성·의존성 설치·게이트웨이 실행을 자동으로 수행하는 스크립트를 추가해 드리겠습니다. 원하시면 알려주세요.
