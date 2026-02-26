import { Module } from '@nestjs/common';
import { GmailController } from './gmail.controller';
import { GmailService } from './gmail.service';
import { GmailSyncService } from './gmail-sync.service';
import { FaqModule } from '../faq/faq.module';
import { EmailRagModule } from '../email-rag/email-rag.module';

@Module({
  imports: [FaqModule, EmailRagModule],
  controllers: [GmailController],
  providers: [GmailService, GmailSyncService],
  exports: [GmailSyncService],
})
export class GmailModule {}
