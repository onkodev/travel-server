# Claude 코드 가이드 - Tumakr Server

## 프로젝트 개요
- **목적**: 여행 플랫폼 백엔드 API (투어, 견적, 챗봇, 결제)
- **기술 스택**: NestJS, TypeScript, Prisma, PostgreSQL
- **패키지 매니저**: yarn

## 폴더 구조

```
tumakr-server/
├── src/
│   ├── modules/            # 기능별 모듈
│   │   ├── auth/           # 인증 (Supabase)
│   │   ├── user/           # 사용자 관리
│   │   ├── tour/           # 투어 상품
│   │   ├── booking/        # 예약
│   │   ├── payment/        # 결제 (PayPal)
│   │   ├── estimate/       # 견적
│   │   ├── chatbot/        # AI 챗봇 플로우
│   │   ├── ai/             # AI 서비스 (Gemini)
│   │   ├── item/           # 아이템 (장소, 숙소 등)
│   │   ├── review/         # 리뷰
│   │   ├── dashboard/      # 대시보드 통계
│   │   ├── file-upload/    # 파일 업로드
│   │   ├── visitor/        # 방문자 추적
│   │   └── itinerary-template/ # 일정 템플릿
│   ├── common/             # 공통 모듈
│   │   ├── decorators/     # 커스텀 데코레이터
│   │   ├── guards/         # 가드 (AuthGuard)
│   │   ├── filters/        # 예외 필터
│   │   └── dto/            # 공통 DTO
│   ├── prisma/             # Prisma 서비스
│   ├── supabase/           # Supabase 서비스
│   └── main.ts             # 앱 엔트리포인트
├── prisma/
│   └── schema.prisma       # DB 스키마
└── test/                   # E2E 테스트
```

## 주요 규칙

### 커밋
- 공동작업자 (Co-Authored-By) 없이 커밋
- 커밋 메시지는 한글로 간결하게

### 코드 스타일
- NestJS 컨벤션 준수
- 모듈별로 controller, service, dto 분리
- DTO는 class-validator 데코레이터 사용

### 인증
- Supabase Auth 사용
- `@Public()` 데코레이터로 공개 엔드포인트 지정
- `@CurrentUser('id')`, `@CurrentUser('role')` 로 사용자 정보 접근
- AuthGuard에서 프로필 role 자동 포함

## 주요 파일

| 파일 | 설명 |
|------|------|
| `src/main.ts` | 앱 부트스트랩, Swagger 설정 |
| `src/app.module.ts` | 루트 모듈 (모든 모듈 import) |
| `src/common/guards/auth.guard.ts` | JWT 인증 가드 |
| `src/prisma/prisma.service.ts` | Prisma 클라이언트 |
| `src/supabase/supabase.service.ts` | Supabase 클라이언트 |

## 환경 변수
```env
# Database
DATABASE_URL                    # PostgreSQL 연결 URL

# Supabase (인증용)
SUPABASE_AUTH_URL               # 인증 Supabase URL
SUPABASE_AUTH_SERVICE_KEY       # Service Role Key
SUPABASE_AUTH_ANON_KEY          # Anon Key

# Supabase (데이터용)
SUPABASE_ADMIN_URL              # 데이터 Supabase URL
SUPABASE_ADMIN_SERVICE_KEY      # Service Role Key

# AI
GEMINI_API_KEY                  # Google Gemini API

# PayPal
PAYPAL_CLIENT_ID
PAYPAL_CLIENT_SECRET

# 기타
PORT=4000
NODE_ENV=development
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
- **Supabase**: 인증, 일부 데이터
- **PostgreSQL**: 메인 데이터베이스
- **Google Gemini**: AI 견적 생성
- **PayPal**: 결제 처리
- **AWS S3**: 파일 저장

## 관련 프로젝트
- `tumakr-client`: Next.js 프론트엔드
