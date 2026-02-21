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
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=
# Legacy fallback: NEXT_PUBLIC_SUPABASE_ANON_KEY=
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

RESEND_API_KEY=
RESEND_FROM_EMAIL=onboarding@resend.dev
RESEND_FROM_NAME=DocuSumm

STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_STARTER=
STRIPE_PRICE_PRO=
STRIPE_PRICE_MAX=
# Optional: Stripe.js/Elements를 클라이언트에서 사용할 때만 필요
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
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

요약이 `completed`로 확정되면 Resend를 통해 완료 알림 메일을 발송합니다.
메일 내 "전체 요약 보기" 버튼은 `/dashboard?summaryId=<요약ID>` 딥링크로 연결됩니다.
`@local.invalid` 같은 개발용 주소는 발송 대상에서 자동 제외됩니다.

### 이메일 템플릿 미리보기 (React Email)

```bash
pnpm email:dev
```

- 기본 주소: `http://localhost:3001`
- 샘플 데이터/프리뷰 엔트리: `emails/summary-completed-email.tsx`

### Stripe 결제 설정 체크리스트

1. Stripe MCP를 사용해 3개 상품/Price를 동기화:
   - Starter: 30 credits / `$5`
   - Pro: 50 credits / `$8`
   - Max: 100 credits / `$15`
2. MCP 실행 결과의 Price ID를 `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_MAX`에 설정
3. MCP 재실행 시 중복 생성이 없도록 `lookup_key` 기반 idempotent 동기화 규칙을 사용
4. Stripe Webhook Endpoint를 `POST /api/webhooks/stripe`로 등록
5. Endpoint Secret을 `STRIPE_WEBHOOK_SECRET`에 설정

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
