import { Module } from '@nestjs/common';
import { GoodsPublicController, GoodsAdminController } from './goods.controller';
import { GoodsService } from './goods.service';

@Module({
  controllers: [GoodsPublicController, GoodsAdminController],
  providers: [GoodsService],
  exports: [GoodsService],
})
export class GoodsModule {}
