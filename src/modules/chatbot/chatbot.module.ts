import { Module } from '@nestjs/common';
import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './chatbot.service';
import { ChatbotMessageService } from './chatbot-message.service';
import { ChatbotCompletionService } from './chatbot-completion.service';
import { ChatbotAnalyticsService } from './chatbot-analytics.service';
import { ChatbotStepResponseService } from './chatbot-step-response.service';
import { AiEstimateService } from './ai-estimate.service';
import { ConversationalEstimateService } from './conversational-estimate.service';
import { EstimateModule } from '../estimate/estimate.module';
import { NotificationModule } from '../notification/notification.module';
import { AiModule } from '../ai/ai.module';
import { ItemModule } from '../item/item.module';
import { EmailModule } from '../email/email.module';
import { EmailRagModule } from '../email-rag/email-rag.module';
import { SupabaseModule } from '../../supabase/supabase.module';

@Module({
  imports: [
    EstimateModule,
    NotificationModule,
    AiModule,
    ItemModule,
    EmailModule,
    EmailRagModule,
    SupabaseModule,
  ],
  controllers: [ChatbotController],
  providers: [
    ChatbotService,
    ChatbotMessageService,
    ChatbotCompletionService,
    ChatbotAnalyticsService,
    ChatbotStepResponseService,
    AiEstimateService,
    ConversationalEstimateService,
  ],
  exports: [
    ChatbotService,
    ChatbotMessageService,
    ChatbotCompletionService,
    ChatbotAnalyticsService,
    AiEstimateService,
    ConversationalEstimateService,
  ],
})
export class ChatbotModule {}
