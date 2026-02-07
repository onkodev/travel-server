import { Module } from '@nestjs/common';
import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './chatbot.service';
import { ChatbotAnalyticsService } from './chatbot-analytics.service';
import { ChatbotSseService } from './chatbot-sse.service';
import { ChatbotStepResponseService } from './chatbot-step-response.service';
import { AiEstimateService } from './ai-estimate.service';
import { ConversationalEstimateService } from './conversational-estimate.service';
import { EstimateModule } from '../estimate/estimate.module';
import { NotificationModule } from '../notification/notification.module';
import { AiModule } from '../ai/ai.module';
import { ItemModule } from '../item/item.module';
import { EmailModule } from '../email/email.module';
import { SupabaseModule } from '../../supabase/supabase.module';

@Module({
  imports: [
    EstimateModule,
    NotificationModule,
    AiModule,
    ItemModule,
    EmailModule,
    SupabaseModule,
  ],
  controllers: [ChatbotController],
  providers: [
    ChatbotService,
    ChatbotAnalyticsService,
    ChatbotSseService,
    ChatbotStepResponseService,
    AiEstimateService,
    ConversationalEstimateService,
  ],
  exports: [
    ChatbotService,
    ChatbotAnalyticsService,
    ChatbotSseService,
    AiEstimateService,
    ConversationalEstimateService,
  ],
})
export class ChatbotModule {}
