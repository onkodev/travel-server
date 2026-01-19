import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

import { PrismaModule } from './prisma/prisma.module';
import { SupabaseModule } from './supabase/supabase.module';
import { AuthGuard } from './common/guards/auth.guard';

import { AuthModule } from './modules/auth/auth.module';
import { EstimateModule } from './modules/estimate/estimate.module';
import { ItemModule } from './modules/item/item.module';
import { TourModule } from './modules/tour/tour.module';
import { BookingModule } from './modules/booking/booking.module';
import { ReviewModule } from './modules/review/review.module';
import { AiModule } from './modules/ai/ai.module';
import { PaymentModule } from './modules/payment/payment.module';
import { ItineraryTemplateModule } from './modules/itinerary-template/itinerary-template.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { UserModule } from './modules/user/user.module';
import { FileUploadModule } from './modules/file-upload/file-upload.module';
import { ChatbotModule } from './modules/chatbot/chatbot.module';
import { VisitorModule } from './modules/visitor/visitor.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ScheduleModule.forRoot(),
    // Rate Limiting: 환경에 따라 다르게 설정
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const isProduction = configService.get('NODE_ENV') === 'production';
        return [
          {
            name: 'default',
            ttl: 60000, // 60초
            limit: isProduction ? 100 : 500, // 프로덕션: 100회, 개발: 500회
          },
          {
            name: 'strict',
            ttl: 60000, // 60초
            limit: isProduction ? 10 : 30, // 프로덕션: 10회, 개발: 30회 (로그인 등)
          },
        ];
      },
    }),
    PrismaModule,
    SupabaseModule,
    AuthModule,
    EstimateModule,
    ItemModule,
    TourModule,
    BookingModule,
    ReviewModule,
    AiModule,
    PaymentModule,
    ItineraryTemplateModule,
    DashboardModule,
    UserModule,
    FileUploadModule,
    ChatbotModule,
    VisitorModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
