import { Module } from '@nestjs/common';
import { EmailEmbeddingService } from './email-embedding.service';
import { EmailRagService } from './email-rag.service';
import { EmailRagController } from './email-rag.controller';
import { AiModule } from '../ai/ai.module';
import { AiPromptModule } from '../ai-prompt/ai-prompt.module';
import { ItemModule } from '../item/item.module';

@Module({
  imports: [AiModule, AiPromptModule, ItemModule],
  controllers: [EmailRagController],
  providers: [EmailEmbeddingService, EmailRagService],
  exports: [EmailRagService, EmailEmbeddingService],
})
export class EmailRagModule {}
