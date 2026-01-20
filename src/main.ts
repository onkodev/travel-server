import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import compression from 'compression';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn'], // 에러와 경고만 출력
  });

  // Gzip 압축 (응답 크기 60% 이상 감소)
  app.use(compression());

  // CORS 설정
  app.enableCors({
    origin: process.env.NODE_ENV === 'production'
      ? (origin, callback) => {
          const allowedOrigins = [
            'https://tumakr.com',
            'https://www.tumakr.com',
            'https://admin.tumakr.com',
            'https://tumakrguide.com',
            'https://www.tumakrguide.com',
            process.env.CLIENT_URL,
          ].filter(Boolean);

          // Vercel 프리뷰 및 localhost 허용
          if (
            !origin ||
            allowedOrigins.includes(origin) ||
            origin.endsWith('.vercel.app') ||
            origin.startsWith('http://localhost:')
          ) {
            callback(null, true);
          } else {
            callback(new Error('Not allowed by CORS'));
          }
        }
      : true, // 개발환경: 모든 origin 허용
    credentials: true,
  });

  // API prefix
  app.setGlobalPrefix('api');

  // Swagger 설정 (프로덕션에서는 비활성화)
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Tumakr API')
      .setDescription('투어/여행 견적 관리 플랫폼 API 문서')
      .setVersion('1.0')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Supabase JWT 토큰을 입력하세요',
        },
        'access-token',
      )
      .addTag('인증', '사용자 인증 및 계정 관리')
      .addTag('사용자', '사용자 정보 조회 및 관리')
      .addTag('견적', '여행 견적 생성 및 관리')
      .addTag('투어', '투어 상품 관리')
      .addTag('예약', '투어 예약 관리')
      .addTag('결제', 'PayPal 결제 처리')
      .addTag('채팅', 'AI 챗봇 세션 관리')
      .addTag('아이템', '여행지/숙소/교통 등 아이템 관리')
      .addTag('리뷰', '투어 리뷰 관리')
      .addTag('AI', 'AI 기능 (채팅, 분석, 일정 생성)')
      .addTag('대시보드', '어드민 대시보드 통계')
      .addTag('일정 템플릿', '일정 템플릿 저장 및 관리')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
      },
      customSiteTitle: 'Tumakr API 문서',
    });
  }

  // Global exception filter
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false, // analytics 등 유연한 데이터 수신 허용
    }),
  );

  const port = process.env.PORT || 4000;
  await app.listen(port);

  console.log('\n✅ 서버 실행 완료');
  console.log(`   http://localhost:${port}/api/docs\n`);
}

bootstrap().catch((err) => {
  console.error('Application failed to start:', err);
  process.exit(1);
});
