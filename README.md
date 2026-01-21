# Tumakr Server

NestJS 기반 여행 플랫폼 백엔드 API입니다.

## 기술 스택

| 분류 | 기술 | 버전 |
|------|------|------|
| Framework | NestJS | 10.x |
| Language | TypeScript | 5.x |
| ORM | Prisma | 6.x |
| Database | PostgreSQL | 15.x |
| Auth | Supabase Auth | - |
| AI | Google Gemini | - |
| Payment | PayPal | - |
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
```

## 환경 변수

`.env` 파일 생성:

```env
# Server
PORT=4000
NODE_ENV=development

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/tumakr

# Supabase (인증용)
SUPABASE_AUTH_URL=your_auth_supabase_url
SUPABASE_AUTH_SERVICE_KEY=your_service_key
SUPABASE_AUTH_ANON_KEY=your_anon_key

# Supabase (데이터용)
SUPABASE_ADMIN_URL=your_admin_supabase_url
SUPABASE_ADMIN_SERVICE_KEY=your_admin_service_key

# AI
GEMINI_API_KEY=your_gemini_key

# PayPal
PAYPAL_CLIENT_ID=your_client_id
PAYPAL_CLIENT_SECRET=your_client_secret

# Storage
AWS_S3_BUCKET=your_bucket
AWS_REGION=ap-northeast-2
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
```

## 프로젝트 구조

```
tumakr-server/
├── src/
│   ├── modules/                  # 기능별 모듈
│   │   ├── auth/                 # 인증 (Supabase)
│   │   ├── user/                 # 사용자 관리
│   │   ├── tour/                 # 투어 상품
│   │   ├── booking/              # 예약
│   │   ├── payment/              # 결제 (PayPal)
│   │   ├── estimate/             # 견적 관리
│   │   ├── chatbot/              # AI 챗봇 플로우
│   │   │   ├── chatbot.controller.ts
│   │   │   ├── chatbot.service.ts
│   │   │   ├── ai-estimate.service.ts  # AI 견적 생성
│   │   │   ├── constants/        # 카테고리 상수
│   │   │   └── dto/              # DTO
│   │   ├── ai/                   # AI 서비스
│   │   │   ├── gemini.service.ts # Gemini API
│   │   │   └── tour-api.service.ts
│   │   ├── item/                 # 아이템 (장소, 숙소 등)
│   │   ├── review/               # 리뷰
│   │   ├── dashboard/            # 대시보드 통계
│   │   ├── file-upload/          # 파일 업로드
│   │   ├── visitor/              # 방문자 추적
│   │   └── itinerary-template/   # 일정 템플릿
│   │
│   ├── common/                   # 공통 모듈
│   │   ├── decorators/
│   │   │   ├── public.decorator.ts    # @Public()
│   │   │   ├── user.decorator.ts      # @CurrentUser()
│   │   │   └── require-user.decorator.ts
│   │   ├── guards/
│   │   │   └── auth.guard.ts     # JWT 인증 가드
│   │   ├── filters/
│   │   │   └── global-exception.filter.ts
│   │   └── dto/                  # 공통 DTO
│   │
│   ├── prisma/
│   │   └── prisma.service.ts     # Prisma 클라이언트
│   │
│   ├── supabase/
│   │   └── supabase.service.ts   # Supabase 클라이언트
│   │
│   ├── app.module.ts             # 루트 모듈
│   └── main.ts                   # 엔트리포인트
│
├── prisma/
│   └── schema.prisma             # DB 스키마
│
└── test/                         # E2E 테스트
```

## API 문서

Swagger: `http://localhost:4000/api/docs`

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
| Chatbot | `POST /api/chatbot/:id/send-to-expert` | 전문가에게 전송 |

## 인증

- Supabase Auth 사용
- `@Public()` 데코레이터로 공개 엔드포인트 지정
- `@CurrentUser('id')`, `@CurrentUser('role')` 로 사용자 정보 접근
- AuthGuard에서 프로필 role 자동 포함

```typescript
// 공개 API
@Public()
@Get('tours')
getTours() {}

// 인증 필요 API
@Get('me')
getMe(@CurrentUser('id') userId: string) {}

// 관리자 전용 (role 체크)
@Delete(':id')
delete(
  @CurrentUser('id') userId: string,
  @CurrentUser('role') role: string
) {
  if (role !== 'admin') throw new ForbiddenException();
}
```

## 챗봇 플로우

6단계 설문 기반 여행 상담:

```
1. 투어 타입 (private, group, custom)
2. 첫 방문 여부
3. 계획 유무 + 상세
4. 관심사 (메인 → 서브)
5. 지역 + 명소
6. 폼 (인적사항 + 여행정보)
→ 완료 (전문가에게 전송)
```

## 외부 서비스

| 서비스 | 용도 |
|--------|------|
| Supabase | 인증, 일부 데이터 |
| PostgreSQL | 메인 데이터베이스 |
| Google Gemini | AI 견적 생성 |
| PayPal | 결제 |
| AWS S3 | 파일 저장 |
| Railway | 배포 |

## 관련 프로젝트

- **tumakr-client**: Next.js 프론트엔드 (포트 3000)
