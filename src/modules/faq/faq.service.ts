import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { convertDecimalFields } from '../../common/utils/decimal.util';
import {
  calculateSkip,
  createPaginatedResponse,
} from '../../common/dto/pagination.dto';
import { EmbeddingService } from '../ai/core/embedding.service';
import { GeminiCoreService } from '../ai/core/gemini-core.service';
import { GeoIpService } from '../geoip/geoip.service';
import { MemoryCache } from '../../common/utils';

@Injectable()
export class FaqService {
  private readonly logger = new Logger(FaqService.name);
  private cache = new MemoryCache(5 * 60 * 1000); // 5분 캐시

  constructor(
    private prisma: PrismaService,
    private embeddingService: EmbeddingService,
    private geminiCore: GeminiCoreService,
    private geoIpService: GeoIpService,
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
        { answer: { contains: search, mode: 'insensitive' } },
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
        await this.generateAndSaveEmbedding(
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

    // approved 상태에서 question/answer/ko 변경 시 임베딩 재생성 (실패해도 업데이트는 유지)
    if (
      faq.status === 'approved' &&
      (data.question || data.answer || data.questionKo || data.answerKo)
    ) {
      try {
        await this.generateAndSaveEmbedding(
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
      await this.generateAndSaveEmbedding(
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
      await this.cleanupEmailRawData(faq.sourceEmailId);
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
        this.generateBulkEmbeddings(ids).catch((err) =>
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
      this.cleanupBulkEmailRawData(ids).catch((err) =>
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

    const [total, pending, approved, rejected, fromGmail, categoryCounts] =
      await Promise.all([
        this.prisma.faq.count(),
        this.prisma.faq.count({ where: { status: 'pending' } }),
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

    const result = { total, pending, approved, rejected, fromGmail, byCategory, uncategorized };
    this.cache.set(cacheKey, result, 60 * 1000);
    return result;
  }

  // ============================================================================
  // Email rawData Cleanup
  // ============================================================================

  /**
   * 해당 이메일 스레드에서 pending/approved FAQ가 없으면 rawData 비우기
   */
  private async cleanupEmailRawData(sourceEmailId: string): Promise<void> {
    const activeFaqCount = await this.prisma.faq.count({
      where: {
        sourceEmailId,
        status: { in: ['pending', 'approved'] },
      },
    });

    if (activeFaqCount === 0) {
      await this.prisma.emailThread.updateMany({
        where: { gmailThreadId: sourceEmailId },
        data: { rawData: Prisma.DbNull },
      });
    }
  }

  /**
   * 일괄 거절 시 관련 이메일 스레드의 rawData 정리
   */
  private async cleanupBulkEmailRawData(faqIds: number[]): Promise<void> {
    const gmailFaqs = await this.prisma.faq.findMany({
      where: {
        id: { in: faqIds },
        source: 'gmail',
        sourceEmailId: { not: null },
      },
      select: { sourceEmailId: true },
    });

    const uniqueEmailIds = [...new Set(gmailFaqs.map((f) => f.sourceEmailId!))];

    for (const emailId of uniqueEmailIds) {
      await this.cleanupEmailRawData(emailId);
    }
  }

  // ============================================================================
  // Embedding
  // ============================================================================

  private async generateAndSaveEmbedding(
    faqId: number,
    question: string,
    answer: string,
    questionKo?: string | null,
    answerKo?: string | null,
  ): Promise<void> {
    try {
      const text = this.embeddingService.buildFaqText(
        question,
        answer,
        questionKo,
        answerKo,
      );
      const embedding = await this.embeddingService.generateEmbedding(text);

      if (!embedding) {
        this.logger.warn(`FAQ #${faqId} 임베딩 생성 실패 (null 반환)`);
        return;
      }

      await this.prisma.$executeRawUnsafe(
        `UPDATE faqs SET embedding = $1::vector WHERE id = $2`,
        `[${embedding.join(',')}]`,
        faqId,
      );
    } catch (error) {
      this.logger.error(`FAQ #${faqId} 임베딩 저장 실패:`, error);
    }
  }

  private async generateBulkEmbeddings(ids: number[]): Promise<void> {
    const faqs = await this.prisma.faq.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        question: true,
        answer: true,
        questionKo: true,
        answerKo: true,
      },
    });

    const { failed } = await this.processEmbeddingBatch(faqs);

    if (failed > 0) {
      this.logger.warn(`일괄 임베딩: ${faqs.length}건 중 ${failed}건 실패`);
    } else {
      this.logger.log(`일괄 임베딩: ${faqs.length}건 완료`);
    }
  }

  async regenerateAllEmbeddings(): Promise<{
    total: number;
    success: number;
    failed: number;
  }> {
    const BATCH_SIZE = 100;
    let success = 0;
    let failed = 0;
    let offset = 0;
    let total = 0;

    // 배치 단위로 처리 (OOM 방지)
    while (true) {
      const faqs = await this.prisma.faq.findMany({
        where: { status: 'approved' },
        select: {
          id: true,
          question: true,
          answer: true,
          questionKo: true,
          answerKo: true,
        },
        skip: offset,
        take: BATCH_SIZE,
        orderBy: { id: 'asc' },
      });

      if (faqs.length === 0) break;

      total += faqs.length;
      const result = await this.processEmbeddingBatch(faqs);
      success += result.success;
      failed += result.failed;
      offset += BATCH_SIZE;
    }

    this.logger.log(
      `임베딩 전체 재생성: ${total}건 중 성공 ${success}, 실패 ${failed}`,
    );
    return { total, success, failed };
  }

  /** 임베딩 배치 처리 (동시 5개씩) */
  private async processEmbeddingBatch(
    faqs: Array<{
      id: number;
      question: string;
      answer: string;
      questionKo: string | null;
      answerKo: string | null;
    }>,
  ): Promise<{ success: number; failed: number }> {
    const CONCURRENCY = 5;
    let success = 0;
    let failed = 0;

    for (let i = 0; i < faqs.length; i += CONCURRENCY) {
      const batch = faqs.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((faq) =>
          this.generateAndSaveEmbedding(
            faq.id,
            faq.question,
            faq.answer,
            faq.questionKo,
            faq.answerKo,
          ),
        ),
      );
      for (const r of results) {
        if (r.status === 'fulfilled') success++;
        else failed++;
      }
    }

    return { success, failed };
  }

  async searchSimilar(query: string, limit = 5) {
    const embedding = await this.embeddingService.generateEmbedding(query);

    if (!embedding) {
      return [];
    }

    const vectorStr = `[${embedding.join(',')}]`;

    const results = await this.prisma.$queryRawUnsafe<
      Array<{
        id: number;
        question: string;
        answer: string;
        tags: string[];
        similarity: number;
      }>
    >(
      `SELECT id, question, answer, tags,
              1 - (embedding <=> $1::vector) as similarity
       FROM faqs
       WHERE status = 'approved' AND embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      vectorStr,
      limit,
    );

    return results.map((r) => ({
      id: r.id,
      question: r.question,
      answer: r.answer,
      tags: r.tags,
      similarity: Number(r.similarity),
    }));
  }

  async checkDuplicates(
    question: string,
    threshold = 0.8,
    excludeId?: number,
  ): Promise<{
    hasDuplicate: boolean;
    duplicates: Array<{
      id: number;
      question: string;
      questionKo: string | null;
      similarity: number;
      status: string;
    }>;
  }> {
    const embedding = await this.embeddingService.generateEmbedding(question);
    if (!embedding) {
      return { hasDuplicate: false, duplicates: [] };
    }

    const vectorStr = `[${embedding.join(',')}]`;

    const results = await this.prisma.$queryRawUnsafe<
      Array<{
        id: number;
        question: string;
        question_ko: string | null;
        status: string;
        similarity: number;
      }>
    >(
      `SELECT id, question, question_ko, status,
              1 - (embedding <=> $1::vector) as similarity
       FROM faqs
       WHERE status IN ('pending', 'approved')
         AND embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector
       LIMIT 5`,
      vectorStr,
    );

    const duplicates = results
      .filter((r) => Number(r.similarity) >= threshold)
      .filter((r) => !excludeId || r.id !== excludeId)
      .map((r) => ({
        id: r.id,
        question: r.question,
        questionKo: r.question_ko,
        similarity: Number(r.similarity),
        status: r.status,
      }));

    return { hasDuplicate: duplicates.length > 0, duplicates };
  }

  // ============================================================================
  // Duplicate Scan (기존 FAQ 간 중복 탐색)
  // ============================================================================

  async scanDuplicates(threshold = 0.92): Promise<{
    groups: Array<{
      faqs: Array<{
        id: number;
        question: string;
        questionKo: string | null;
        status: string;
        category: string | null;
      }>;
      maxSimilarity: number;
    }>;
    totalGroups: number;
  }> {
    // 유사 페어 탐색 (CROSS JOIN LATERAL)
    const pairs = await this.prisma.$queryRawUnsafe<
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
         LIMIT 5
       ) f2
       WHERE f1.status IN ('pending', 'approved')
         AND f1.embedding IS NOT NULL
         AND 1 - (f1.embedding <=> f2.embedding) >= $1`,
      threshold,
    );

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

    const maxSim = new Map<number, number>(); // root → max similarity
    for (const { id1, id2, similarity } of pairs) {
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
      select: { id: true, question: true, questionKo: true, status: true, category: true },
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
            status: string;
            category: string | null;
          }>,
        maxSimilarity: groupSim.get(root) || 0,
      }))
      .filter((g) => g.faqs.length >= 2)
      .sort((a, b) => b.maxSimilarity - a.maxSimilarity);

    return { groups, totalGroups: groups.length };
  }

  // ============================================================================
  // Auto-Categorization (Embedding-based)
  // ============================================================================

  private static readonly VALID_CATEGORIES = [
    'general', 'booking', 'tour', 'payment',
    'transportation', 'accommodation', 'visa', 'other',
  ];

  async autoCategorizeFaqs(): Promise<{
    total: number;
    categorized: number;
    failed: number;
    embeddingsGenerated: number;
  }> {
    // Step 1: 임베딩 없는 FAQ에 임베딩 backfill
    const embeddingsGenerated = await this.backfillMissingEmbeddings();

    // Step 2: 카테고리별 centroid 계산
    const centroids = await this.prisma.$queryRawUnsafe<
      Array<{ category: string; cnt: number }>
    >(
      `SELECT category, COUNT(*)::int as cnt
       FROM faqs
       WHERE category IS NOT NULL AND embedding IS NOT NULL
       GROUP BY category
       HAVING COUNT(*) >= 2`,
    );

    if (centroids.length === 0) {
      this.logger.warn('분류된 seed FAQ가 없어 Gemini fallback 사용');
      const geminiResult = await this.autoCategorizeFaqsWithGemini();
      return { ...geminiResult, embeddingsGenerated };
    }

    this.logger.log(
      `centroid: ${centroids.map((c) => `${c.category}(${c.cnt}건)`).join(', ')}`,
    );

    // Step 3: 미분류 FAQ → 가장 가까운 centroid 카테고리 배정 (SQL)
    const results = await this.prisma.$queryRawUnsafe<
      Array<{ id: number; best_category: string; similarity: number }>
    >(
      `WITH centroids AS (
        SELECT category, AVG(embedding) as centroid
        FROM faqs
        WHERE category IS NOT NULL AND embedding IS NOT NULL
        GROUP BY category
        HAVING COUNT(*) >= 2
      ),
      ranked AS (
        SELECT f.id, c.category as best_category,
               1 - (f.embedding <=> c.centroid) as similarity,
               ROW_NUMBER() OVER (PARTITION BY f.id ORDER BY f.embedding <=> c.centroid) as rn
        FROM faqs f
        CROSS JOIN centroids c
        WHERE f.category IS NULL AND f.embedding IS NOT NULL
      )
      SELECT id, best_category, similarity::float
      FROM ranked
      WHERE rn = 1`,
    );

    if (results.length === 0) {
      return { total: 0, categorized: 0, failed: 0, embeddingsGenerated };
    }

    // Step 4: 카테고리별 묶어서 일괄 업데이트
    const LOW_CONFIDENCE_THRESHOLD = 0.3;
    const byCategory = new Map<string, number[]>();

    for (const { id, best_category, similarity } of results) {
      const category = similarity < LOW_CONFIDENCE_THRESHOLD ? 'other' : best_category;
      const ids = byCategory.get(category) || [];
      ids.push(id);
      byCategory.set(category, ids);
    }

    let categorized = 0;
    let failed = 0;

    for (const [category, ids] of byCategory) {
      try {
        const { count } = await this.prisma.faq.updateMany({
          where: { id: { in: ids } },
          data: { category },
        });
        categorized += count;
      } catch {
        failed += ids.length;
      }
    }

    this.cache.clear();
    this.logger.log(
      `자동 분류 완료: 임베딩 ${embeddingsGenerated}건 생성, ${results.length}건 중 ${categorized}건 분류`,
    );
    return { total: results.length, categorized, failed, embeddingsGenerated };
  }

  /** 임베딩 없는 모든 FAQ에 임베딩 생성 */
  private async backfillMissingEmbeddings(): Promise<number> {
    const BATCH_SIZE = 100;
    let generated = 0;

    while (true) {
      const ids = await this.prisma.$queryRawUnsafe<Array<{ id: number }>>(
        `SELECT id FROM faqs WHERE embedding IS NULL ORDER BY id LIMIT $1`,
        BATCH_SIZE,
      );

      if (ids.length === 0) break;

      const faqs = await this.prisma.faq.findMany({
        where: { id: { in: ids.map((r) => r.id) } },
        select: { id: true, question: true, answer: true, questionKo: true, answerKo: true },
      });

      const result = await this.processEmbeddingBatch(faqs);
      generated += result.success;

      this.logger.log(`임베딩 backfill 진행중: ${generated}건 생성...`);
    }

    if (generated > 0) {
      this.logger.log(`임베딩 backfill 완료: ${generated}건`);
    }
    return generated;
  }

  // Gemini fallback (seed FAQ가 없을 때)
  private async autoCategorizeFaqsWithGemini(): Promise<{
    total: number;
    categorized: number;
    failed: number;
  }> {
    const uncategorized = await this.prisma.faq.findMany({
      where: { category: null },
      select: { id: true, question: true, answer: true, questionKo: true, answerKo: true },
      orderBy: { id: 'asc' },
    });

    if (uncategorized.length === 0) {
      return { total: 0, categorized: 0, failed: 0 };
    }

    const BATCH_SIZE = 50;
    let categorized = 0;
    let failed = 0;

    for (let i = 0; i < uncategorized.length; i += BATCH_SIZE) {
      const batch = uncategorized.slice(i, i + BATCH_SIZE);
      try {
        const results = await this.classifyBatchCategories(batch);

        for (const { id, category } of results) {
          try {
            await this.prisma.faq.update({
              where: { id },
              data: { category },
            });
            categorized++;
          } catch {
            failed++;
          }
        }
      } catch (error) {
        this.logger.error(`카테고리 배치 분류 실패 (offset ${i}):`, error);
        failed += batch.length;
      }
    }

    this.cache.clear();
    this.logger.log(
      `Gemini 자동 분류: ${uncategorized.length}건 중 ${categorized}건 성공, ${failed}건 실패`,
    );
    return { total: uncategorized.length, categorized, failed };
  }

  private async classifyBatchCategories(
    faqs: Array<{ id: number; question: string; answer: string; questionKo: string | null; answerKo: string | null }>,
  ): Promise<Array<{ id: number; category: string }>> {
    const categories = [
      'general - 일반 문의, 회사/서비스 소개, 운영시간, 연락처',
      'booking - 예약, 일정, 취소, 인원, 변경, 확정',
      'tour - 투어 상세, 일정표, 소요시간, 코스, 가이드, 관광지',
      'payment - 가격, 결제, 환불, 보증금, 할인',
      'transportation - 공항 픽업, 교통편, 버스, 택시, 지하철, 이동',
      'accommodation - 호텔, 게스트하우스, 숙소, 체크인/아웃',
      'visa - 비자, 여권, 입국 요건, 출입국',
      'other - 위 카테고리에 해당하지 않는 질문',
    ];

    const faqList = faqs
      .map((f) => {
        const q = f.questionKo || f.question;
        return `id=${f.id} Q: ${q}`;
      })
      .join('\n');

    const prompt = `You are classifying FAQs for a Korea travel tour company.
Classify each FAQ into exactly one category.

Categories:
${categories.join('\n')}

FAQs:
${faqList}

Reply ONLY JSON array: [{"id":1,"category":"booking"}]
Use exact category key. No explanation.`;

    const result = await this.geminiCore.callGemini(prompt, {
      temperature: 0,
      maxOutputTokens: 4096,
    });

    const jsonStr = result.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const parsed: Array<{ id: number; category: string }> = JSON.parse(jsonStr);

    const validSet = new Set(FaqService.VALID_CATEGORIES);

    return parsed
      .filter((r) => validSet.has(r.category))
      .map((r) => ({ id: r.id, category: r.category }));
  }

  // ============================================================================
  // FAQ Chat (AI) — 하이브리드 응답 전략
  // 1. FAQ 유사도 높음 → FAQ 답변 (회사 관련)
  // 2. FAQ 유사도 낮음 → 의도 분류 후 분기
  //    - company → FAQ RAG
  //    - travel → Gemini 직접 (일반 한국 여행)
  // ============================================================================

  private static readonly DIRECT_THRESHOLD = 0.7; // FAQ 직접 답변 임계값
  private static readonly RAG_THRESHOLD = 0.5; // FAQ RAG 임계값

  async chatWithFaq(
    message: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>,
    meta?: { ipAddress?: string; visitorId?: string },
  ): Promise<{
    answer: string;
    sources?: Array<{ question: string; id: number }>;
    noMatch: boolean;
    responseTier: 'direct' | 'rag' | 'general' | 'no_match';
    suggestedQuestions?: Array<{ id: number; question: string }>;
  }> {
    // 1. 유사 FAQ 검색
    const similar = await this.searchSimilar(message, 5);
    const topSimilarity = similar.length > 0 ? similar[0].similarity : 0;

    // 2. 하이브리드 분기
    let answer: string;
    let responseTier: 'direct' | 'rag' | 'general' | 'no_match';
    let suggestedQuestions: Array<{ id: number; question: string }> | undefined;

    if (topSimilarity >= FaqService.DIRECT_THRESHOLD) {
      // === Direct: FAQ 원문 직접 반환 (확실히 회사 관련) ===
      responseTier = 'direct';
      answer = similar[0].answer;
    } else {
      // === 유사도 낮음: 의도 분류 후 분기 ===
      const intent = await this.classifyIntent(message);
      this.logger.debug(
        `Intent classified: ${intent} for message: "${message.substring(0, 50)}..."`,
      );

      if (intent === 'company' && topSimilarity >= FaqService.RAG_THRESHOLD) {
        // === RAG: 회사 관련이지만 정확한 FAQ 없음 → FAQ 컨텍스트로 생성 ===
        responseTier = 'rag';
        const relevant = similar.filter(
          (f) => f.similarity >= FaqService.RAG_THRESHOLD,
        );
        answer = await this.generateRagAnswer(message, relevant, history);
      } else if (intent === 'company') {
        // === 회사 관련인데 매칭 FAQ 없음 → 문의 안내 ===
        responseTier = 'no_match';
        answer =
          "I don't have specific information about that in our FAQ. For questions about our tours, pricing, or bookings, please start a tour inquiry or contact us directly at info@tumakr.com.";
        if (similar.length > 0) {
          suggestedQuestions = similar.slice(0, 3).map((f) => ({
            id: f.id,
            question: f.question,
          }));
        }
      } else {
        // === General: 일반 한국 여행 질문 → Gemini 직접 답변 ===
        responseTier = 'general';
        answer = await this.generateGeneralTravelAnswer(message, history);
      }
    }

    // 3. 매칭된 FAQ 정보
    const relevant = similar.filter(
      (f) => f.similarity >= FaqService.RAG_THRESHOLD,
    );
    const noMatch = relevant.length === 0;
    const matchedFaqIds = relevant.map((f) => f.id);
    const matchedSimilarities = relevant.map((f) => f.similarity);

    // 4. 로그 저장 (fire-and-forget)
    const logAnswer = answer;
    const saveLog = async () => {
      let geo = {
        country: null as string | null,
        countryName: null as string | null,
        city: null as string | null,
      };
      if (meta?.ipAddress) {
        const geoData = await this.geoIpService.lookup(meta.ipAddress);
        geo = {
          country: geoData.country,
          countryName: geoData.countryName,
          city: geoData.city,
        };
      }
      await this.prisma.faqChatLog.create({
        data: {
          message,
          answer: logAnswer,
          matchedFaqIds,
          matchedSimilarities,
          topSimilarity: similar.length > 0 ? similar[0].similarity : null,
          noMatch,
          responseTier,
          visitorId: meta?.visitorId || null,
          ipAddress: meta?.ipAddress || null,
          country: geo.country,
          countryName: geo.countryName,
          city: geo.city,
        },
      });
    };
    saveLog().catch((err) =>
      this.logger.error('FAQ 채팅 로그 저장 실패:', err),
    );

    // 5. 매칭된 FAQ viewCount 증가 (fire-and-forget)
    if (matchedFaqIds.length > 0) {
      this.prisma.faq
        .updateMany({
          where: { id: { in: matchedFaqIds } },
          data: { viewCount: { increment: 1 } },
        })
        .catch((err) => this.logger.error('FAQ viewCount 증가 실패:', err));
    }

    return {
      answer,
      sources:
        relevant.length > 0
          ? relevant.map((f) => ({ question: f.question, id: f.id }))
          : undefined,
      noMatch,
      responseTier,
      suggestedQuestions,
    };
  }

  /**
   * 의도 분류: company (회사/투어 관련) vs travel (일반 여행 정보)
   */
  private async classifyIntent(message: string): Promise<'company' | 'travel'> {
    const prompt = `Classify this question into ONE category:
- "company": Questions about tours, bookings, reservations, prices, cancellations, refunds, policies, schedules, guides, pickup, itinerary changes, or contacting the travel agency
- "travel": General Korea travel information (weather, transportation, food, attractions, visa, culture, tips, shopping, etc.)

Question: "${message}"

Reply with ONLY one word: company OR travel`;

    try {
      const result = await this.geminiCore.callGemini(prompt, {
        temperature: 0,
        maxOutputTokens: 10,
      });
      const intent = result.trim().toLowerCase();
      return intent === 'company' ? 'company' : 'travel';
    } catch (error) {
      this.logger.error(
        'Intent classification failed, defaulting to travel:',
        error,
      );
      return 'travel'; // 실패 시 일반 여행으로 처리
    }
  }

  /**
   * 일반 한국 여행 질문에 대한 Gemini 직접 답변
   */
  private async generateGeneralTravelAnswer(
    message: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): Promise<string> {
    const systemPrompt = `You are a friendly and knowledgeable Korea travel assistant for Tumakr, a travel agency specializing in Korea tours.

Your role is to answer general questions about traveling in Korea, such as:
- Weather and best seasons to visit
- Transportation (trains, buses, taxis, T-money cards)
- Food and restaurants
- Tourist attractions and activities
- Visa and entry requirements
- Culture and etiquette
- Shopping and nightlife
- Practical tips (SIM cards, money exchange, etc.)

Guidelines:
- Be helpful, accurate, and concise
- Keep responses under 250 words
- Use a friendly, conversational tone
- You may use markdown formatting (bold, bullet points) for clarity
- If asked about specific tour packages, prices, or bookings, politely mention that you can help with general travel info, and suggest they start a tour inquiry for personalized assistance
- Base your answers on common, accurate knowledge about Korea`;

    const geminiHistory = history?.map((h) => ({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.content }],
    }));

    return this.geminiCore.callGemini(message, {
      temperature: 0.7,
      maxOutputTokens: 1024,
      systemPrompt,
      history: geminiHistory,
    });
  }

  /**
   * RAG 응답 생성: Gemini + FAQ 컨텍스트
   */
  private async generateRagAnswer(
    message: string,
    relevant: Array<{
      id: number;
      question: string;
      answer: string;
      similarity: number;
    }>,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): Promise<string> {
    const faqContext = relevant
      .map(
        (f, i) =>
          `[FAQ ${i + 1}] (similarity: ${f.similarity.toFixed(2)})\nQ: ${f.question}\nA: ${f.answer}`,
      )
      .join('\n\n');

    const systemPrompt = `You are a helpful travel assistant for Tumakr, a Korea travel agency.
Answer user questions based on the FAQ entries provided below.

=== FAQ Reference ===
${faqContext}
=== End FAQ ===

Guidelines:
- Answer in a friendly, concise manner.
- Base your answer on the FAQ entries provided.
- If the FAQ entries don't fully answer the question, honestly say you don't have specific information and suggest the user start a tour inquiry for personalized help.
- Do NOT make up information about tours, prices, or schedules.
- Keep responses under 300 words.
- You may use markdown formatting for clarity.`;

    const geminiHistory = history?.map((h) => ({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.content }],
    }));

    return this.geminiCore.callGemini(message, {
      temperature: 0.5,
      maxOutputTokens: 1024,
      systemPrompt,
      history: geminiHistory,
    });
  }

  /**
   * FAQ 원문 직접 반환 (제안 질문 클릭 시 사용)
   */
  async getDirectFaqAnswer(
    faqId: number,
  ): Promise<{ question: string; answer: string }> {
    const faq = await this.prisma.faq.findUnique({
      where: { id: faqId },
      select: { id: true, question: true, answer: true },
    });

    if (!faq) {
      throw new NotFoundException('FAQ를 찾을 수 없습니다');
    }

    // viewCount 증가 (fire-and-forget)
    this.prisma.faq
      .update({ where: { id: faqId }, data: { viewCount: { increment: 1 } } })
      .catch((err) => this.logger.error('FAQ viewCount 증가 실패:', err));

    return { question: faq.question, answer: faq.answer };
  }

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

    const enriched = logs.map((log) => ({
      ...convertDecimalFields(log),
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
    const cached =
      this.cache.get<ReturnType<typeof this.buildChatStatsResponse>>(cacheKey);
    if (cached) return cached;

    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // 단일 쿼리로 모든 카운트 집계 (9개 쿼리 → 4개로 최적화)
    const [counts, dailyTrend, topQuestions, unansweredQuestions] =
      await Promise.all([
        // 모든 카운트를 한 번에 가져오기
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
        // 일별 추이 (30일)
        this.prisma.$queryRaw<Array<{ date: Date; count: bigint }>>`
        SELECT DATE(created_at AT TIME ZONE 'UTC') as date, COUNT(*)::bigint as count
        FROM faq_chat_logs
        WHERE created_at >= ${thirtyDaysAgo}
        GROUP BY DATE(created_at AT TIME ZONE 'UTC')
        ORDER BY date ASC
      `,
        // 자주 묻는 질문 Top 10 (고객 실제 질문)
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
        // 답변 못한 질문 Top 10 (FAQ 추가 필요)
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

    this.cache.set(cacheKey, result, 2 * 60 * 1000); // 2분 캐시
    return result;
  }

  private buildChatStatsResponse(data: any) {
    return data; // 타입 추론용 헬퍼
  }
}
