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
2. **데이터 처리**: API Route가 Gemini 호출 -> 결과 및 로그를 Supabase에 저장.
3. **크레딧 시스템**: Stripe Webhook이 결제 완료 이벤트를 수신하여 Supabase의 `credits` 컬럼 업데이트.
4. **알림**: 작업 완료 시 Resend를 통해 이메일 발송.

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

1. **설치**: `npx create-next-app@latest` (src 디렉토리 사용 안 함 옵션 선택).
2. **환경 변수**: `.env.local`에 Supabase, Gemini, Stripe 키 설정.
3. **실행**: `npm run dev`.

## 구현 가이드 (Implementation Guide)

### 단계 1: UI/UX 프레임워크 (Epic 1)

-   Next.js 프로젝트 설정.
-   Tailwind & Shadcn UI 설치.
-   `Sidebar`, `InputPanel`, `SummaryCard` 등 기본 컴포넌트 퍼블리싱 (Mock 데이터 사용).

### 단계 2: 핵심 기능 (Epic 2)

-   Drizzle ORM 설정 (`db/schema.ts`, `drizzle.config.ts`) 및 Supabase 연결.
-   `lib/gemini` 구현.
-   UI와 `/api/summary` 연결.
-   요약 완료 후 결과를 `summaries` 테이블에 저장하는 로직 구현 (Drizzle 사용).
-   로딩 상태(Loading State) 처리.

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