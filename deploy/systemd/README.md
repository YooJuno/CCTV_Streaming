# systemd User Services

이 디렉터리는 CCTV_Streaming용 `systemd --user` 서비스 템플릿을 제공합니다.

## 포함 서비스

- `cctv-backend.service`: Spring Boot API/HLS 서버
- `cctv-frontend.service`: Vite 프론트
- `cctv-converter.service`: MJPEG -> HLS 변환기(실장비 소스)
- `cctv-dummy-stream.service`: 더미 비디오 기반 테스트 스트림

`cctv-converter.service`와 `cctv-dummy-stream.service`는 동시 사용 대신
하나만 활성화하는 것을 권장합니다.

## 설치

프로젝트 루트에서:

```bash
./scripts/install_systemd_user_services.sh
```

옵션:

```bash
./scripts/install_systemd_user_services.sh --enable --start
```

## 환경변수 파일

설치 스크립트는 아래 경로에 샘플을 생성합니다.

- `~/.config/cctv-streaming/backend.env`
- `~/.config/cctv-streaming/frontend.env`
- `~/.config/cctv-streaming/converter.env`
- `~/.config/cctv-streaming/dummy.env`

실제 운영값으로 수정 후 서비스 재시작:

```bash
systemctl --user restart cctv-backend.service
systemctl --user restart cctv-frontend.service
```

## 상태/로그

```bash
systemctl --user status cctv-backend.service
journalctl --user -u cctv-backend.service -f
```
