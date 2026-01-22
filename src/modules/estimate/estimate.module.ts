import { Module } from '@nestjs/common';
import { EstimateController } from './estimate.controller';
import { EstimateService } from './estimate.service';
import { EstimateSchedulerService } from './estimate-scheduler.service';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [EmailModule],
  controllers: [EstimateController],
  providers: [EstimateService, EstimateSchedulerService],
  exports: [EstimateService],
})
export class EstimateModule {}
