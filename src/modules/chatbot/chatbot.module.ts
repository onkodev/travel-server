import { Module } from '@nestjs/common';
import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './chatbot.service';
import { ChatbotAnalyticsService } from './chatbot-analytics.service';
import { AiEstimateService } from './ai-estimate.service';
import { ConversationalEstimateService } from './conversational-estimate.service';
import { EstimateModule } from '../estimate/estimate.module';
import { NotificationModule } from '../notification/notification.module';
import { AiModule } from '../ai/ai.module';
import { ItemModule } from '../item/item.module';

@Module({
  imports: [EstimateModule, NotificationModule, AiModule, ItemModule],
  controllers: [ChatbotController],
  providers: [ChatbotService, ChatbotAnalyticsService, AiEstimateService, ConversationalEstimateService],
  exports: [ChatbotService, ChatbotAnalyticsService, AiEstimateService, ConversationalEstimateService],
})
export class ChatbotModule {}
