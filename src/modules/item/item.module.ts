import { Module } from '@nestjs/common';
import { ItemController } from './item.controller';
import { ItemService } from './item.service';
import { PlaceMatcherService } from './place-matcher.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ItemController],
  providers: [ItemService, PlaceMatcherService],
  exports: [ItemService, PlaceMatcherService],
})
export class ItemModule {}
