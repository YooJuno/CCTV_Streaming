# CCTV Streaming Private Project

## 목표
- **[Front]** 리액트 마스터  
- **[Back]** 스프링 마스터  
- **[Embedded]** WebRTC & RTSP 마스터  
- **[DB]** 최신 SQL 기술(MySQL / PostgreSQL) 마스터  

## 기능 명세

### [ESP32]
- **ESP32-CAM**으로 실시간 영상 촬영  
- **FFmpeg / GStreamer**를 이용한 **RTSP 변환 (C++)**  
- 네트워크 설정 및 **고정 IP 구성**  
- **자동 재연결 및 상태 모니터링** 기능 구현  

### [Back-End]
- **Spring Boot** 기반 스트리밍 관리 서버  
- **RTSP → WebRTC 변환 게이트웨이** 연동  
  - FFmpeg 또는 Janus/mediasoup를 이용한 실시간 변환  
- **JWT 기반 인증 및 권한 관리 시스템**  
- **스트림 제어 API**
  - 시작 / 중지 / 상태 확인 / 스냅샷 요청  
- **영상 녹화 및 로그 관리** 기능  
- **카메라 메타데이터 관리**
  - 이름, URL, 상태, 등록일, 위치 정보  

### [Front-End]
- **React 기반 CCTV 대시보드**
  - 전체 카메라 실시간 모니터링  
  - 개별 영상 재생(저지연 WebRTC 지원)  
  - 상태 표시 및 연결 알림  
- **WebRTC / HLS.js** 기반 플레이어 통합  
- **녹화 영상 및 스냅샷 조회 페이지**
  - 기간별 / 카메라별 검색  
- **관리자 기능**
  - 카메라 등록·삭제, 사용자 권한 관리  

### [Database]
- **MySQL** 또는 **PostgreSQL** 사용  
- 주요 테이블  
  - `users` : 사용자 정보 및 권한  
  - `cameras` : RTSP / WebRTC 스트림 정보  
  - `streams` : 실시간 세션 기록  
  - `recordings` : 저장된 영상 메타데이터  
  - `logs` : 이벤트 및 오류 로그  
- 트랜잭션 관리 및 외래키 제약으로 데이터 무결성 확보

## 빠른 시작 (PoC)

이 저장소에는 RTSP를 받아 WebRTC로 전달하는 간단한 PoC가 포함되어 있습니다.

필수 도구:

- JDK 17+
- Gradle
- Python 3.9+
- ffmpeg (`brew install ffmpeg`)
- rtsp-simple-server (`https://github.com/aler9/rtsp-simple-server`) — 바이너리를 내려받아 실행하세요

1. RTSP 서버 실행 (rtsp-simple-server)

1. `video.mp4`를 RTSP로 푸시 (ESP32 모사)

```bash
cd apps/esp32cam
./rtsp_publish.sh
```

1. Gateway (aiortc) 실행

```bash
cd apps/esp32cam
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python gateway.py
```

1. Spring 백엔드 실행

```bash
cd apps/back-end
./gradlew bootRun
```

1. 프론트엔드 실행

```bash
cd apps/front-end
npm install
npm run dev
```

브라우저에서 프론트엔드로 접속하여 "시작" 버튼을 눌러 스트림을 확인하세요.

간단한 상태 확인

- 백엔드가 실행 중이면 `http://localhost:8080/health` 로 상태를 확인하세요.
- 등록된 스트림 목록은 `http://localhost:8080/streams` 에서 확인 가능합니다.
