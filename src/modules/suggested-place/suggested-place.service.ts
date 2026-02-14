import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import {
  calculateSkip,
  createPaginatedResponse,
} from '../../common/dto/pagination.dto';
import { TourApiService } from '../ai/tour-api.service';

interface MatchLogEntry {
  timestamp: string;
  action: 'created' | 'fuzzy_computed' | 'approved' | 'tour_api_added' | 'manual_added' | 'ignored' | 'status_changed';
  detail: string;
  estimateId?: number;
  matchScore?: number;
  itemId?: number;
}

interface MatchCandidate {
  itemId: number;
  nameEng: string;
  nameKor: string;
  similarity: number;
  region?: string;
}

/** Prisma Json 필드에 안전하게 할당하기 위한 헬퍼 */
function toJson(value: unknown): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

@Injectable()
export class SuggestedPlaceService {
  private readonly logger = new Logger(SuggestedPlaceService.name);

  constructor(
    private prisma: PrismaService,
    private tourApiService: TourApiService,
  ) {}

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async findPlaceOrThrow(id: number) {
    const place = await this.prisma.suggestedPlace.findUnique({ where: { id } });
    if (!place) throw new NotFoundException('Suggested place not found');
    return place;
  }

  private appendMatchLog(existingLog: unknown, entry: MatchLogEntry): MatchLogEntry[] {
    const log = Array.isArray(existingLog) ? (existingLog as MatchLogEntry[]) : [];
    return [...log, entry];
  }

  private logEntry(
    action: MatchLogEntry['action'],
    detail: string,
    extra?: Partial<Pick<MatchLogEntry, 'estimateId' | 'matchScore' | 'itemId'>>,
  ): MatchLogEntry {
    return { timestamp: new Date().toISOString(), action, detail, ...extra };
  }

  // ---------------------------------------------------------------------------
  // 목록 / 통계
  // ---------------------------------------------------------------------------

  async getList(params: {
    page?: number;
    limit?: number;
    status?: string;
    region?: string;
    search?: string;
    sortBy?: string;
    sortDir?: string;
  }) {
    const { page = 1, limit = 20, status, region, search, sortBy = 'count', sortDir = 'desc' } = params;
    const skip = calculateSkip(page, limit);
    const dir = sortDir === 'asc' ? 'asc' : 'desc';

    const where: Prisma.SuggestedPlaceWhereInput = {};
    if (status) where.status = status;
    if (region) where.region = region;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { nameKor: { contains: search } },
      ];
    }

    const sortMap: Record<string, Prisma.SuggestedPlaceOrderByWithRelationInput> = {
      count: { count: dir },
      lastSeenAt: { lastSeenAt: dir },
      bestMatchScore: { bestMatchScore: dir },
    };
    const orderBy = sortMap[sortBy ?? ''] ?? { createdAt: dir };

    const [data, total] = await Promise.all([
      this.prisma.suggestedPlace.findMany({ where, orderBy, skip, take: limit }),
      this.prisma.suggestedPlace.count({ where }),
    ]);

    return createPaginatedResponse(data, total, page, limit);
  }

  async getStats() {
    const [total, pending, added, ignored, byRegion] = await Promise.all([
      this.prisma.suggestedPlace.count(),
      this.prisma.suggestedPlace.count({ where: { status: 'pending' } }),
      this.prisma.suggestedPlace.count({ where: { status: 'added' } }),
      this.prisma.suggestedPlace.count({ where: { status: 'ignored' } }),
      this.prisma.suggestedPlace.groupBy({
        by: ['region'],
        _count: true,
        where: { status: 'pending' },
        orderBy: { _count: { id: 'desc' } },
        take: 10,
      }),
    ]);

    return {
      total,
      pending,
      added,
      ignored,
      byRegion: byRegion.map((r) => ({ region: r.region || 'unknown', count: r._count })),
    };
  }

  async getEnhancedStats(days = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const [basicStats, weeklyTrend, regionDistribution, topRecurring, resolveMethodCounts, sourceCounts] =
      await Promise.all([
        this.getStats(),
        this.prisma.$queryRaw<Array<{ week: string; count: bigint }>>`
          SELECT date_trunc('week', created_at)::text AS week, COUNT(*) AS count
          FROM suggested_places
          WHERE created_at >= ${since}
          GROUP BY week ORDER BY week
        `,
        this.prisma.suggestedPlace.groupBy({
          by: ['region'],
          _count: true,
          orderBy: { _count: { id: 'desc' } },
          take: 15,
        }),
        this.prisma.suggestedPlace.findMany({
          where: { status: 'pending' },
          orderBy: { count: 'desc' },
          take: 10,
          select: { id: true, name: true, nameKor: true, count: true, region: true },
        }),
        this.prisma.suggestedPlace.groupBy({ by: ['resolveMethod'], _count: true, where: { status: 'added' } }),
        this.prisma.suggestedPlace.groupBy({ by: ['source'], _count: true }),
      ]);

    const total = basicStats.total || 1;

    return {
      ...basicStats,
      matchRate: Math.round((basicStats.added / total) * 100),
      weeklyTrend: weeklyTrend.map((w) => ({ week: w.week, count: Number(w.count) })),
      regionDistribution: regionDistribution.map((r) => ({ region: r.region || 'unknown', count: r._count })),
      topRecurring,
      matchQuality: resolveMethodCounts.map((r) => ({ method: r.resolveMethod || 'unknown', count: r._count })),
      sourceBreakdown: sourceCounts.map((s) => ({ source: s.source, count: s._count })),
    };
  }

  // ---------------------------------------------------------------------------
  // 상태 변경
  // ---------------------------------------------------------------------------

  async updateStatus(id: number, data: { status: string; linkedItemId?: number }) {
    const place = await this.findPlaceOrThrow(id);

    const matchLog = this.appendMatchLog(
      place.matchLog,
      this.logEntry('status_changed', `상태 변경: ${place.status} → ${data.status}`),
    );

    return this.prisma.suggestedPlace.update({
      where: { id },
      data: {
        status: data.status,
        linkedItemId: data.linkedItemId ?? place.linkedItemId,
        matchLog: toJson(matchLog),
      },
    });
  }

  async bulkUpdateStatus(ids: number[], status: string) {
    return this.prisma.suggestedPlace.updateMany({
      where: { id: { in: ids } },
      data: { status },
    });
  }

  // ---------------------------------------------------------------------------
  // TBD 스캔 / Upsert
  // ---------------------------------------------------------------------------

  async upsertFromTbdItem(params: {
    name: string;
    nameKor?: string;
    region?: string;
    estimateId: number;
    note?: string;
  }) {
    const existing = await this.prisma.suggestedPlace.findUnique({ where: { name: params.name } });

    if (existing) {
      return this.prisma.suggestedPlace.update({
        where: { name: params.name },
        data: {
          count: { increment: 1 },
          estimateIds: { push: params.estimateId },
          lastSeenAt: new Date(),
          nameKor: params.nameKor || existing.nameKor,
          region: params.region || existing.region,
          sampleNote: params.note || existing.sampleNote,
        },
      });
    }

    const matchLog = this.appendMatchLog(
      [],
      this.logEntry('created', `견적 #${params.estimateId}에서 TBD로 생성`, { estimateId: params.estimateId }),
    );

    const place = await this.prisma.suggestedPlace.create({
      data: {
        name: params.name,
        nameKor: params.nameKor,
        region: params.region,
        estimateIds: [params.estimateId],
        sampleNote: params.note,
        matchLog: toJson(matchLog),
      },
    });

    this.computeAndStoreMatches(place.id).catch((e) =>
      this.logger.warn(`[computeAndStoreMatches] placeId=${place.id}: ${String(e)}`),
    );

    return place;
  }

  async scanEstimates() {
    const estimates = await this.prisma.estimate.findMany({
      where: { source: 'ai' },
      select: { id: true, items: true, regions: true },
    });

    let upsertCount = 0;

    for (const est of estimates) {
      const items = est.items as unknown as Array<{
        isTbd?: boolean;
        itemName?: string;
        name?: string;
        nameEng?: string;
        note?: string;
      }>;
      if (!Array.isArray(items)) continue;

      const region = est.regions?.[0] ?? undefined;

      for (const item of items.filter((i) => i.isTbd)) {
        const name = item.itemName || item.name || item.nameEng;
        if (!name) continue;
        await this.upsertFromTbdItem({ name, region, estimateId: est.id, note: item.note });
        upsertCount++;
      }
    }

    return { scannedEstimates: estimates.length, upsertedPlaces: upsertCount };
  }

  // ---------------------------------------------------------------------------
  // Item 추가 (수동 / Tour API)
  // ---------------------------------------------------------------------------

  async addToItems(id: number, data: {
    type: string;
    nameEng: string;
    nameKor: string;
    region?: string;
    description?: string;
  }) {
    const place = await this.findPlaceOrThrow(id);

    const item = await this.prisma.item.create({
      data: {
        type: data.type || 'place',
        nameEng: data.nameEng,
        nameKor: data.nameKor,
        region: data.region || place.region,
        description: data.description || '',
      },
    });

    const matchLog = this.appendMatchLog(
      place.matchLog,
      this.logEntry('manual_added', `수동 Item 추가 (Item #${item.id})`, { itemId: item.id }),
    );

    await this.prisma.suggestedPlace.update({
      where: { id },
      data: { status: 'added', linkedItemId: item.id, resolveMethod: 'manual_add', matchLog: toJson(matchLog) },
    });

    return { item, suggestedPlace: { ...place, status: 'added', linkedItemId: item.id, resolveMethod: 'manual_add' } };
  }

  async addFromTourApi(placeId: number, contentId: string, itemData: Record<string, unknown>) {
    const place = await this.findPlaceOrThrow(placeId);

    const result = await this.tourApiService.addItem(contentId, itemData as never);
    const itemId = result.item.id;

    const matchLog = this.appendMatchLog(
      place.matchLog,
      this.logEntry('tour_api_added', `Tour API에서 추가 (contentId: ${contentId}, Item #${itemId})`, { itemId }),
    );

    await this.prisma.suggestedPlace.update({
      where: { id: placeId },
      data: { status: 'added', linkedItemId: itemId, resolveMethod: 'tour_api', matchLog: toJson(matchLog) },
    });

    return { item: result.item, suggestedPlace: { ...place, status: 'added', linkedItemId: itemId, resolveMethod: 'tour_api' } };
  }

  async delete(id: number) {
    await this.findPlaceOrThrow(id);
    return this.prisma.suggestedPlace.delete({ where: { id } });
  }

  // ---------------------------------------------------------------------------
  // 퍼지 매칭
  // ---------------------------------------------------------------------------

  async findFuzzyMatches(name: string, region?: string, limit = 5): Promise<MatchCandidate[]> {
    const threshold = 0.2;

    const results = await this.prisma.$queryRaw<
      Array<{ id: number; name_eng: string; name_kor: string; region: string | null; sim: number }>
    >`
      SELECT id, name_eng, name_kor, region,
        GREATEST(similarity(name_eng, ${name}), similarity(name_kor, ${name})) AS sim
      FROM items
      WHERE GREATEST(similarity(name_eng, ${name}), similarity(name_kor, ${name})) > ${threshold}
      ${region ? Prisma.sql`AND (region = ${region} OR region IS NULL)` : Prisma.empty}
      ORDER BY sim DESC
      LIMIT ${limit}
    `;

    return results.map((r) => ({
      itemId: r.id,
      nameEng: r.name_eng,
      nameKor: r.name_kor,
      similarity: Math.round(r.sim * 100) / 100,
      region: r.region || undefined,
    }));
  }

  async computeAndStoreMatches(placeId: number) {
    const place = await this.findPlaceOrThrow(placeId);

    const candidates = await this.findFuzzyMatches(place.name, place.region || undefined);
    const bestScore = candidates[0]?.similarity ?? 0;

    const matchLog = this.appendMatchLog(
      place.matchLog,
      this.logEntry('fuzzy_computed', `pg_trgm으로 ${candidates.length}개 후보 발견, 최고 ${bestScore}`, { matchScore: bestScore }),
    );

    await this.prisma.suggestedPlace.update({
      where: { id: placeId },
      data: {
        matchCandidates: toJson(candidates),
        bestMatchScore: bestScore,
        matchLog: toJson(matchLog),
      },
    });

    return { candidates, bestScore };
  }

  async scanAndComputeAllMatches() {
    const places = await this.prisma.suggestedPlace.findMany({
      where: { status: 'pending' },
      select: { id: true },
    });

    let computed = 0;
    for (const place of places) {
      try {
        await this.computeAndStoreMatches(place.id);
        computed++;
      } catch (e) {
        this.logger.warn(`[scanAndComputeAllMatches] placeId=${place.id}: ${String(e)}`);
      }
    }

    return { total: places.length, computed };
  }

  async approveMatch(placeId: number, itemId: number) {
    const place = await this.findPlaceOrThrow(placeId);

    const candidates = Array.isArray(place.matchCandidates)
      ? (place.matchCandidates as unknown as MatchCandidate[])
      : [];
    const score = candidates.find((c) => c.itemId === itemId)?.similarity ?? 0;

    const matchLog = this.appendMatchLog(
      place.matchLog,
      this.logEntry('approved', `매칭 승인 (Item #${itemId}, 유사도 ${score})`, { matchScore: score, itemId }),
    );

    return this.prisma.suggestedPlace.update({
      where: { id: placeId },
      data: { status: 'added', linkedItemId: itemId, resolveMethod: 'auto_matched', matchLog: toJson(matchLog) },
    });
  }

  async searchTourApiForPlace(placeId: number) {
    const place = await this.findPlaceOrThrow(placeId);
    return this.tourApiService.searchWithExistence(place.nameKor || place.name);
  }
}
