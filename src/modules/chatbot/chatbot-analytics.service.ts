import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 챗봇 분석/통계 서비스
 */
@Injectable()
export class ChatbotAnalyticsService {
  constructor(private prisma: PrismaService) {}

  /**
   * 플로우 통계 (관리자용)
   */
  async getFlowStats() {
    const [
      total,
      // 견적 상태별 통계 (AI 견적 기준)
      pending,
      sent,
      approved,
      completed,
    ] = await Promise.all([
      this.prisma.chatbotFlow.count(),
      this.prisma.estimate.count({
        where: { source: 'ai', statusAi: 'pending' },
      }),
      this.prisma.estimate.count({ where: { source: 'ai', statusAi: 'sent' } }),
      this.prisma.estimate.count({
        where: { source: 'ai', statusAi: 'approved' },
      }),
      this.prisma.estimate.count({
        where: { source: 'ai', statusAi: 'completed' },
      }),
    ]);

    const successCount = approved + completed;
    const totalProcessed = sent + approved + completed;
    const approvalRate =
      totalProcessed > 0
        ? ((successCount / totalProcessed) * 100).toFixed(1)
        : '0';

    return {
      total, // 전체 상담
      pending, // 검토 대기
      sent, // 고객 대기
      success: successCount, // 승인 완료 (approved + completed)
      approvalRate: `${approvalRate}%`, // 승인율
    };
  }

}
