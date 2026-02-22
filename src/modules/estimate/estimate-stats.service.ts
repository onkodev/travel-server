import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ESTIMATE_STATUS } from './dto/estimate.dto';
import { MemoryCache } from '../../common/utils';
import { CACHE_TTL } from '../../common/constants/cache';

@Injectable()
export class EstimateStatsService {
  private statsCache = new MemoryCache(CACHE_TTL.PROFILE);

  constructor(private prisma: PrismaService) {}

  /** 통계 캐시 무효화 (EstimateService에서도 호출) */
  invalidateStatsCache(): void {
    this.statsCache.deleteByPrefix('stats_');
  }

  // 견적 통계
  async getStats() {
    const cached = this.statsCache.get<{ total: number; pending: number; sent: number; completed: number }>('stats_overall');
    if (cached) return cached;

    const [total, pending, sent, completed] = await Promise.all([
      this.prisma.estimate.count(),
      this.prisma.estimate.count({
        where: {
          OR: [
            { statusAi: ESTIMATE_STATUS.PENDING },
            { statusManual: 'planning' },
          ],
        },
      }),
      this.prisma.estimate.count({
        where: { statusAi: ESTIMATE_STATUS.SENT },
      }),
      this.prisma.estimate.count({
        where: {
          OR: [
            { statusAi: ESTIMATE_STATUS.COMPLETED },
            { statusManual: 'completed' },
          ],
        },
      }),
    ]);

    const result = { total, pending, sent, completed };
    this.statsCache.set('stats_overall', result);
    return result;
  }

  // 수동 견적 상태별 통계 (SQL 최적화 버전)
  async getManualStats() {
    const cached = this.statsCache.get<Record<string, unknown>>('stats_manual');
    if (cached) return cached;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const fiveDaysLater = new Date(today);
    fiveDaysLater.setDate(fiveDaysLater.getDate() + 5);

    const [statusCounts, upcomingCount, total] = await Promise.all([
      this.prisma.estimate.groupBy({
        by: ['statusManual'],
        where: { source: 'manual' },
        _count: { id: true },
      }),
      this.prisma.estimate.count({
        where: {
          source: 'manual',
          statusManual: {
            notIn: ['cancelled', 'archived', 'completed', 'in_progress'],
          },
          startDate: { gte: today, lte: fiveDaysLater },
        },
      }),
      this.prisma.estimate.count({
        where: {
          source: 'manual',
          statusManual: { not: 'archived' },
        },
      }),
    ]);

    const stats = {
      planning: 0,
      inProgress: 0,
      completed: 0,
      cancelled: 0,
      archived: 0,
    };
    statusCounts.forEach((item) => {
      const status = item.statusManual as string;
      if (status === 'in_progress') stats.inProgress = item._count.id;
      else if (status === 'completed') stats.completed = item._count.id;
      else if (status === 'cancelled') stats.cancelled = item._count.id;
      else if (status === 'archived') stats.archived = item._count.id;
      else stats.planning += item._count.id;
    });

    const result = {
      total,
      ...stats,
      upcoming: upcomingCount,
    };
    this.statsCache.set('stats_manual', result);
    return result;
  }

  // AI 견적 상태별 통계 (SQL 최적화 버전)
  async getAIStats() {
    const cached = this.statsCache.get<Record<string, unknown>>('stats_ai');
    if (cached) return cached;

    const [statusCounts, total] = await Promise.all([
      this.prisma.estimate.groupBy({
        by: ['statusAi'],
        where: { source: 'ai' },
        _count: { id: true },
      }),
      this.prisma.estimate.count({
        where: {
          source: 'ai',
          statusAi: { not: ESTIMATE_STATUS.CANCELLED },
        },
      }),
    ]);

    const stats = {
      draft: 0,
      pending: 0,
      sent: 0,
      approved: 0,
      completed: 0,
      cancelled: 0,
    };
    statusCounts.forEach((item) => {
      const status = item.statusAi as keyof typeof stats;
      if (status && stats[status] !== undefined) {
        stats[status] = item._count.id;
      }
    });

    const result = { total, ...stats };
    this.statsCache.set('stats_ai', result);
    return result;
  }
}
