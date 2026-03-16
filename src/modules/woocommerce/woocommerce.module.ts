import { Module } from '@nestjs/common';
import { WooCommerceService } from './woocommerce.service';

@Module({
  providers: [WooCommerceService],
  exports: [WooCommerceService],
})
export class WooCommerceModule {}
