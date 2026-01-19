import { Module } from '@nestjs/common';
import { VisitorController } from './visitor.controller';
import { VisitorService } from './visitor.service';
import { GeoIpService } from './geoip.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [VisitorController],
  providers: [VisitorService, GeoIpService],
  exports: [VisitorService, GeoIpService],
})
export class VisitorModule {}
