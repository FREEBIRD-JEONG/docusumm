# DocuSumm Tech Spec

## 소스 트리 구조 (Source Tree Structure)

```
docusumm/
├── app/                     # Next.js App Router
│   ├── api/                 # API Routes
│   │   ├── webhooks/        # Stripe Webhook
│   │   ├── summary/         # 요약 로직
│   │   └── payment/         # 결제 로직
│   ├── auth/                # 인증 관련 페이지
│   ├── dashboard/           # 메인 애플리케이션 뷰
│   │   ├── components/      # 대시보드 전용 컴포넌트
│   │   └── layout.tsx       # 대시보드 레이아웃 (사이드바)
│   ├── layout.tsx           # 루트 레이아웃
│   └── page.tsx             # 랜딩/리다이렉트
├── components/              # 공용 UI 컴포넌트
│   ├── ui/                  # Shadcn UI (Atomic)
│   ├── summary/             # 요약 관련 컴포넌트
│   └── payment/             # 결제 관련 컴포넌트
├── db/                      # Drizzle ORM 및 스키마 정의
├── lib/                     # 비즈니스 로직 및 통합
│   ├── supabase/            # Supabase Client (Auth용)
│   ├── gemini/              # AI 로직
│   ├── stripe/              # 결제 로직
│   └── resend/              # 이메일 로직
├── hooks/                   # 커스텀 훅
├── types/                   # TypeScript 정의
├── utils/                   # 헬퍼 함수
├── middleware.ts            # 인증 미들웨어
├── drizzle/                 # Drizzle 마이그레이션 파일
├── drizzle.config.ts        # Drizzle 설정 파일
└── public/                  # 정적 파일
```

## 기술적 접근 (Technical Approach)

### 1. 아키텍처 개요

-   **프론트엔드**: Next.js 16 기반 App Router 사용. `src` 폴더 없이 루트 레벨 구조 채택.
-   **백엔드**: 별도 서버 없이 Next.js API Routes (Serverless Functions) 활용.
-   **데이터베이스**: Supabase (PostgreSQL)를 사용하여 관계형 데이터 관리.
-   **ORM**: Drizzle ORM을 사용하여 타입 안전한(Type-safe) 쿼리 및 스키마 관리.
-   **AI 엔진**: Google Gemini API를 활용한 요약 기능 구현.
-   **결제 시스템**: Stripe Checkout 및 Webhook을 통한 크레딧 시스템 구현.

### 2. 데이터 흐름 (Data Flow)

1. **사용자 상호작용**: 대시보드에서 텍스트/URL 입력.
2. **요청 접수**: `POST /api/summary`가 입력을 검증하고 `pending` 레코드 + 요약 작업(job)을 생성.
3. **비동기 처리**: 워커(`GET/POST /api/internal/summary-worker`)가 Gemini를 호출해 `completed/failed`로 업데이트.
4. **결과 조회**: 프론트는 `GET /api/summaries/[id]` 폴링으로 최종 상태/결과를 반영.
5. **크레딧 시스템**: Stripe Webhook이 결제 완료 이벤트를 수신하여 Supabase의 `credits` 컬럼 업데이트.
6. **알림**: 작업 완료 시 Resend를 통해 이메일 발송.

## 구현 스택 (Implementation Stack)

-   **프레임워크**: Next.js 16+ (App Router)
-   **언어**: TypeScript
-   **스타일링**: Tailwind CSS, Shadcn UI
-   **인증**: Supabase Auth
-   **데이터베이스**: Supabase (PostgreSQL)
-   **ORM**: Drizzle ORM
-   **AI 모델**: Google Gemini 2.0 Flash (gemini-2.0-flash)
-   **결제**: Stripe
-   **이메일**: Resend

## 기술 상세 (Technical Details)

### 1. 데이터베이스 스키마 (Database Schema)

**Note**: 스키마 관리는 Drizzle ORM을 사용하여 TypeScript로 정의 및 마이그레이션합니다.

```typescript
// Drizzle Schema Example (db/schema.ts)
// users, summaries, credit_transactions 테이블 정의
```

```sql
-- Reference SQL (Drizzle Kit push로 생성됨)
-- users: 사용자 정보 테이블
create table public.users (
  id uuid references auth.users not null primary key,
  email text not null,
  credits int default 3, -- 가입 보너스
  created_at timestamptz default now()
);

-- summaries: 요약 데이터 테이블
create table public.summaries (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.users not null,
  source_type text check (source_type in ('text', 'youtube')),
  original_content text,
  summary_text text,
  status text check (status in ('pending', 'completed', 'failed')),
  created_at timestamptz default now()
);

-- credit_transactions: 크레딧 변동 내역 테이블
create table public.credit_transactions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.users not null,
  amount int not null, -- 충전은 양수, 사용은 음수
  type text, -- 'bonus', 'charge', 'usage'
  created_at timestamptz default now()
);
```

### 2. 핵심 로직 (Core Logic - Gemini)

-   **텍스트 요약**: 프롬프트 엔지니어링을 통해 핵심 요약 추출 (Context Window 관리).
-   **YouTube 요약**: Gemini API의 Video Understanding 기능 활용 (별도 자막 추출 없이 API가 YouTube URL/영상 처리).

### 3. 결제 로직 (Payment Logic - Stripe)

-   **상품 구성**: 30 크레딧 ($5), 50 크레딧 ($8), 100 크레딧 ($15).
-   **Webhook**: `checkout.session.completed` 이벤트를 수신하여 사용자 크레딧 증가 처리.

## 개발 설정 (Development Setup)

1. **설치**: `pnpm install`
2. **환경 변수**: `.env.local`에 Supabase, Gemini, Stripe 키 설정
3. **실행**: `pnpm dev`

## 구현 가이드 (Implementation Guide)

### 단계 1: UI/UX 프레임워크 (Epic 1)

-   **E1-S1: 대시보드 레이아웃/내비게이션 셸**
    -   구현 작업: `app/dashboard/layout.tsx` 기준 레이아웃 골격, 반응형 사이드바, 접근성 속성(`aria-expanded`, 포커스 트랩) 적용.
    -   완료 조건: 모바일/데스크톱에서 레이아웃 깨짐 없이 렌더링되고 키보드 조작으로 사이드바 토글 가능.
-   **E1-S2: 입력 패널(Text/YouTube) 컴포넌트**
    -   구현 작업: 탭 전환 UI, `Textarea` auto-resize, YouTube URL 패턴 검증(클라이언트), 버튼 disabled 상태 처리.
    -   완료 조건: 유효하지 않은 입력에서 제출 불가, 입력 상태에 따라 즉시 피드백 표시.
-   **E1-S3: 결과 카드/히스토리 목업 상호작용**
    -   구현 작업: Mock 데이터 기반 `SummaryCard` + `Sidebar History` 연결, 로딩/빈 상태 컴포넌트 추가.
    -   완료 조건: 히스토리 클릭 시 결과 카드가 교체되고 로딩/빈 상태 전환이 시각적으로 확인 가능.

### 단계 2: 핵심 기능 (Epic 2)

-   **E2-S1: 요약 데이터 모델/저장소 계층**
    -   구현 작업: `db/schema.ts`에 `summaries` 스키마 정의, Drizzle 마이그레이션 생성, CRUD 함수 작성.
    -   완료 조건: `pending -> completed/failed` 상태 업데이트가 단일 레코드 기준으로 동작.
-   **E2-S2: Gemini 서비스 모듈**
    -   구현 작업: `lib/gemini`에 텍스트/YouTube 입력 처리 함수와 공통 프롬프트 템플릿, 예외 처리 래퍼 구현.
    -   완료 조건: 입력 타입별 요약이 동일 인터페이스로 호출되며 실패 시 표준 에러 반환.
-   **E2-S3: `/api/summary` 파이프라인**
    -   구현 작업: `app/api/summary/route.ts`에서 입력 검증 후 `pending` 저장/작업 큐 등록, 워커에서 Gemini 비동기 처리.
    -   완료 조건: `POST /api/summary`는 `202 + id/status/summary(null)`를 반환하고, `GET /api/summaries/[id]`도 동일 키(`id/status/summary`)를 포함해 폴링 흐름이 일관되게 동작.
-   **E2-S4: 프론트엔드 연동/상태 피드백**
    -   구현 작업: 입력 패널 submit 핸들러, 로딩 인디케이터, 토스트 상태 알림(접수/완료/실패), 성공 시 결과 카드 갱신.
    -   완료 조건: 중복 제출 방지, 실패 후 재시도 가능, 성공 시 최신 요약이 즉시 UI에 반영.

### 단계 3: 인증 및 계정 (Epic 3)

-   Supabase Auth 설정.
-   `Middleware`를 통한 보호된 라우트(Protected Routes) 구현.
-   DB(`summaries` 테이블) 연동하여 사이드바 히스토리 조회 및 상세 보기 기능 구현.

### 단계 4: 결제 시스템 (Epic 4)

-   Stripe Checkout 설정.
-   Webhook 구현을 통한 크레딧 업데이트 로직 완성.

### 단계 5: 알림 (Epic 5)

-   Resend 연동하여 이메일 알림 구현.

## 테스트 접근 방식 (Testing Approach)

-   **수동 테스트**: 전체 플로우 검증 (가입 -> 크레딧 확인 -> 요약 -> 이메일 수신).
-   **Stripe 테스트 모드**: 결제 및 크레딧 충전 로직 검증.

## 배포 전략 (Deployment Strategy)

-   **Vercel**: 프론트엔드 및 API 배포 최적화.
-   **Supabase**: 데이터베이스 및 인증 관리.
