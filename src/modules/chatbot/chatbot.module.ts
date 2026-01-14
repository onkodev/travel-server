import { Module } from '@nestjs/common';
import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './chatbot.service';
import { EstimateModule } from '../estimate/estimate.module';

@Module({
  imports: [EstimateModule],
  controllers: [ChatbotController],
  providers: [ChatbotService],
  exports: [ChatbotService],
})
export class ChatbotModule {}
