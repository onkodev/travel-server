import { Module } from '@nestjs/common';
import { FaqController } from './faq.controller';
import { FaqService } from './faq.service';
import { AiModule } from '../ai/ai.module';
import { AiPromptModule } from '../ai-prompt/ai-prompt.module';

@Module({
  imports: [AiModule, AiPromptModule],
  controllers: [FaqController],
  providers: [FaqService],
  exports: [FaqService],
})
export class FaqModule {}
