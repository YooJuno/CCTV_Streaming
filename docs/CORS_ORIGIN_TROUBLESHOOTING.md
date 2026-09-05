# CORS Origin 차단 트러블슈팅

## 1) 대표 증상

- 브라우저 콘솔:
  - `POST http://<host>:5174/api/auth/login 403 (Forbidden)`
- 응답 본문:
  - `Invalid CORS request`
- 로그인 실패 메시지는 뜨지만 계정(`admin/admin123`) 자체는 정상인 경우가 많음

## 2) 원인

백엔드는 기본적으로 아래 Origin만 허용합니다.

- `http://localhost:5174`
- `http://127.0.0.1:5174`
- `https://localhost:5174`
- `https://127.0.0.1:5174`

따라서 프론트를 `http://122.45.250.216:5174` 같은 외부 IP/도메인으로 접속하면
`Origin`이 달라져 CORS에서 403으로 차단됩니다.

중요 포인트:

- Origin은 `scheme + host + port`가 모두 일치해야 함
- `localhost`와 `127.0.0.1`은 서로 다른 Origin
- `http`와 `https`도 서로 다른 Origin

## 2-1) 개발 서버는 이제 프록시에서 처리됩니다

`apps/frontend/vite.config.ts`의 프록시가 백엔드로 전달할 때 `Origin`을 백엔드 자신의
주소로 바꿉니다. 따라서 `http://<외부IP>:5174`로 접속해도 Spring 입장에서는 CORS 요청이
아니게 되어, 아래 3)의 Origin 등록 없이도 로그인/재생이 동작합니다.

브라우저 보호는 그대로 유지됩니다. 브라우저는 여전히 `:5174`를 동일 출처로 보고,
다른 사이트가 이 API를 읽으려 하면 응답에 CORS 헤더가 없어 차단됩니다.

3)의 절차가 여전히 필요한 경우:

- Vite 프록시를 우회하고 브라우저가 백엔드(`:8081`)로 직접 요청할 때
  (`VITE_API_BASE_URL` / `VITE_HLS_BASE_URL` 설정 시)
- 프로덕션에서 정적 빌드를 별도 서버로 서빙할 때

## 3) 빠른 해결 (dev-up 실행 시)

아래처럼 `API_ALLOWED_ORIGINS`, `HLS_ALLOWED_ORIGINS`에 실제 접속 Origin을 추가해서 실행합니다.

```bash
./scripts/dev-down.sh

API_ALLOWED_ORIGINS='http://localhost:5174,http://127.0.0.1:5174,http://122.45.250.216:5174' \
HLS_ALLOWED_ORIGINS='http://localhost:5174,http://127.0.0.1:5174,http://122.45.250.216:5174' \
./scripts/dev-up.sh --with-dummy
```

## 4) 운영 환경 반영

운영 실행 스크립트/서비스 환경변수에 아래 항목을 넣어야 합니다.

```env
API_ALLOWED_ORIGINS=http://localhost:5174,http://127.0.0.1:5174,http://122.45.250.216:5174
HLS_ALLOWED_ORIGINS=http://localhost:5174,http://127.0.0.1:5174,http://122.45.250.216:5174
```

HTTPS 도메인으로 접속한다면 그 Origin도 반드시 추가:

```env
API_ALLOWED_ORIGINS=...,https://cctv.example.com
HLS_ALLOWED_ORIGINS=...,https://cctv.example.com
```

## 5) 검증 방법

아래 요청이 `403 Invalid CORS request`면 차단 상태입니다.

```bash
curl -i -X POST http://127.0.0.1:8081/api/auth/login \
  -H 'Origin: http://122.45.250.216:5174' \
  -H 'Content-Type: application/json' \
  --data '{"username":"admin","password":"admin123"}'
```

정상 상태라면 응답에 아래 헤더가 포함됩니다.

- `Access-Control-Allow-Origin: http://122.45.250.216:5174`
- `Access-Control-Allow-Credentials: true`

## 6) 자주 놓치는 항목

- 브라우저 주소창 Origin과 env에 넣은 Origin 문자열이 정확히 같은지 확인
- 프론트만 재시작하지 말고 백엔드도 재시작해야 CORS 설정이 반영됨
- 로그인 API만 열고 `/hls/**`를 빼먹지 않도록 `HLS_ALLOWED_ORIGINS`도 같이 설정
- 변경 후 브라우저 강력 새로고침(캐시 무효화) 권장
