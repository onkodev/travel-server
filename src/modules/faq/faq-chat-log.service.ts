import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { convertDecimalFields } from '../../common/utils/decimal.util';
import {
  calculateSkip,
  createPaginatedResponse,
} from '../../common/dto/pagination.dto';
import { MemoryCache } from '../../common/utils';
import { CACHE_TTL } from '../../common/constants/cache';

@Injectable()
export class FaqChatLogService {
  private readonly logger = new Logger(FaqChatLogService.name);
  private cache = new MemoryCache(5 * 60 * 1000);

  constructor(private prisma: PrismaService) {}

  // ============================================================================
  // FAQ Chat Logs & Stats
  // ============================================================================

  async getFaqChatLogs(params: {
    page?: number;
    limit?: number;
    noMatch?: boolean;
    startDate?: string;
    endDate?: string;
    search?: string;
    responseTier?: string;
    visitorId?: string;
  }) {
    const {
      page = 1,
      limit = 20,
      noMatch,
      startDate,
      endDate,
      search,
      responseTier,
      visitorId,
    } = params;
    const skip = calculateSkip(page, limit);

    const where: Prisma.FaqChatLogWhereInput = {};

    if (noMatch !== undefined) {
      where.noMatch = noMatch;
    }

    if (search) {
      where.message = { contains: search, mode: 'insensitive' };
    }

    if (responseTier) {
      where.responseTier = responseTier;
    }

    if (visitorId) {
      where.visitorId = visitorId;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    const [logs, total] = await Promise.all([
      this.prisma.faqChatLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          visitor: {
            select: { ipAddress: true, country: true, countryName: true, city: true },
          },
        },
      }),
      this.prisma.faqChatLog.count({ where }),
    ]);

    // 매칭된 FAQ 질문 텍스트 조회
    const allFaqIds = [...new Set(logs.flatMap((l) => l.matchedFaqIds))];
    const faqs =
      allFaqIds.length > 0
        ? await this.prisma.faq.findMany({
            where: { id: { in: allFaqIds } },
            select: { id: true, question: true },
          })
        : [];
    const faqMap = new Map(faqs.map((f) => [f.id, f.question]));

    const enriched = logs.map(({ visitor, ...log }) => ({
      ...convertDecimalFields(log),
      ipAddress: visitor?.ipAddress ?? null,
      country: visitor?.country ?? null,
      countryName: visitor?.countryName ?? null,
      city: visitor?.city ?? null,
      responseTier: log.responseTier ?? null,
      matchedFaqs: log.matchedFaqIds.map((id, idx) => ({
        id,
        question: faqMap.get(id) || null,
        similarity: log.matchedSimilarities[idx] ?? null,
      })),
    }));

    return createPaginatedResponse(enriched, total, page, limit);
  }

  async getFaqChatStats() {
    const cacheKey = 'faq:chatStats';
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [counts, dailyTrend, topQuestions, unansweredQuestions] =
      await Promise.all([
        this.prisma.$queryRaw<
          Array<{
            total: bigint;
            today: bigint;
            no_match: bigint;
            direct: bigint;
            rag: bigint;
            general: bigint;
          }>
        >`
        SELECT
          COUNT(*)::bigint as total,
          COUNT(*) FILTER (WHERE created_at >= ${todayStart})::bigint as today,
          COUNT(*) FILTER (WHERE no_match = true)::bigint as no_match,
          COUNT(*) FILTER (WHERE response_tier = 'direct')::bigint as direct,
          COUNT(*) FILTER (WHERE response_tier = 'rag')::bigint as rag,
          COUNT(*) FILTER (WHERE response_tier = 'general')::bigint as general
        FROM faq_chat_logs
      `,
        this.prisma.$queryRaw<Array<{ date: Date; count: bigint }>>`
        SELECT DATE(created_at AT TIME ZONE 'UTC') as date, COUNT(*)::bigint as count
        FROM faq_chat_logs
        WHERE created_at >= ${thirtyDaysAgo}
        GROUP BY DATE(created_at AT TIME ZONE 'UTC')
        ORDER BY date ASC
      `,
        this.prisma.$queryRaw<
          Array<{
            message: string;
            count: bigint;
            response_tier: string | null;
          }>
        >`
        SELECT message, COUNT(*)::bigint as count, response_tier
        FROM faq_chat_logs
        GROUP BY message, response_tier
        ORDER BY count DESC
        LIMIT 10
      `,
        this.prisma.$queryRaw<Array<{ message: string; count: bigint }>>`
        SELECT message, COUNT(*)::bigint as count
        FROM faq_chat_logs
        WHERE no_match = true
        GROUP BY message
        ORDER BY count DESC
        LIMIT 10
      `,
      ]);

    const stats = counts[0] || {
      total: 0n,
      today: 0n,
      no_match: 0n,
      direct: 0n,
      rag: 0n,
      general: 0n,
    };
    const totalChats = Number(stats.total);
    const noMatchCount = Number(stats.no_match);

    const result = {
      totalChats,
      todayChats: Number(stats.today),
      noMatchCount,
      noMatchRate:
        totalChats > 0 ? ((noMatchCount / totalChats) * 100).toFixed(1) : '0.0',
      responseTierBreakdown: {
        direct: Number(stats.direct),
        rag: Number(stats.rag),
        general: Number(stats.general),
        noMatch: noMatchCount,
      },
      dailyTrend: dailyTrend.map((d) => ({
        date: d.date,
        count: Number(d.count),
      })),
      topQuestions: topQuestions.map((q) => ({
        question: q.message,
        count: Number(q.count),
        responseTier: q.response_tier,
      })),
      unansweredQuestions: unansweredQuestions.map((q) => ({
        question: q.message,
        count: Number(q.count),
      })),
    };

    this.cache.set(cacheKey, result, CACHE_TTL.FAQ_CHAT_STATS);
    return result;
  }
}
