import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ScheduleModule.forRoot(),
    // Rate Limiting: 기본 60초에 100회 요청 허용
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000, // 60초
        limit: 100, // 100회
      },
      {
        name: 'strict',
        ttl: 60000, // 60초
        limit: 10, // 10회 (민감한 엔드포인트용)
      },
    ]),
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
