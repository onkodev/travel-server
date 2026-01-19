import { Module, forwardRef } from '@nestjs/common';
import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './chatbot.service';
import { AiEstimateService } from './ai-estimate.service';
import { EstimateModule } from '../estimate/estimate.module';
import { VisitorModule } from '../visitor/visitor.module';

@Module({
  imports: [EstimateModule, forwardRef(() => VisitorModule)],
  controllers: [ChatbotController],
  providers: [ChatbotService, AiEstimateService],
  exports: [ChatbotService, AiEstimateService],
})
export class ChatbotModule {}
