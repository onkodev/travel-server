# Claude 코드 가이드 - Tumakr Server

## 프로젝트 개요
- **목적**: 여행 플랫폼 백엔드 API (투어, 견적, 챗봇, 결제, FAQ, 이메일)
- **기술 스택**: NestJS 11, TypeScript 5, Prisma 6, PostgreSQL
- **패키지 매니저**: yarn

## 폴더 구조

```
tumakr-server/
├── src/
│   ├── modules/              # 기능별 모듈 (25개)
│   │   ├── auth/             # 인증 (Supabase)
│   │   ├── user/             # 사용자 관리
│   │   ├── tour/             # 투어 상품 (Supabase 직접 호출)
│   │   ├── booking/          # 예약
│   │   ├── payment/          # 결제 (PayPal)
│   │   ├── estimate/         # 견적 관리/편집
│   │   ├── chatbot/          # AI 챗봇 플로우 + 견적 생성
│   │   ├── ai/               # AI 서비스 (Gemini core, prompts, services)
│   │   ├── email-rag/        # 이메일 RAG 파이프라인
│   │   ├── email/            # 이메일 발송 (AWS SES) + 템플릿
│   │   ├── gmail/            # Gmail API 연동 (이메일 동기화)
│   │   ├── faq/              # FAQ + AI 챗봇 응답
│   │   ├── item/             # 아이템 (장소, 숙소, 교통 등)
│   │   ├── suggested-place/  # AI 추천 장소 매칭
│   │   ├── notification/     # 알림
│   │   ├── contact/          # 문의 폼
│   │   ├── goods/            # 상품 판매
│   │   ├── review/           # 리뷰
│   │   ├── dashboard/        # 대시보드 통계
│   │   ├── file-upload/      # 파일 업로드 (S3)
│   │   ├── visitor/          # 방문자 추적
│   │   ├── geoip/            # GeoIP 위치 조회
│   │   ├── ai-prompt/        # AI 프롬프트/설정 관리
│   │   ├── odk-tour-list/    # ODK 투어 목록
│   │   ├── itinerary-template/ # 일정 템플릿
│   │   └── health/           # 헬스체크
│   │
│   ├── common/               # 공통 모듈
│   │   ├── constants/        # 캐시 TTL 등 상수
│   │   ├── decorators/       # @Public, @CurrentUser, @Roles
│   │   ├── guards/           # AuthGuard, RolesGuard
│   │   ├── filters/          # GlobalExceptionFilter
│   │   ├── events/           # EventEmitter 이벤트 (chatbot, estimate)
│   │   ├── interfaces/       # 공통 인터페이스
│   │   ├── types/            # 공통 타입 (EstimateItem 등)
│   │   ├── dto/              # 공통 DTO (pagination 등)
│   │   └── utils/            # 유틸리티 (json-cast, transform, memory-cache 등)
│   │
│   ├── prisma/               # Prisma 서비스
│   ├── supabase/             # Supabase 서비스 (토큰/프로필 캐시)
│   └── main.ts               # 앱 엔트리포인트
│
├── prisma/
│   └── schema.prisma         # DB 스키마
└── test/                     # E2E 테스트
```

## 주요 규칙

### 커밋
- 공동작업자 (Co-Authored-By) 없이 커밋
- 커밋 메시지는 한글로 간결하게

### 코드 스타일
- NestJS 컨벤션 준수
- 모듈별로 controller, service, dto 분리
- DTO는 class-validator 데코레이터 사용
- JSON 필드 캐스팅: `jsonCast<T>()` (common/utils)
- 캐시 TTL: `CACHE_TTL.*` 상수 사용 (common/constants/cache.ts)
- Supabase 프로필 변환: `supabaseProfileToCamelCase()` (common/utils/transform.ts)

### 인증
- Supabase Auth 사용
- `@Public()` 데코레이터로 공개 엔드포인트 지정
- `@CurrentUser('id')`, `@CurrentUser('role')` 로 사용자 정보 접근
- AuthGuard에서 프로필 role 자동 포함
- `@Roles('admin')` + RolesGuard로 관리자 전용

## 주요 파일

| 파일 | 설명 |
|------|------|
| `src/main.ts` | 앱 부트스트랩, CORS, Swagger 설정 |
| `src/app.module.ts` | 루트 모듈 (ThrottlerModule, EventEmitter 포함) |
| `src/common/guards/auth.guard.ts` | JWT 인증 가드 |
| `src/common/constants/cache.ts` | 캐시 TTL 상수 (TOKEN, PROFILE, TOUR, AI_CONFIG, ITEM) |
| `src/common/utils/index.ts` | 유틸리티 barrel (json-cast, transform 등) |
| `src/modules/chatbot/ai-estimate.service.ts` | AI 견적 생성 (RAG + 매칭) |
| `src/modules/email-rag/email-rag.service.ts` | 이메일 RAG 파이프라인 |
| `src/modules/ai/core/gemini-core.service.ts` | Gemini API 공통 호출 (429 재시도) |
| `src/modules/ai/core/embedding.service.ts` | 임베딩 생성 (gemini-embedding-001) |

## 환경 변수
```env
# Server
PORT=4000
NODE_ENV=development
CLIENT_URL=http://localhost:3000

# Database
DATABASE_URL                    # PostgreSQL 연결 URL (pooling)
DIRECT_URL                      # PostgreSQL 직접 연결 URL

# Supabase (인증용)
SUPABASE_AUTH_URL               # 인증 Supabase URL
SUPABASE_AUTH_SERVICE_KEY       # Service Role Key
SUPABASE_AUTH_ANON_KEY          # Anon Key

# Supabase (데이터용)
SUPABASE_ADMIN_URL              # 데이터 Supabase URL
SUPABASE_ADMIN_SERVICE_KEY      # Service Role Key

# AI
GEMINI_API_KEY                  # Google Gemini API

# Email
AWS_SES_REGION                  # SES 리전 (ap-northeast-2)
AWS_SES_FROM_EMAIL              # 발신 이메일
AWS_SES_REPLY_TO_EMAIL          # 회신 이메일
CHATBOT_NOTIFICATION_EMAIL      # 챗봇 알림 수신 이메일

# Gmail
GMAIL_CLIENT_ID
GMAIL_CLIENT_SECRET
GMAIL_REFRESH_TOKEN

# Storage (S3)
AWS_ACCESS_KEY
AWS_SECRET_KEY
AWS_BUCKET_NAME
AWS_REGION

# PayPal
PAYPAL_CLIENT_ID
PAYPAL_CLIENT_SECRET

# 기타
TOUR_API_KEY                    # 외부 투어 API
UNSPLASH_ACCESS_KEY             # Unsplash 이미지
```

## 명령어
```bash
yarn start:dev    # 개발 서버 (watch 모드)
yarn build        # 빌드
yarn start:prod   # 프로덕션 서버
yarn prisma:generate  # Prisma 클라이언트 생성
yarn prisma:migrate   # DB 마이그레이션
```

## API 문서
- Swagger: `http://localhost:4000/api/docs`
- 프로덕션에서는 비활성화

## 외부 서비스
- **Supabase**: 인증, 일부 데이터 (투어)
- **PostgreSQL**: 메인 데이터베이스 (pgvector 확장)
- **Google Gemini**: AI 견적 생성, FAQ 챗봇, 아이템 추천
- **AWS SES**: 이메일 발송
- **Gmail API**: 이메일 동기화 (RAG 파이프라인용)
- **PayPal**: 결제 처리
- **AWS S3**: 파일 저장
- **Railway**: 배포

## 관련 프로젝트
- `tumakr-client`: Next.js 프론트엔드
