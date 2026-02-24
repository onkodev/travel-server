import { Module } from '@nestjs/common';
import { EstimateController } from './estimate.controller';
import { EstimateService } from './estimate.service';
import { EstimateStatsService } from './estimate-stats.service';
import { EstimateDispatchService } from './estimate-dispatch.service';
import { EstimateSchedulerService } from './estimate-scheduler.service';
import { EmailModule } from '../email/email.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [EmailModule, NotificationModule],
  controllers: [EstimateController],
  providers: [
    EstimateService,
    EstimateStatsService,
    EstimateDispatchService,
    EstimateSchedulerService,
  ],
  exports: [EstimateService, EstimateStatsService],
})
export class EstimateModule {}
