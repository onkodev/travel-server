import { Module } from '@nestjs/common';
import { OdkTourListController } from './odk-tour-list.controller';
import { OdkTourListService } from './odk-tour-list.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [OdkTourListController],
  providers: [OdkTourListService],
  exports: [OdkTourListService],
})
export class OdkTourListModule {}
