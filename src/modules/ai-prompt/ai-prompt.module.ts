import { Module } from '@nestjs/common';
import { AiPromptController } from './ai-prompt.controller';
import { AiPromptService } from './ai-prompt.service';

@Module({
  controllers: [AiPromptController],
  providers: [AiPromptService],
  exports: [AiPromptService],
})
export class AiPromptModule {}
