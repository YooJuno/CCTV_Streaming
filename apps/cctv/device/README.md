# ESP32-CAM firmware (PlatformIO)

`apps/cctv/device`는 ESP32-CAM이 MJPEG HTTP 스트림을 출력하는 펌웨어입니다.

## Ubuntu 서버 기준 빠른 시작

프로젝트 루트: `/home/juno/Workspace/CCTV_Streaming`

### 1) 의존성 설치

#### 권장(관리자 권한 가능 시)

```bash
sudo apt update
sudo apt install -y python3 python3-pip python3-venv curl git
```

#### 현재 서버처럼 sudo 비밀번호 없이 진행해야 하는 경우

```bash
curl -fsSL https://bootstrap.pypa.io/get-pip.py -o /tmp/get-pip.py
python3 /tmp/get-pip.py --user --break-system-packages
```

### 2) PlatformIO 설치

```bash
~/.local/bin/pip install --user --break-system-packages platformio
```

PATH 등록(권장):

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

확인:

```bash
pio --version
```

### 3) Wi-Fi 설정

`apps/cctv/device/platformio.ini`에서 설정:

```ini
build_flags =
  -DWIFI_SSID=\"YOUR_WIFI_SSID\"
  -DWIFI_PASSWORD=\"YOUR_WIFI_PASSWORD\"
```

### 4) 빌드

```bash
cd /home/juno/Workspace/CCTV_Streaming/apps/cctv/device
pio run -e esp32cam
```

## 업로드 가이드

### 1) 포트 확인

```bash
ls /dev | rg '^(ttyUSB|ttyACM)'
```

예: `/dev/ttyUSB0`

### 2) 권한 설정(중요)

`/dev/ttyUSB*`가 `root:dialout`인 경우, 현재 사용자에 `dialout` 그룹 권한이 필요합니다.

```bash
sudo usermod -aG dialout $USER
```

권한 반영:

```bash
newgrp dialout
```

또는 로그아웃/로그인 후 다시 접속.

### 3) 플래시 모드 진입

ESP32-CAM 보드에서 다음 순서로 부트 모드 진입:

1. IO0를 GND에 연결
2. RST 버튼(또는 전원 리셋) 1회
3. 업로드 시작 후 필요 시 IO0 해제

### 4) 업로드

```bash
cd /home/juno/Workspace/CCTV_Streaming/apps/cctv/device
pio run -e esp32cam -t upload --upload-port /dev/ttyUSB0
```

### 5) 시리얼 모니터

```bash
cd /home/juno/Workspace/CCTV_Streaming/apps/cctv/device
pio device monitor -b 115200 --port /dev/ttyUSB0
```

## 출력 URL

- 상태 페이지: `http://<device-ip>/`
- 헬스체크: `http://<device-ip>/health`
- MJPEG 스트림: `http://<device-ip>:81/stream`

## 프로젝트 연동

프로젝트 루트에서 MJPEG -> HLS:

```bash
cd /home/juno/Workspace/CCTV_Streaming
MJPEG_URL=http://<device-ip>:81/stream STREAM_ID=mystream ./scripts/mjpeg_to_hls.sh
```

## 트러블슈팅

- `Permission denied: '/dev/ttyUSB0'`
  - `dialout` 그룹 권한 누락입니다. 위 권한 설정 섹션 수행 후 재시도.
- `Could not connect` 또는 타임아웃
  - 플래시 모드(IO0/GND + reset)로 진입했는지 확인.
- `MJPEG_URL is not configured`
  - `scripts/mjpeg_to_hls.sh` 실행 시 `MJPEG_URL=http://<device-ip>:81/stream`를 명시.

## 안정화 동작

- Wi-Fi 연결이 끊기면 자동 재연결 시도
- 카메라 캡처 실패 누적 시 자동 재초기화
