import { Module } from '@nestjs/common';
import { ContactController } from './contact.controller';
import { ContactService } from './contact.service';
import { NotificationModule } from '../notification/notification.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [PrismaModule, NotificationModule, EmailModule],
  controllers: [ContactController],
  providers: [ContactService],
})
export class ContactModule {}
