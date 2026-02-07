import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class EstimateSchedulerService {
  private readonly logger = new Logger(EstimateSchedulerService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * 매일 자정에 실행 - 견적 상태 자동 업데이트
   * - planning → in_progress: 여행 시작일이 도래한 경우
   * - in_progress → completed: 여행 종료일이 지난 경우
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleEstimateStatusUpdate() {
    this.logger.log('견적 상태 자동 업데이트 시작...');

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    try {
      // 1. planning → in_progress: 여행 시작일이 오늘이거나 지난 경우
      const toInProgress = await this.prisma.estimate.updateMany({
        where: {
          statusManual: 'planning',
          startDate: { lte: today },
          endDate: { gte: today }, // 아직 여행 중
        },
        data: {
          statusManual: 'in_progress',
        },
      });

      if (toInProgress.count > 0) {
        this.logger.log(
          `${toInProgress.count}개 견적이 '진행중' 상태로 변경됨`,
        );
      }

      // 2. in_progress → completed: 여행 종료일이 지난 경우
      const toCompleted = await this.prisma.estimate.updateMany({
        where: {
          statusManual: 'in_progress',
          endDate: { lt: today }, // 여행 종료
        },
        data: {
          statusManual: 'completed',
          completedAt: new Date(),
        },
      });

      if (toCompleted.count > 0) {
        this.logger.log(`${toCompleted.count}개 견적이 '완료' 상태로 변경됨`);
      }

      this.logger.log('견적 상태 자동 업데이트 완료');
    } catch (error) {
      this.logger.error('견적 상태 업데이트 실패:', error);
    }
  }

  /**
   * 수동 실행용 메서드 (테스트/관리자용)
   */
  async runManualStatusUpdate() {
    return this.handleEstimateStatusUpdate();
  }
}
