import { Module } from '@nestjs/common';
import {
  GoodsPublicController,
  GoodsAdminController,
} from './goods.controller';
import { GoodsService } from './goods.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [GoodsPublicController, GoodsAdminController],
  providers: [GoodsService],
  exports: [GoodsService],
})
export class GoodsModule {}
