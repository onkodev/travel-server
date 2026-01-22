import { Module, forwardRef } from '@nestjs/common';
import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './chatbot.service';
import { AiEstimateService } from './ai-estimate.service';
import { EstimateModule } from '../estimate/estimate.module';
import { VisitorModule } from '../visitor/visitor.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [EstimateModule, forwardRef(() => VisitorModule), NotificationModule],
  controllers: [ChatbotController],
  providers: [ChatbotService, AiEstimateService],
  exports: [ChatbotService, AiEstimateService],
})
export class ChatbotModule {}
