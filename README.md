# CCTV_Streaming

ESP32-CAM이 서버로 영상을 보내고, 인증된 웹 관제 화면이 도착한 최신 프레임을 바로 재생하는 프로젝트입니다. 기본 방식은 카메라에서 시작하는 HTTP(S) push이므로 서버가 카메라의 사설 IP에 직접 접근할 필요가 없습니다. 기존 HLS 재생도 지원합니다.

```text
ESP32-CAM → HTTP(S) chunked JPEG upload → Spring Boot → 최신 JPEG 프레임 → React
                                              └→ FFmpeg → HLS (호환 재생)
```

웹 화면에서 USB 펌웨어 설치, Wi-Fi와 서버 연결, 카메라 검색·상태 확인, 영상 재생, 송출 FPS·해상도·화질 설정을 할 수 있습니다. 같은 LAN에서 카메라의 MJPEG 주소를 읽는 기존 pull converter도 선택적으로 사용할 수 있습니다.

## 실행 환경

- Java 17, Spring Boot 4.1.1, Gradle wrapper 8.14.4
- Node.js 22.12 이상인 22.x 또는 24 이상, npm
- `ffmpeg` 실행 파일: 서버의 JPEG → HLS 변환에 필요
- PlatformIO 6.2.0: 공통 ESP32-CAM 펌웨어 빌드에 필요
- USB 설치: 컴퓨터의 Chrome/Edge, HTTPS 또는 `localhost`, AI Thinker ESP32-CAM 및 USB-UART 연결

## 빠른 시작: 서버와 웹 화면

모든 명령은 프로젝트 루트에서 실행합니다.

```bash
npm --prefix apps/frontend ci
ffmpeg -version

# 최초 설치 또는 펌웨어 변경 시
./scripts/build_firmware.sh

# push 방식에서는 별도 converter 옵션이 필요하지 않습니다.
./scripts/dev-up.sh --frontend-host 127.0.0.1
```

`http://localhost:5174`에서 로그인합니다. `AUTH_USERS`를 지정하지 않은 개발 실행은 `admin/admin123`, `viewer/viewer123` 계정과 머신별 JWT 시크릿을 사용합니다. 개발 계정은 로컬 확인용이며, 외부에 공개할 서버에는 별도 계정을 설정하세요.

- 웹 관제: `http://localhost:5174`
- 백엔드 상태: `http://localhost:8081/health`
- 인증된 영상 경로: `/hls/mystream.m3u8`
- 로그: `.run/logs`, 관리하는 프로세스 PID: `.run/pids`

```bash
./scripts/dev-status.sh
./scripts/dev-down.sh
```

카메라를 연결하기 전에는 카메라 카드가 오프라인으로 표시되며 영상 파일이 없을 수 있습니다.

## USB로 카메라 설치

1. 로그인 후 **장비 설치**를 열고 USB 장치를 선택합니다.
2. AI Thinker ESP32-CAM 보드를 확인하고 **펌웨어 설치 / 업데이트**를 실행합니다. USB-UART 보드는 GPIO0과 GND를 연결하고 리셋해야 부트 모드로 진입할 수 있습니다. 설치 후 점퍼를 해제하고 다시 리셋합니다.
3. 2.4GHz Wi-Fi 이름·비밀번호, 카메라가 접속할 서버 주소·포트, 계정에 등록된 카메라 ID를 입력합니다.
4. **설정 저장하고 서버에 연결**을 누릅니다. 화면은 Wi-Fi 연결과 장치의 송출 상태를 확인하며, 관제 화면에서 **영상 시작**을 눌러 재생합니다.

서버는 로컬 실행 시 LAN 주소를 제안합니다. 다른 네트워크에 설치할 카메라에는 같은 백엔드로 연결되는 공개 HTTPS 주소를 입력하세요. `localhost`는 카메라 자신을 가리키므로 사용할 수 없습니다. 공개 주소를 고정하려면 백엔드에 `DEVICE_INGEST_PUBLIC_BASE_URL=https://camera.example.com`을 설정합니다.

공통 펌웨어에는 개인 Wi-Fi 자격증명이 포함되지 않습니다. 브라우저가 Wi-Fi 설정과 장치 연결 키를 USB의 줄 단위 JSON 프로토콜로 전달하고, 장치는 이를 NVS에 저장합니다. HTTPS는 서버 인증서를 검증하며 기본 인증서 목록과 선택적인 사설 서버 CA를 지원합니다. Wi-Fi 비밀번호를 웹 서버나 브라우저 저장소에 보관하지 않습니다.

빌드 결과는 `apps/frontend/public/firmware`에 배치됩니다. 설치 manifest의 bootloader·partition table·boot app·application 네 부분을 각각 기록하여 NVS 영역을 보존합니다. 이미 설치한 장치에는 **연결 상태 확인** 기능으로 저장된 설정과 송출 상태를 확인할 수 있습니다.

장치 키는 카메라 ID별로 발급하며 서버에는 SHA-256 digest만 저장합니다. 발급 시 기존 active 키는 유지되고 새 키는 pending 상태가 됩니다. 새 장치가 `/config` 또는 `/video`에서 처음 인증하면 새 키가 활성화되고 기존 장치의 연결이 교체됩니다. pending 키는 ID당 하나이며 다시 발급하면 이전 pending 키만 대체됩니다. 기본 만료는 없고, `DEVICE_PENDING_TOKEN_TTL_SECONDS`를 양수로 설정하면 미사용 키의 수명을 제한할 수 있습니다.

## 웹에서 송출 설정 변경

카메라 카드의 기본 **실시간** 재생은 `/api/live/{id}/stream.mjpeg`의 multipart JPEG를 사용합니다. 서버는 카메라별 최신 프레임 하나만 보관하고, 느린 시청자는 밀린 프레임을 건너뛰어 최신 화면을 받습니다. JPEG 한 프레임은 기존 2MiB 제한과 2MP 픽셀 제한을 적용합니다. 시청자의 로그인·카메라 권한을 확인하고, 세션 만료나 영상 수신 중단 시 연결을 종료합니다. 기본 동시 시청 한도는 `DEVICE_MAX_LIVE_VIEWERS=24`이며 카메라 영상과 쿠키는 URL에 포함하지 않습니다.

**호환 재생**은 기존 HLS입니다. LAN pull converter와 테스트 영상은 이 방식을 선택하세요. 실시간 재생의 진단은 서버가 실제 수신한 FPS·JPEG 전송량·최근 프레임 수신 시점을 표시하며, 촬영부터 화면까지의 전체 지연을 계산한 값은 아닙니다. MJPEG는 JPEG를 다시 인코딩하지 않지만 시청자마다 영상 데이터를 전달하므로 많은 시청자에게 배포하는 경우 별도 미디어 서버 설계를 권장합니다.

카메라 카드의 **송출 설정**에서 목표 FPS, 해상도, JPEG 화질, 네트워크 자동 조절을 변경할 수 있습니다.

| 설정 | 지원 범위 |
| --- | --- |
| 목표 FPS | 1~12 FPS. 기본 선택은 4·6·8·10·12이며 기존 설정값도 표시 |
| 해상도 | QVGA 320×240, CIF 400×296, VGA 640×480, SVGA 800×600 |
| JPEG 화질 | 10~40. 숫자가 작을수록 화질과 데이터 사용량이 높음 |
| 자동 조절 | 연결 상태에 맞춰 송출 부담을 조절 |

온라인 장치는 약 10초 간격으로 서버 설정을 조회합니다. 설정 변경 시 영상이 잠시 재연결될 수 있습니다. 웹의 저장 성공은 서버에 설정이 저장되었다는 뜻이며, 오프라인 장치는 다시 연결한 뒤 적용합니다. 실제 FPS는 장비와 네트워크 상태에 따라 목표보다 낮을 수 있습니다.

## 계정과 서버 설정

백엔드를 단독 실행할 때는 `AUTH_JWT_SECRET`와 `AUTH_USERS`가 필요합니다. 아래는 로컬 개발용 예시입니다.

```bash
export AUTH_JWT_SECRET="$(openssl rand -base64 48)"
export AUTH_USERS='admin:{plain}admin123:*;viewer:{plain}viewer123:mystream'
export STREAMS_CATALOG='mystream:정문 카메라'
export API_ALLOWED_ORIGINS='http://localhost:5174,http://127.0.0.1:5174'
export HLS_ALLOWED_ORIGINS="$API_ALLOWED_ORIGINS"

cd apps/backend
./gradlew bootRun
```

새 터미널의 프로젝트 루트에서 `npm --prefix apps/frontend run dev`를 실행합니다. 생산 환경의 계정은 `username:{bcrypt}<hash>:stream1,stream2` 형식을 사용합니다. `*`는 모든 등록된 카메라에 대한 접근 권한입니다.

- JWT 시크릿은 32바이트 이상이어야 하며, 미설정·짧은 시크릿과 빈 사용자 설정은 백엔드 기동 시 거부됩니다.
- API/HLS CORS는 정확한 Origin만 허용합니다. `*` 또는 `*.example.com`을 사용하지 않습니다.
- Vite 개발 프록시는 `/api`, `/hls`를 백엔드로 전달하며 proxy hop의 Origin을 백엔드 주소로 맞춥니다. 생산 빌드에는 이 개발 프록시가 포함되지 않습니다.
- 외부 HTTPS 배포 시 `AUTH_JWT_COOKIE_SECURE=true`와 실제 도메인의 Origin을 설정합니다.
- 로그인 실패가 반복되면 `429`와 `Retry-After`를 반환합니다. 제한은 `AUTH_LOGIN_MAX_ATTEMPTS`, `AUTH_LOGIN_LOCKOUT_SECONDS`, `AUTH_LOGIN_MAX_ATTEMPTS_PER_IP`로 설정합니다.
- 장치 레지스트리 기본 경로는 `apps/backend/device-registry.properties`이며 연결 키 digest와 송출 설정을 보존합니다. 재시작 후에도 사용할 수 있도록 `DEVICE_REGISTRY_PATH`와 HLS 저장소를 지속되는 경로로 구성하세요.

## 원격 서버와 reverse proxy

카메라는 공개 서버로 나가는 연결을 사용합니다. 공개 서버에는 HTTPS, `/api/*`와 `/hls/*`의 백엔드 연결, `/firmware/*`를 포함한 프론트 정적 파일 제공이 필요합니다. 장치의 `X-Device-Token` 헤더를 보존하고 긴 JPEG 업로드를 요청 전체가 끝날 때까지 버퍼에 모으지 않아야 합니다.

Nginx를 쓰는 경우 영상 수신 경로의 예시는 다음과 같습니다. HTTPS 인증서와 나머지 웹/API/HLS location 설정은 배포 환경에 맞춰 구성합니다.

```nginx
location ~ ^/api/devices/[^/]+/video$ {
    proxy_pass http://127.0.0.1:8081;
    proxy_http_version 1.1;
    proxy_request_buffering off;
    proxy_buffering off;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
    client_body_timeout 300s;
    client_max_body_size 0;
}

location ~ ^/api/live/[^/]+/stream\.mjpeg$ {
    proxy_pass http://127.0.0.1:8081;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_read_timeout 300s;
}
```

HTTP/1.1과 요청 buffering 해제를 함께 설정해야 chunked 업로드를 즉시 전달할 수 있습니다. 업로드는 여러 프레임을 포함하므로 요청 전체의 크기 제한과 JPEG 한 프레임 제한을 구분합니다. 위 timeout은 배포 예시이며, 백엔드의 기본 `SERVER_TOMCAT_CONNECTION_TIMEOUT`은 `30s`입니다. 동시 수신 기본 한도는 8개, JPEG 한 프레임 기본 한도는 2MiB입니다. 관련 설정과 자세한 설명은 [백엔드 문서](apps/backend/README.md), [Nginx proxy 문서](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_request_buffering), [요청 크기 제한 문서](https://nginx.org/en/docs/http/ngx_http_core_module.html#client_max_body_size)를 참고하세요.

## 선택 사항: 기존 LAN pull과 테스트 영상

서버에서 카메라 IP에 접근할 수 있고 기존 MJPEG 펌웨어를 사용하는 경우:

```bash
./scripts/dev-up.sh --with-converter --mjpeg-url http://192.168.1.50:81/stream --frontend-host 127.0.0.1
```

converter만 단독 실행할 수도 있습니다.

```bash
MJPEG_URL=http://192.168.1.50:81/stream STREAM_ID=mystream ./scripts/mjpeg_to_hls.sh
```

같은 카메라 ID의 push와 pull converter를 동시에 실행하면 같은 영상 파일을 덮어쓸 수 있으므로 한 방식만 사용하세요.

장비 없이 pull 파이프라인과 관제 화면을 확인하려면:

```bash
# docs/media/video.mp4가 있으면 사용하고, 없으면 테스트 패턴 사용
./scripts/dev-up.sh --with-dummy --frontend-host 127.0.0.1

# 항상 FFmpeg 테스트 패턴 사용
SOURCE_MODE=testsrc ./scripts/dev-up.sh --with-dummy --frontend-host 127.0.0.1
```

## 진단과 품질 확인

**시스템 상태**는 영상 저장소 권한, 카메라 상태, 다음 조치를 표시합니다. **실시간**의 재생 진단은 카메라 수신 FPS와 전송량을, **호환 재생**은 플레이리스트 기준 지연·버퍼·누락 프레임·재시도를 표시합니다. HLS에는 수초의 지연이 있으며 촬영부터 표시까지의 전체 지연과 지표가 일치하지 않을 수 있습니다.

- 영상 목록 `404`: 카메라의 서버 송출, FFmpeg 실행 파일, 저장소 쓰기 권한을 확인합니다.
- 장치 수신 `401`: 카메라 ID·키와 서버 주소를 확인합니다. 재발급한 pending 키를 다른 장치에 먼저 사용했는지도 확인합니다.
- 웹 `401`: 로그인과 쿠키 상태를 확인합니다. 웹 `403`: 계정의 카메라 권한과 CORS Origin을 확인합니다.
- USB 응답 없음: 공통 펌웨어 설치, GPIO0 점퍼 해제, 리셋, 다른 시리얼 프로그램 종료를 확인합니다.

```bash
npm --prefix apps/frontend run typecheck
npm --prefix apps/frontend run test:run
npm --prefix apps/frontend run build
npm --prefix apps/frontend exec -- playwright install chromium
npm --prefix apps/frontend run e2e

# 별도 터미널에서
cd apps/backend
./gradlew test
```

CI는 백엔드 테스트, 프론트 typecheck·단위 테스트·build·E2E, 스크립트 검증, 공개 펌웨어 빌드를 수행합니다. 현재는 최신 JPEG 실시간 재생과 단일 HLS 호환 재생을 지원하며 RTSP 입력, WebRTC, 시청자별 ABR 다중 화질 스트림은 구현되어 있지 않습니다.

## 문서

브랜치는 `main`(사용자가 관리하는 배포 기준), `dev`(기본 통합), `feat/*`(기능), `fix/*`(수정)으로 운영합니다. 작업 브랜치는 `dev`에서 시작하고 검증 후 `dev`에 병합합니다. `main` 반영은 사용자가 별도로 진행합니다. 자세한 작업 규칙은 [AGENTS.md](AGENTS.md)를 참고하세요.

- [시스템 아키텍처](docs/system-archtecture/SYSTEM_ARCHITECTURE.md)
- [API 계약](docs/api/API_CONTRACT.md)
- [프론트 실행과 구성](apps/frontend/README.md)
- [백엔드 운영 설정](apps/backend/README.md)
- [장치 펌웨어](apps/cctv/device/README.md)
