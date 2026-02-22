import { Module } from '@nestjs/common';
import { FaqController } from './faq.controller';
import { FaqService } from './faq.service';
import { FaqEmbeddingService } from './faq-embedding.service';
import { FaqChatService } from './faq-chat.service';
import { FaqReviewService } from './faq-review.service';
import { FaqCategorizeService } from './faq-categorize.service';
import { FaqChatLogService } from './faq-chat-log.service';
import { AiModule } from '../ai/ai.module';
import { AiPromptModule } from '../ai-prompt/ai-prompt.module';

@Module({
  imports: [AiModule, AiPromptModule],
  controllers: [FaqController],
  providers: [
    FaqService,
    FaqEmbeddingService,
    FaqChatService,
    FaqReviewService,
    FaqCategorizeService,
    FaqChatLogService,
  ],
  exports: [
    FaqService,
    FaqEmbeddingService,
    FaqChatService,
    FaqReviewService,
    FaqCategorizeService,
    FaqChatLogService,
  ],
})
export class FaqModule {}
