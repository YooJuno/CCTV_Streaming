# ESP32-CAM 공통 펌웨어

AI Thinker ESP32-CAM용 펌웨어입니다. 웹 설치 화면이 공통 바이너리를 USB로 설치하고 Wi-Fi, 서버 주소, 스트림 ID, 장비 토큰을 USB JSON 명령으로 설정합니다. 설정은 NVS에 저장되며 Wi-Fi 비밀번호와 장비 토큰은 응답이나 로그에 출력하지 않습니다.

장비는 외부 서버에 지속 HTTP(S) 연결을 열어 JPEG 프레임을 전송합니다. 서버는 이를 FFmpeg로 HLS로 변환합니다. 장비와 서버가 서로 다른 네트워크에 있어도 장비에서 서버 주소/포트에 접속할 수 있으면 동작합니다. RTSP 서버나 카메라 쪽 포트포워딩은 사용하지 않습니다.

## 공통 바이너리 빌드

프로젝트 루트에서:

```bash
python3 -m pip install platformio==6.2.0
./scripts/build_firmware.sh
```

빌드 환경은 `espressif32@6.12.0` / Arduino 2.0.17로 고정했습니다. `esp32cam_factory` 환경은 로컬 `wifi_secrets.h`가 있어도 포함하지 않습니다.

결과는 `apps/frontend/public/firmware/`에 생성됩니다. 웹 설치용 `manifest.json`은 SHA-256이 포함된 네 파트(`bootloader.bin`, `partitions.bin`, `boot_app0.bin`, `firmware.bin`)를 지정합니다. 파트별 쓰기는 NVS 영역을 보존하며, 전체 지우기를 선택하면 저장한 설정도 지워집니다. 선택 다운로드인 `cctv-esp32cam.bin`은 offset 0의 합친 이미지로, 이를 직접 기록하면 NVS도 초기화됩니다. 생성물은 git에서 제외됩니다.

## USB 설치와 실행 모드

브라우저 설치 화면을 사용하려면 Web Serial을 지원하는 브라우저와 HTTPS 또는 localhost가 필요합니다. USB가 없는 ESP32-CAM 모델은 USB-UART 어댑터가 필요하며, 다른 시리얼 모니터가 같은 포트를 사용하면 먼저 종료해야 합니다.

자동 부트 회로가 없는 보드:

1. IO0를 GND에 연결한 뒤 RST 버튼을 눌러 업로드 모드로 진입합니다.
2. 웹 설치 화면에서 포트를 선택하고 펌웨어를 설치합니다.
3. 설치가 끝나면 IO0-GND 연결을 해제하고 다시 RST 버튼을 누릅니다.
4. USB 설정 단계에서 SSID, Wi-Fi 비밀번호, 장비가 접속할 서버 주소/포트와 장비 토큰을 저장합니다.

설정이 없는 경우 재부팅 루프 대신 USB 설정 명령을 기다립니다. Wi-Fi 연결은 비동기로 진행하며, 연결 실패 중에도 설정과 상태 요청을 받을 수 있습니다.

## USB JSON 프로토콜

115200 baud, UTF-8 JSON 한 줄과 개행으로 요청합니다. 부팅 로그와 JSON이 함께 나오므로 클라이언트는 JSON 응답만 파싱해야 합니다. 요청 한도는 8192바이트입니다.

```json
{"type":"cctv.configure","requestId":"setup-1","ssid":"YOUR_WIFI_SSID","password":"YOUR_WIFI_PASSWORD","serverUrl":"https://camera.example.com:443","streamId":"entrance","deviceToken":"<dashboard에서 발급한 64자리 hex 토큰>","serverCaPem":""}
```

- `ssid`: 1~32바이트. 비밀번호는 빈 문자열(개방형 네트워크) 또는 8~63바이트입니다.
- `serverUrl`: http/https 기본 주소, 최대 512바이트. 선택 포트와 프록시 기본 경로를 포함할 수 있으며, 쿼리/fragment/주소 내 계정정보는 허용하지 않습니다.
- `streamId`: 1~64자의 영문·숫자·점·밑줄·하이픈이며 첫 글자는 영문 또는 숫자입니다.
- `deviceToken`: 서버에서 발급한 64자리 hex 토큰입니다. Wi-Fi 비밀번호와 함께 NVS에 저장됩니다.
- `serverCaPem`: 선택값. 사설 CA를 사용할 때 PEM 인증서를 전달하며 최대 4096바이트입니다.

저장 직후 빠르게 ACK하고 Wi-Fi 연결 결과는 상태 요청으로 확인합니다.

```json
{"type":"cctv.status","requestId":"status-1"}
```

응답은 `type: "cctv.response"`, 동일한 `requestId`, `ok`, `message`, `firmwareVersion`, `configured`, `wifiConnected`, `publishing`, `publishMessage`를 포함합니다. 연결된 경우 `ip`와 LAN `streamUrl`을 반환합니다. `serverUrl`/`streamId`, 실제 적용된 `fps`/`frameSize`/`jpegQuality`/`adaptive`/`appliedRevision`도 반환합니다. `publishing`은 JPEG 데이터를 서버 연결에 쓰는 상태이며 HLS 재생 성공은 서버 스트림 상태와 영상으로 확인합니다.

## 외부 서버 송출과 원격 화질 설정

영상 전송은 다음 규약입니다.

```text
POST <serverUrl>/api/devices/<streamId>/video
X-Device-Token: <deviceToken>
Content-Type: application/octet-stream
Transfer-Encoding: chunked
```

HTTP 헤더 이후 JPEG 원본 바이트를 즉시 보냅니다. 서버의 최종 200 응답은 업로드 종료 후 발생합니다. 응답을 기다린 뒤 영상 전송을 시작하지 않습니다. 연결이 끊기면 지연을 늘려 최대 15초 간격으로 재접속합니다.

장비는 10초마다 같은 토큰으로 `GET <serverUrl>/api/devices/<streamId>/config`를 호출합니다. 서버의 FPS(1~12), 해상도(QVGA/CIF/VGA/SVGA), JPEG 품질(10~40), adaptive 설정을 적용하고 revision이 바뀌면 업로드 연결을 다시 열어 서버 FFmpeg가 새 크기를 인식하게 합니다. JPEG 품질 숫자가 낮을수록 화질이 높습니다. adaptive 모드에서는 Wi-Fi 신호가 약할 때 선택한 설정을 상한으로 FPS/해상도를 낮추고 압축률을 높입니다. PSRAM이 없으면 QVGA, 최대 6fps로 제한하며 실제 적용값을 상태 응답에 표시합니다. 실제 전달 FPS는 무선 상태와 처리 시간에 따라 더 낮을 수 있습니다.

HTTPS는 SDK의 공공 CA bundle 또는 제공한 사설 CA로 인증서를 검증합니다. 인증서 검증을 끄지 않습니다. 처음 HTTPS 연결을 맺기 전 NTP(`pool.ntp.org`, `time.cloudflare.com`)로 시간을 동기화하므로 해당 네트워크 접근이 가능해야 합니다. HTTP는 로컬 테스트에 사용할 수 있습니다.

LAN 상태 페이지와 헬스체크는 `http://<device-ip>/`, `http://<device-ip>/health`입니다. LAN MJPEG 주소는 `http://<device-ip>:81/stream`이며 외부 송출 중에는 카메라 우선권 때문에 503을 반환합니다.

## 로컬 개발 및 수동 업로드

웹 설치용 공통 이미지는 위 factory 환경을 사용합니다. 로컬 개발 환경은 NVS 설정이 없을 때만 `wifi_secrets.h`를 fallback으로 사용할 수 있습니다.

```bash
cp apps/cctv/device/wifi_secrets.example.h apps/cctv/device/wifi_secrets.h
# wifi_secrets.h의 SSID/password를 편집한 뒤:
pio run --project-dir apps/cctv/device -e esp32cam
pio run --project-dir apps/cctv/device -e esp32cam -t upload --upload-port /dev/ttyUSB0
pio device monitor -b 115200 --port /dev/ttyUSB0
```

macOS 포트 예시는 `/dev/cu.usbserial-*`입니다. Linux에서 시리얼 접근이 거부되면 현재 사용자의 `dialout` 그룹 권한을 확인합니다. 실제 장비 업로드 및 무선 송출 동작은 해당 보드에서 확인해야 합니다.
