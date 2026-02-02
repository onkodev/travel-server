import { Module } from '@nestjs/common';
import { GmailController } from './gmail.controller';
import { GmailService } from './gmail.service';
import { GmailSyncService } from './gmail-sync.service';
import { AiModule } from '../ai/ai.module';
import { FaqModule } from '../faq/faq.module';

@Module({
  imports: [AiModule, FaqModule],
  controllers: [GmailController],
  providers: [GmailService, GmailSyncService],
  exports: [GmailSyncService],
})
export class GmailModule {}
