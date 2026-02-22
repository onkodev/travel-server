import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { convertDecimalFields } from '../../common/utils/decimal.util';
import {
  calculateSkip,
  createPaginatedResponse,
} from '../../common/dto/pagination.dto';
import { MemoryCache } from '../../common/utils';
import { CACHE_TTL } from '../../common/constants/cache';
import { FAQ_BATCH } from './faq.constants';
import { FaqEmbeddingService } from './faq-embedding.service';

@Injectable()
export class FaqService {
  private readonly logger = new Logger(FaqService.name);
  private cache = new MemoryCache(5 * 60 * 1000);

  constructor(
    private prisma: PrismaService,
    private faqEmbeddingService: FaqEmbeddingService,
  ) {}

  // ============================================================================
  // FAQ CRUD
  // ============================================================================

  async getFaqs(params: {
    page?: number;
    limit?: number;
    status?: string;
    source?: string;
    search?: string;
    category?: string;
  }) {
    const { page = 1, limit = 20, status, source, search, category } = params;
    const skip = calculateSkip(page, limit);

    const where: Prisma.FaqWhereInput = {};

    if (status) where.status = status;
    if (source) where.source = source;
    if (category === '__none') {
      where.category = null;
    } else if (category) {
      where.category = category;
    }

    if (search) {
      where.OR = [
        { question: { contains: search, mode: 'insensitive' } },
        { questionKo: { contains: search, mode: 'insensitive' } },
        { answer: { contains: search, mode: 'insensitive' } },
        { answerKo: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [faqs, total] = await Promise.all([
      this.prisma.faq.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.faq.count({ where }),
    ]);

    return createPaginatedResponse(
      faqs.map(convertDecimalFields),
      total,
      page,
      limit,
    );
  }

  async getFaq(id: number) {
    const faq = await this.prisma.faq.findUnique({ where: { id } });

    if (!faq) {
      throw new NotFoundException('FAQ를 찾을 수 없습니다');
    }

    return convertDecimalFields(faq);
  }

  async createFaq(data: {
    question: string;
    answer: string;
    questionKo?: string;
    answerKo?: string;
    tags?: string[];
    category?: string;
    source?: string;
    sourceEmailId?: string;
    sourceEmailSubject?: string;
    confidence?: number;
    sourceContext?: { questionSource?: string; answerSource?: string };
  }) {
    const faq = await this.prisma.faq.create({
      data: {
        question: data.question,
        answer: data.answer,
        questionKo: data.questionKo || null,
        answerKo: data.answerKo || null,
        tags: data.tags || [],
        category: data.category || null,
        source: data.source || 'manual',
        sourceEmailId: data.sourceEmailId,
        sourceEmailSubject: data.sourceEmailSubject,
        confidence: data.confidence,
        sourceContext: data.sourceContext || undefined,
        status: data.source === 'gmail' ? 'pending' : 'approved',
        approvedAt: data.source === 'gmail' ? undefined : new Date(),
      },
    });

    // manual 소스는 바로 approved → 임베딩 생성 (실패해도 FAQ 생성은 유지)
    if (faq.status === 'approved') {
      try {
        await this.faqEmbeddingService.generateAndSaveEmbedding(
          faq.id,
          faq.question,
          faq.answer,
          faq.questionKo,
          faq.answerKo,
        );
      } catch (error) {
        this.logger.error(`임베딩 생성 실패 (FAQ #${faq.id}):`, error);
      }
    }

    this.cache.clear();
    return faq;
  }

  async updateFaq(id: number, data: Prisma.FaqUpdateInput) {
    const faq = await this.prisma.faq.update({
      where: { id },
      data,
    });

    // approved 상태에서 question/answer/ko 변경 시 임베딩 재생성
    if (
      faq.status === 'approved' &&
      (data.question || data.answer || data.questionKo || data.answerKo)
    ) {
      try {
        await this.faqEmbeddingService.generateAndSaveEmbedding(
          faq.id,
          faq.question,
          faq.answer,
          faq.questionKo,
          faq.answerKo,
        );
      } catch (error) {
        this.logger.error(`임베딩 재생성 실패 (FAQ #${faq.id}):`, error);
      }
    }

    this.cache.clear();
    return faq;
  }

  async deleteFaq(id: number) {
    const result = await this.prisma.faq.delete({ where: { id } });
    this.cache.clear();
    return result;
  }

  async approveFaq(
    id: number,
    userId: string,
    updates?: {
      question?: string;
      answer?: string;
      questionKo?: string;
      answerKo?: string;
    },
  ) {
    const data: Prisma.FaqUpdateInput = {
      status: 'approved',
      approvedAt: new Date(),
      approvedBy: userId,
      rejectionReason: null,
    };

    if (updates?.question) data.question = updates.question;
    if (updates?.answer) data.answer = updates.answer;
    if (updates?.questionKo !== undefined) data.questionKo = updates.questionKo;
    if (updates?.answerKo !== undefined) data.answerKo = updates.answerKo;

    const faq = await this.prisma.faq.update({
      where: { id },
      data,
    });

    // 승인 시 임베딩 생성 (실패해도 승인은 유지)
    try {
      await this.faqEmbeddingService.generateAndSaveEmbedding(
        faq.id,
        faq.question,
        faq.answer,
        faq.questionKo,
        faq.answerKo,
      );
    } catch (error) {
      this.logger.error(`임베딩 생성 실패 (FAQ #${faq.id}):`, error);
    }

    this.cache.clear();
    return faq;
  }

  async rejectFaq(id: number, userId: string, reason?: string) {
    const faq = await this.prisma.faq.update({
      where: { id },
      data: {
        status: 'rejected',
        rejectionReason: reason || null,
        approvedBy: userId,
      },
    });

    // gmail 소스인 경우, 해당 이메일 스레드에서 다른 활성 FAQ가 없으면 rawData 정리
    if (faq.source === 'gmail' && faq.sourceEmailId) {
      await this.faqEmbeddingService.cleanupEmailRawData(faq.sourceEmailId);
    }

    this.cache.clear();
    return faq;
  }

  async bulkAction(
    ids: number[],
    action: 'approve' | 'reject' | 'delete' | 'setCategory',
    userId: string,
    reason?: string,
    category?: string,
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      if (action === 'setCategory') {
        return tx.faq.updateMany({
          where: { id: { in: ids } },
          data: { category: category || null },
        });
      }

      if (action === 'delete') {
        return tx.faq.deleteMany({ where: { id: { in: ids } } });
      }

      if (action === 'approve') {
        const result = await tx.faq.updateMany({
          where: { id: { in: ids } },
          data: {
            status: 'approved',
            approvedAt: new Date(),
            approvedBy: userId,
            rejectionReason: null,
          },
        });

        // 일괄 승인된 FAQ들의 임베딩 생성 (fire-and-forget, 트랜잭션 외부)
        this.faqEmbeddingService.generateBulkEmbeddings(ids).catch((err) =>
          this.logger.error('일괄 임베딩 생성 오류:', err),
        );

        return result;
      }

      const result = await tx.faq.updateMany({
        where: { id: { in: ids } },
        data: {
          status: 'rejected',
          rejectionReason: reason || null,
          approvedBy: userId,
        },
      });

      // 거절된 FAQ들의 이메일 rawData 정리 (트랜잭션 외부, fire-and-forget)
      this.faqEmbeddingService.cleanupBulkEmailRawData(ids).catch((err) =>
        this.logger.error('일괄 rawData 정리 오류:', err),
      );

      return result;
    });

    this.cache.clear();
    return result;
  }

  async getStats() {
    const cacheKey = 'faq:stats';
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const [total, pending, needsReview, approved, rejected, fromGmail, categoryCounts] =
      await Promise.all([
        this.prisma.faq.count(),
        this.prisma.faq.count({ where: { status: 'pending' } }),
        this.prisma.faq.count({ where: { status: 'needs_review' } }),
        this.prisma.faq.count({ where: { status: 'approved' } }),
        this.prisma.faq.count({ where: { status: 'rejected' } }),
        this.prisma.faq.count({ where: { source: 'gmail' } }),
        this.prisma.faq.groupBy({
          by: ['category'],
          _count: true,
        }),
      ]);

    const byCategory: Record<string, number> = {};
    let uncategorized = 0;
    for (const row of categoryCounts) {
      if (row.category) {
        byCategory[row.category] = row._count;
      } else {
        uncategorized = row._count;
      }
    }

    const result = { total, pending, needsReview, approved, rejected, fromGmail, byCategory, uncategorized };
    this.cache.set(cacheKey, result, CACHE_TTL.FAQ_STATS);
    return result;
  }

  // ============================================================================
  // Text-based Duplicate Removal + Low-quality Cleanup
  // ============================================================================

  async removeDuplicates(): Promise<{
    exactDuplicatesDeleted: number;
    lowQualityDeleted: number;
    totalDeleted: number;
    remainingCount: number;
  }> {
    this.logger.log('텍스트 기반 중복 제거 + 저품질 필터링 시작');

    // Phase 1: 저품질 FAQ 삭제
    const lowQuality = await this.prisma.faq.findMany({
      where: {
        status: 'pending',
        OR: [
          { question: { not: { contains: '          ' } } },
        ],
      },
      select: { id: true, question: true, answer: true },
    });

    const lowQualityIds = lowQuality
      .filter(
        (f) =>
          f.question.trim().length < 10 ||
          f.answer.trim().length < 10 ||
          f.question.trim().toLowerCase() === f.answer.trim().toLowerCase(),
      )
      .map((f) => f.id);

    let lowQualityDeleted = 0;
    if (lowQualityIds.length > 0) {
      const result = await this.prisma.faq.deleteMany({
        where: { id: { in: lowQualityIds } },
      });
      lowQualityDeleted = result.count;
      this.logger.log(`저품질 FAQ ${lowQualityDeleted}건 삭제`);
    }

    // Phase 2: question 텍스트 완전 일치 중복 제거
    const duplicateGroups = await this.prisma.$queryRaw<
      Array<{ lower_q: string; cnt: bigint }>
    >`
      SELECT LOWER(TRIM(question)) as lower_q, COUNT(*)::bigint as cnt
      FROM faqs
      WHERE status IN ('pending', 'approved')
      GROUP BY LOWER(TRIM(question))
      HAVING COUNT(*) > 1
    `;

    let exactDuplicatesDeleted = 0;

    if (duplicateGroups.length > 0) {
      for (const group of duplicateGroups) {
        const best = await this.prisma.$queryRaw<Array<{ id: number }>>`
          SELECT id FROM faqs
          WHERE LOWER(TRIM(question)) = ${group.lower_q}
          ORDER BY
            CASE WHEN status = 'approved' THEN 0 ELSE 1 END,
            COALESCE(confidence, 0) DESC,
            id ASC
          LIMIT 1
        `;
        if (best.length === 0) continue;

        const result = await this.prisma.$executeRaw`
          DELETE FROM faqs
          WHERE LOWER(TRIM(question)) = ${group.lower_q}
            AND id != ${best[0].id}
        `;
        exactDuplicatesDeleted += result;
      }

      this.logger.log(
        `텍스트 완전 일치 중복: ${duplicateGroups.length}개 그룹에서 ${exactDuplicatesDeleted}건 삭제`,
      );
    }

    const totalDeleted = lowQualityDeleted + exactDuplicatesDeleted;
    const remainingCount = await this.prisma.faq.count();

    this.cache.clear();

    this.logger.log(
      `중복 제거 완료: 저품질 ${lowQualityDeleted}건 + 중복 ${exactDuplicatesDeleted}건 = 총 ${totalDeleted}건 삭제, 남은 FAQ: ${remainingCount}건`,
    );

    return {
      exactDuplicatesDeleted,
      lowQualityDeleted,
      totalDeleted,
      remainingCount,
    };
  }

  // ============================================================================
  // Duplicate Scan (기존 FAQ 간 중복 탐색 — 임베딩 기반)
  // ============================================================================

  async scanDuplicates(threshold = 0.96): Promise<{
    groups: Array<{
      faqs: Array<{
        id: number;
        question: string;
        questionKo: string | null;
        answer: string;
        answerKo: string | null;
        status: string;
        category: string | null;
      }>;
      maxSimilarity: number;
    }>;
    totalGroups: number;
  }> {
    const embeddedRows = await this.prisma.$queryRawUnsafe<Array<{ id: number }>>(
      `SELECT id FROM faqs
       WHERE status IN ('pending', 'approved') AND embedding IS NOT NULL
       ORDER BY id
       LIMIT 3000`,
    );

    const pairs: Array<{ id1: number; id2: number; similarity: number }> = [];

    for (let i = 0; i < embeddedRows.length; i += FAQ_BATCH.DUPLICATE_SCAN) {
      const batchIds = embeddedRows.slice(i, i + FAQ_BATCH.DUPLICATE_SCAN).map((r) => r.id);
      const batchPairs = await this.prisma.$queryRawUnsafe<
        Array<{ id1: number; id2: number; similarity: number }>
      >(
        `SELECT f1.id as id1, f2.id as id2,
                1 - (f1.embedding <=> f2.embedding) as similarity
         FROM faqs f1
         CROSS JOIN LATERAL (
           SELECT id, embedding
           FROM faqs
           WHERE id > f1.id
             AND status IN ('pending', 'approved')
             AND embedding IS NOT NULL
           ORDER BY embedding <=> f1.embedding
           LIMIT 3
         ) f2
         WHERE f1.id = ANY($1::int[])
           AND 1 - (f1.embedding <=> f2.embedding) >= $2`,
        batchIds,
        threshold,
      );
      pairs.push(...batchPairs);
    }

    if (pairs.length === 0) {
      return { groups: [], totalGroups: 0 };
    }

    // Union-Find로 그룹 클러스터링
    const parent = new Map<number, number>();
    const find = (x: number): number => {
      if (!parent.has(x)) parent.set(x, x);
      if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
      return parent.get(x)!;
    };
    const union = (a: number, b: number) => {
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };

    for (const { id1, id2 } of pairs) {
      union(id1, id2);
    }

    // 그룹별 ID 수집 + 최대 유사도
    const groupMap = new Map<number, Set<number>>();
    const groupSim = new Map<number, number>();
    for (const { id1, id2, similarity } of pairs) {
      const root = find(id1);
      if (!groupMap.has(root)) groupMap.set(root, new Set());
      groupMap.get(root)!.add(id1).add(id2);
      groupSim.set(root, Math.max(groupSim.get(root) || 0, Number(similarity)));
    }

    // FAQ 상세 정보 일괄 조회
    const allIds = [...new Set([...groupMap.values()].flatMap((s) => [...s]))];
    const faqDetails = await this.prisma.faq.findMany({
      where: { id: { in: allIds } },
      select: { id: true, question: true, questionKo: true, answer: true, answerKo: true, status: true, category: true },
    });
    const faqMap = new Map(faqDetails.map((f) => [f.id, f]));

    // 그룹 조립 (유사도 높은 순 정렬)
    const groups = [...groupMap.entries()]
      .map(([root, ids]) => ({
        faqs: [...ids]
          .sort((a, b) => a - b)
          .map((id) => faqMap.get(id))
          .filter(Boolean) as Array<{
            id: number;
            question: string;
            questionKo: string | null;
            answer: string;
            answerKo: string | null;
            status: string;
            category: string | null;
          }>,
        maxSimilarity: groupSim.get(root) || 0,
      }))
      .filter((g) => g.faqs.length >= 2)
      .sort((a, b) => b.maxSimilarity - a.maxSimilarity);

    return { groups, totalGroups: groups.length };
  }
}
