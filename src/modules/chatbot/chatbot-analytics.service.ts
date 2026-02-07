import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 챗봇 분석/통계 서비스
 * - 플로우 통계, 퍼널 분석, 리드 스코어, 국가별 통계
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

  /**
   * 퍼널 분석 (관리자용)
   */
  async getFunnelAnalysis(days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // 각 단계별 도달 수 (해당 단계 이상까지 진행한 사용자 수)
    const [
      step1, // 시작 (모든 플로우)
      step2, // 투어 타입 선택 완료
      step3, // 첫 방문 여부 응답
      step4, // 관심사 선택 완료
      step5, // 지역 선택 완료
      step6, // 명소 선택 완료
      step7, // 여행 정보 입력 완료
      completed, // 견적 생성 완료
      estimateSent, // 전문가에게 발송
      estimateAccepted, // 고객 수락
    ] = await Promise.all([
      this.prisma.chatbotFlow.count({
        where: { createdAt: { gte: startDate } },
      }),
      this.prisma.chatbotFlow.count({
        where: { createdAt: { gte: startDate }, currentStep: { gte: 2 } },
      }),
      this.prisma.chatbotFlow.count({
        where: { createdAt: { gte: startDate }, currentStep: { gte: 3 } },
      }),
      this.prisma.chatbotFlow.count({
        where: { createdAt: { gte: startDate }, currentStep: { gte: 4 } },
      }),
      this.prisma.chatbotFlow.count({
        where: { createdAt: { gte: startDate }, currentStep: { gte: 5 } },
      }),
      this.prisma.chatbotFlow.count({
        where: { createdAt: { gte: startDate }, currentStep: { gte: 6 } },
      }),
      this.prisma.chatbotFlow.count({
        where: { createdAt: { gte: startDate }, currentStep: { gte: 7 } },
      }),
      this.prisma.chatbotFlow.count({
        where: { createdAt: { gte: startDate }, isCompleted: true },
      }),
      this.prisma.estimate.count({
        where: {
          createdAt: { gte: startDate },
          statusAi: { in: ['sent', 'approved'] },
        },
      }),
      this.prisma.estimate.count({
        where: {
          createdAt: { gte: startDate },
          statusAi: 'approved',
        },
      }),
    ]);

    const funnel = [
      { step: 1, name: '챗봇 시작', count: step1, rate: 100 },
      {
        step: 2,
        name: '투어 타입 선택',
        count: step2,
        rate: step1 > 0 ? Math.round((step2 / step1) * 100) : 0,
      },
      {
        step: 3,
        name: '첫 방문 여부',
        count: step3,
        rate: step1 > 0 ? Math.round((step3 / step1) * 100) : 0,
      },
      {
        step: 4,
        name: '관심사 선택',
        count: step4,
        rate: step1 > 0 ? Math.round((step4 / step1) * 100) : 0,
      },
      {
        step: 5,
        name: '지역 선택',
        count: step5,
        rate: step1 > 0 ? Math.round((step5 / step1) * 100) : 0,
      },
      {
        step: 6,
        name: '명소 선택',
        count: step6,
        rate: step1 > 0 ? Math.round((step6 / step1) * 100) : 0,
      },
      {
        step: 7,
        name: '여행 정보 입력',
        count: step7,
        rate: step1 > 0 ? Math.round((step7 / step1) * 100) : 0,
      },
      {
        step: 8,
        name: '견적 생성',
        count: completed,
        rate: step1 > 0 ? Math.round((completed / step1) * 100) : 0,
      },
      {
        step: 9,
        name: '전문가 발송',
        count: estimateSent,
        rate: step1 > 0 ? Math.round((estimateSent / step1) * 100) : 0,
      },
      {
        step: 10,
        name: '고객 수락',
        count: estimateAccepted,
        rate: step1 > 0 ? Math.round((estimateAccepted / step1) * 100) : 0,
      },
    ];

    // 이탈률 계산 (다음 단계로 넘어가지 않은 비율)
    const dropoff = funnel.slice(0, -1).map((item, idx) => {
      const nextCount = funnel[idx + 1].count;
      const dropoffCount = item.count - nextCount;
      const dropoffRate =
        item.count > 0 ? Math.round((dropoffCount / item.count) * 100) : 0;
      return {
        step: item.step,
        name: item.name,
        dropoffCount,
        dropoffRate,
      };
    });

    // 가장 이탈이 많은 단계 (상위 3개)
    const worstDropoff = [...dropoff]
      .sort((a, b) => b.dropoffRate - a.dropoffRate)
      .slice(0, 3);

    return {
      period: `${days}일`,
      funnel,
      dropoff,
      worstDropoff,
      summary: {
        totalStarted: step1,
        totalCompleted: completed,
        overallConversion:
          step1 > 0 ? `${Math.round((completed / step1) * 100)}%` : '0%',
        acceptanceRate:
          estimateSent > 0
            ? `${Math.round((estimateAccepted / estimateSent) * 100)}%`
            : '0%',
      },
    };
  }

  /**
   * 리드 스코어 계산 (관리자용)
   */
  async getLeadScores(limit = 50) {
    // 최근 미완료 플로우 중 가장 유망한 리드
    const flows = await this.prisma.chatbotFlow.findMany({
      where: {
        isCompleted: false,
        currentStep: { gte: 3 }, // 최소 3단계 이상 진행
      },
      orderBy: { updatedAt: 'desc' },
      take: limit * 2, // 필터링 후 limit 적용
      select: {
        id: true,
        sessionId: true,
        currentStep: true,
        tourType: true,
        travelDate: true,
        adultsCount: true,
        childrenCount: true,
        budgetRange: true,
        customerName: true,
        customerEmail: true,
        country: true,
        countryName: true,
        city: true,
        utmSource: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // 리드 스코어 계산
    const scoredLeads = flows.map((flow) => {
      let score = 0;
      const factors: string[] = [];

      // 진행 단계 점수 (최대 35점)
      score += flow.currentStep * 5;
      factors.push(
        `진행도: Step ${flow.currentStep} (+${flow.currentStep * 5})`,
      );

      // 여행 날짜가 가까우면 가산점 (최대 20점)
      if (flow.travelDate) {
        const daysUntilTravel = Math.ceil(
          (new Date(flow.travelDate).getTime() - Date.now()) /
            (1000 * 60 * 60 * 24),
        );
        if (daysUntilTravel > 0 && daysUntilTravel <= 30) {
          const dateScore = Math.max(0, 20 - Math.floor(daysUntilTravel / 2));
          score += dateScore;
          factors.push(`여행일 임박 (${daysUntilTravel}일 후): +${dateScore}`);
        } else if (daysUntilTravel > 30 && daysUntilTravel <= 90) {
          score += 10;
          factors.push(`여행일 설정됨: +10`);
        }
      }

      // 인원수 점수 (최대 15점)
      const totalPeople = (flow.adultsCount || 0) + (flow.childrenCount || 0);
      if (totalPeople >= 4) {
        score += 15;
        factors.push(`단체 여행 (${totalPeople}명): +15`);
      } else if (totalPeople >= 2) {
        score += 10;
        factors.push(`${totalPeople}인 여행: +10`);
      }

      // 예산 범위 점수 (최대 15점)
      if (flow.budgetRange) {
        const budgetMap: Record<string, number> = {
          '50-100': 5,
          '100-200': 10,
          '200-300': 12,
          '300+': 15,
        };
        const budgetScore = budgetMap[flow.budgetRange] || 5;
        score += budgetScore;
        factors.push(`예산 ${flow.budgetRange}: +${budgetScore}`);
      }

      // 연락처 제공 여부 (최대 15점)
      if (flow.customerEmail) {
        score += 10;
        factors.push(`이메일 제공: +10`);
      }
      if (flow.customerName) {
        score += 5;
        factors.push(`이름 제공: +5`);
      }

      // 최근 활동 보너스 (최대 10점)
      const hoursSinceUpdate =
        (Date.now() - new Date(flow.updatedAt).getTime()) / (1000 * 60 * 60);
      if (hoursSinceUpdate < 1) {
        score += 10;
        factors.push(`방금 활동: +10`);
      } else if (hoursSinceUpdate < 24) {
        score += 5;
        factors.push(`24시간 내 활동: +5`);
      }

      return {
        ...flow,
        score,
        factors,
        grade: score >= 70 ? 'HOT' : score >= 50 ? 'WARM' : 'COLD',
      };
    });

    // 점수순 정렬 후 limit 적용
    const topLeads = scoredLeads
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const summary = {
      hot: topLeads.filter((l) => l.grade === 'HOT').length,
      warm: topLeads.filter((l) => l.grade === 'WARM').length,
      cold: topLeads.filter((l) => l.grade === 'COLD').length,
    };

    return {
      leads: topLeads,
      summary,
    };
  }

  /**
   * 국가별 통계 (관리자용)
   * 단일 Raw SQL로 최적화
   */
  async getCountryStats(days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // 단일 Raw SQL로 국가별 총 건수와 완료 건수를 한번에 조회
    const countryStats = await this.prisma.$queryRaw<
      Array<{
        country: string;
        country_name: string | null;
        total_count: bigint;
        completed_count: bigint;
      }>
    >`
      SELECT
        country,
        country_name,
        COUNT(*) as total_count,
        COUNT(CASE WHEN is_completed = true THEN 1 END) as completed_count
      FROM chatbot_flows
      WHERE created_at >= ${startDate}
        AND country IS NOT NULL
      GROUP BY country, country_name
      ORDER BY COUNT(*) DESC
      LIMIT 20
    `;

    const data = countryStats.map((item) => {
      const total = Number(item.total_count);
      const completed = Number(item.completed_count);
      return {
        country: item.country,
        countryName: item.country_name,
        count: total,
        completed,
        conversionRate:
          total > 0 ? `${Math.round((completed / total) * 100)}%` : '0%',
      };
    });

    return {
      period: `${days}일`,
      data,
    };
  }
}
