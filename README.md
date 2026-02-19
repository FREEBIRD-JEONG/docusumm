# DocuSumm

AI 기반 텍스트/YouTube 요약 워크스페이스입니다.  
요약 파이프라인은 비동기 구조로 동작합니다.

1. `POST /api/summary` -> `202 { id, status: "pending" }`
2. 내부 워커(`/api/internal/summary-worker`)가 Gemini 호출 후 DB 상태 업데이트
3. 프론트가 `GET /api/summaries/[id]` 폴링으로 완료/실패 상태를 수신

## 개발 환경

### 1) 설치

```bash
pnpm install
```

### 2) 환경 변수

`.env.local`에 아래 값을 설정합니다.

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_AUTH_ENABLED=false
DEV_GUEST_USER_ID=00000000-0000-0000-0000-000000000001

DATABASE_URL=

GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.0-flash
GEMINI_MODEL_CANDIDATES=gemini-2.5-flash,gemini-2.5-flash-lite,gemini-2.0-flash
GEMINI_API_VERSION=v1
GEMINI_TIMEOUT_MS=45000
GEMINI_MAX_RETRIES=2
GEMINI_RETRY_BASE_DELAY_MS=700
GEMINI_MAX_OUTPUT_TOKENS=1200
GEMINI_TEMPERATURE=0.2
GEMINI_TOP_P=0.9
GEMINI_LOG_LEVEL=info
YTDLP_DISABLED=0
YTDLP_SUB_LANGS=ko.*,ko,en.*,en
# YTDLP_COOKIES_FROM_BROWSER=chrome
YTDLP_AUTO_COOKIES_BROWSERS=chrome,brave,safari,firefox

INTERNAL_WORKER_SECRET=
CRON_SECRET=
AUTO_TRIGGER_WORKER_ON_SUMMARY_CREATE=true
```

### 3) 실행

```bash
pnpm dev
```

기본 접속: `http://localhost:3000`

개발 환경에서는 `AUTO_TRIGGER_WORKER_ON_SUMMARY_CREATE=true`일 때
요약 요청 직후 내부 워커를 자동 호출합니다.

YouTube 요약은 공개 영상의 자막을 가져와 처리합니다. 자막이 없는 영상은 실패 상태로 반환됩니다.
일부 환경에서 YouTube timedtext가 차단되면 `yt-dlp` fallback으로 자막을 수집합니다.
`YTDLP_COOKIES_FROM_BROWSER`를 지정하면 해당 브라우저 쿠키를 사용하고, 미지정 시 `YTDLP_AUTO_COOKIES_BROWSERS` 순서로 자동 재시도합니다.
Gemini 429/5xx가 반복되면 `GEMINI_MODEL_CANDIDATES` 순서대로 모델 후보를 자동 시도합니다.

### Gemini 429 대응 체크리스트

1. `GEMINI_API_KEY`가 올바른 프로젝트 키인지 확인
2. Gemini 쿼터/요금제/결제 상태 확인
3. 필요 시 API 키 교체(회전) 후 재시도
4. `GEMINI_MODEL_CANDIDATES`에 2개 이상 모델 지정
5. `GEMINI_MAX_RETRIES`, `GEMINI_RETRY_BASE_DELAY_MS`를 트래픽에 맞게 조정
6. `404 model not found`가 발생하면 후보 목록에서 중단된 모델(예: `gemini-1.5-flash`)을 제거

## 워커 수동 실행 (로컬)

요약 요청 후 즉시 완료되지 않으면 워커를 수동으로 호출할 수 있습니다.

### x-worker-secret 헤더 방식

```bash
curl -X POST "http://localhost:3000/api/internal/summary-worker" \
  -H "x-worker-secret: <INTERNAL_WORKER_SECRET>"
```

### cron bearer 방식

```bash
curl -X POST "http://localhost:3000/api/internal/summary-worker" \
  -H "authorization: Bearer <CRON_SECRET>"
```

응답 예시:

```json
{
  "picked": 1,
  "completed": 1,
  "failed": 0,
  "avgDurationMs": 842,
  "failureCodes": {}
}
```

## 품질 게이트

```bash
pnpm db:check
pnpm db:crud-check
pnpm lint
pnpm build
```
