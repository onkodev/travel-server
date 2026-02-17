# Tumakr Server

NestJS 기반 여행 플랫폼 백엔드 API입니다.

## 기술 스택

| 분류 | 기술 | 버전 |
|------|------|------|
| Framework | NestJS | 11.x |
| Language | TypeScript | 5.x |
| ORM | Prisma | 6.x |
| Database | PostgreSQL (+ pgvector) | 15.x |
| Auth | Supabase Auth | 2.x |
| AI | Google Gemini (2.5 Flash) | - |
| Email | AWS SES, Gmail API | - |
| Payment | PayPal | - |
| Storage | AWS S3 | - |
| Deploy | Railway | - |

## 설치 및 실행

```bash
# 의존성 설치
yarn install

# Prisma 클라이언트 생성
yarn prisma:generate

# 개발 서버 (포트 4000)
yarn start:dev

# 빌드
yarn build

# 프로덕션 서버
yarn start:prod

# DB 마이그레이션
yarn prisma:migrate
```

## 환경 변수

`.env` 파일 생성:

```env
# Server
PORT=4000
NODE_ENV=development
CLIENT_URL=http://localhost:3000

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/tumakr
DIRECT_URL=postgresql://user:password@localhost:5432/tumakr

# Supabase (인증용)
SUPABASE_AUTH_URL=your_auth_supabase_url
SUPABASE_AUTH_SERVICE_KEY=your_service_key
SUPABASE_AUTH_ANON_KEY=your_anon_key

# Supabase (데이터용)
SUPABASE_ADMIN_URL=your_admin_supabase_url
SUPABASE_ADMIN_SERVICE_KEY=your_admin_service_key

# AI
GEMINI_API_KEY=your_gemini_key

# Email (AWS SES)
AWS_SES_REGION=ap-northeast-2
AWS_SES_FROM_EMAIL=noreply@tumakr.com
AWS_SES_REPLY_TO_EMAIL=info@tumakr.com
CHATBOT_NOTIFICATION_EMAIL=admin@tumakr.com

# Gmail (이메일 동기화)
GMAIL_CLIENT_ID=your_client_id
GMAIL_CLIENT_SECRET=your_client_secret
GMAIL_REFRESH_TOKEN=your_refresh_token

# Storage (S3)
AWS_ACCESS_KEY=your_access_key
AWS_SECRET_KEY=your_secret_key
AWS_BUCKET_NAME=your_bucket
AWS_REGION=ap-northeast-2

# PayPal
PAYPAL_CLIENT_ID=your_client_id
PAYPAL_CLIENT_SECRET=your_client_secret

# 기타
TOUR_API_KEY=your_tour_api_key
UNSPLASH_ACCESS_KEY=your_unsplash_key
```

## 프로젝트 구조

```
tumakr-server/
├── src/
│   ├── modules/                    # 기능별 모듈 (25개)
│   │   ├── auth/                   # 인증 (Supabase)
│   │   ├── user/                   # 사용자 관리
│   │   ├── tour/                   # 투어 상품
│   │   ├── booking/                # 예약
│   │   ├── payment/                # 결제 (PayPal)
│   │   ├── estimate/               # 견적 관리/편집
│   │   ├── chatbot/                # AI 챗봇 플로우
│   │   │   ├── chatbot.controller.ts
│   │   │   ├── chatbot.service.ts         # 챗봇 세션/플로우 관리
│   │   │   ├── ai-estimate.service.ts     # AI 견적 생성 (RAG + 매칭)
│   │   │   ├── chatbot-analytics.service.ts
│   │   │   ├── chatbot-sse.service.ts     # SSE 실시간 업데이트
│   │   │   ├── chatbot-step-response.service.ts
│   │   │   ├── conversational-estimate.service.ts
│   │   │   ├── constants/                 # 카테고리 상수
│   │   │   └── dto/                       # DTO
│   │   ├── ai/                     # AI 서비스
│   │   │   ├── core/               # Gemini API, 임베딩
│   │   │   ├── prompts/            # 프롬프트 (견적, FAQ, 아이템)
│   │   │   ├── services/           # AI 도메인 서비스
│   │   │   └── types/              # AI 타입
│   │   ├── email-rag/              # 이메일 RAG 파이프라인
│   │   ├── email/                  # 이메일 발송 (SES) + 템플릿
│   │   ├── gmail/                  # Gmail API 동기화
│   │   ├── faq/                    # FAQ + AI 챗봇 응답
│   │   ├── item/                   # 아이템 (장소, 숙소, 교통 등)
│   │   ├── suggested-place/        # AI 추천 장소 매칭
│   │   ├── notification/           # 알림
│   │   ├── contact/                # 문의 폼
│   │   ├── goods/                  # 상품 판매
│   │   ├── review/                 # 리뷰
│   │   ├── dashboard/              # 대시보드 통계
│   │   ├── file-upload/            # 파일 업로드 (S3)
│   │   ├── visitor/                # 방문자 추적
│   │   ├── geoip/                  # GeoIP 위치 조회
│   │   ├── ai-prompt/              # AI 프롬프트/설정 관리 (관리자)
│   │   ├── odk-tour-list/          # ODK 투어 목록
│   │   ├── itinerary-template/     # 일정 템플릿
│   │   └── health/                 # 헬스체크
│   │
│   ├── common/                     # 공통 모듈
│   │   ├── constants/              # 캐시 TTL 상수
│   │   ├── decorators/             # @Public, @CurrentUser, @Roles
│   │   ├── guards/                 # AuthGuard, RolesGuard
│   │   ├── filters/                # GlobalExceptionFilter
│   │   ├── events/                 # EventEmitter 이벤트
│   │   ├── interfaces/             # 공통 인터페이스
│   │   ├── types/                  # 공통 타입 (EstimateItem 등)
│   │   ├── dto/                    # 공통 DTO (pagination)
│   │   └── utils/                  # 유틸리티
│   │       ├── json-cast.ts        # JSON 타입 캐스팅
│   │       ├── transform.ts        # Supabase 프로필 변환
│   │       ├── memory-cache.ts     # 인메모리 캐시
│   │       └── ...                 # date, decimal, validation 등
│   │
│   ├── prisma/                     # Prisma 서비스
│   ├── supabase/                   # Supabase 서비스 (토큰/프로필 캐시)
│   ├── app.module.ts               # 루트 모듈
│   └── main.ts                     # 엔트리포인트
│
├── prisma/
│   └── schema.prisma               # DB 스키마
│
└── test/                           # E2E 테스트
```

## API 문서

Swagger: `http://localhost:4000/api/docs` (프로덕션에서는 비활성화)

### 주요 엔드포인트

| 모듈 | 엔드포인트 | 설명 |
|------|-----------|------|
| Auth | `POST /api/auth/signin` | 로그인 |
| Auth | `POST /api/auth/signup` | 회원가입 |
| Auth | `GET /api/auth/me` | 내 정보 |
| Tour | `GET /api/tours` | 투어 목록 |
| Tour | `GET /api/tours/:id` | 투어 상세 |
| Booking | `POST /api/bookings` | 예약 생성 |
| Estimate | `GET /api/estimates/:id` | 견적 조회 |
| Estimate | `GET /api/estimates/share/:hash` | 공유 링크 조회 |
| Chatbot | `POST /api/chatbot/start` | 챗봇 시작 |
| Chatbot | `PATCH /api/chatbot/:id/step/:step` | 단계 업데이트 |
| Chatbot | `POST /api/chatbot/:id/estimate/generate` | AI 견적 생성 |
| Chatbot | `POST /api/chatbot/:id/send-to-expert` | 전문가에게 전송 |
| FAQ | `POST /api/faq/chat` | FAQ AI 챗봇 |
| Email RAG | `GET /api/email-rag/threads` | 이메일 스레드 조회 |

## 인증

- Supabase Auth 사용
- `@Public()` 데코레이터로 공개 엔드포인트 지정
- `@CurrentUser('id')`, `@CurrentUser('role')` 로 사용자 정보 접근
- `@Roles('admin')` + RolesGuard로 관리자 전용
- AuthGuard에서 프로필 role 자동 포함

```typescript
// 공개 API
@Public()
@Get('tours')
getTours() {}

// 인증 필요 API
@Get('me')
getMe(@CurrentUser('id') userId: string) {}

// 관리자 전용
@Roles('admin')
@Delete(':id')
delete(@CurrentUser('id') userId: string) {}
```

## AI 견적 생성 파이프라인

```
1. 이메일 임베딩 검색 (pgvector similarity)
2. 유사 이메일 스레드 수집 (RAG)
3. Gemini 2.5 Flash로 견적 초안 생성
4. DB 아이템 매칭 (정확 → 부분 → 퍼지)
5. 사용자 명소 반영 + 지역 필터
6. 신뢰도 점수 계산
→ 견적 생성 완료
```

## 챗봇 플로우

6단계 설문 기반 여행 상담:

```
1. 투어 타입 (private, group, inquiry)
2. 첫 방문 여부
3. 관심사 (메인 → 서브)
4. 지역 + 명소
5. 계획 유무
6. 폼 (인적사항 + 여행정보)
→ AI 견적 생성 or 전문가에게 전송
```

## 외부 서비스

| 서비스 | 용도 |
|--------|------|
| Supabase | 인증, 일부 데이터 (투어) |
| PostgreSQL | 메인 데이터베이스 (pgvector) |
| Google Gemini | AI 견적 생성, FAQ 챗봇 |
| AWS SES | 이메일 발송 |
| Gmail API | 이메일 동기화 (RAG용) |
| PayPal | 결제 |
| AWS S3 | 파일 저장 |
| Railway | 배포 |

## 관련 프로젝트

- **tumakr-client**: Next.js 프론트엔드 (포트 3000)
