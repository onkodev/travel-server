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
import { AiPromptService } from '../ai-prompt/ai-prompt.service';
import { PromptKey } from '../ai-prompt/prompt-registry';
import { MemoryCache } from '../../common/utils';

@Injectable()
export class FaqService {
  private readonly logger = new Logger(FaqService.name);
  private cache = new MemoryCache(5 * 60 * 1000); // 5분 캐시

  constructor(
    private prisma: PrismaService,
    private embeddingService: EmbeddingService,
    private geminiCore: GeminiCoreService,
    private aiPromptService: AiPromptService,
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
  // Text-based Duplicate Removal + Low-quality Cleanup
  // ============================================================================

  async removeDuplicates(): Promise<{
    exactDuplicatesDeleted: number;
    lowQualityDeleted: number;
    totalDeleted: number;
    remainingCount: number;
  }> {
    this.logger.log('텍스트 기반 중복 제거 + 저품질 필터링 시작');

    // Phase 1: 저품질 FAQ 삭제 (Q/A가 너무 짧거나 의미 없는 것)
    const lowQuality = await this.prisma.faq.findMany({
      where: {
        status: 'pending',
        OR: [
          // question이 10자 미만
          { question: { not: { contains: '          ' } } },
          // answer가 10자 미만 (아래에서 JS로 필터)
        ],
      },
      select: { id: true, question: true, answer: true },
    });

    const lowQualityIds = lowQuality
      .filter(
        (f) =>
          f.question.trim().length < 10 ||
          f.answer.trim().length < 10 ||
          // Q와 A가 동일
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

    // Phase 2: question 텍스트 완전 일치 중복 제거 (대소문자 무시)
    // 1단계: 중복 그룹 찾기
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
      // 2단계: 각 그룹에서 keep_id 조회 후 나머지 삭제
      for (const group of duplicateGroups) {
        // 각 그룹에서 가장 좋은 1개 ID 선택 (approved 우선, confidence 높은 순, id 낮은 순)
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
    // 유사 페어 탐색 — 배치 방식 (트랜잭션 타임아웃 문제 회피)
    // 전체 FAQ ID를 배치로 나눠 각 배치에서 유사 페어를 찾음
    const BATCH_SIZE = 500;
    const embeddedRows = await this.prisma.$queryRawUnsafe<Array<{ id: number }>>(
      `SELECT id FROM faqs
       WHERE status IN ('pending', 'approved') AND embedding IS NOT NULL
       ORDER BY id
       LIMIT 3000`,
    );

    const pairs: Array<{ id1: number; id2: number; similarity: number }> = [];

    for (let i = 0; i < embeddedRows.length; i += BATCH_SIZE) {
      const batchIds = embeddedRows.slice(i, i + BATCH_SIZE).map((r) => r.id);
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

    const faqListText = faqs
      .map((f) => {
        const q = f.questionKo || f.question;
        return `id=${f.id} Q: ${q}`;
      })
      .join('\n');

    const built = await this.aiPromptService.buildPrompt(
      PromptKey.FAQ_CLASSIFY_CATEGORIES,
      { categories: categories.join('\n'), faqList: faqListText },
    );

    const result = await this.geminiCore.callGemini(built.text, {
      temperature: built.temperature,
      maxOutputTokens: built.maxOutputTokens,
    });

    const jsonStr = result.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const parsed: Array<{ id: number; category: string }> = JSON.parse(jsonStr);

    const validSet = new Set(FaqService.VALID_CATEGORIES);

    return parsed
      .filter((r) => validSet.has(r.category))
      .map((r) => ({ id: r.id, category: r.category }));
  }

  // ============================================================================
  // Auto-Review Pipeline (AI-powered bulk review)
  // ============================================================================

  async autoReviewFaqs(
    userId: string,
    options?: {
      batchSize?: number;
      dryRun?: boolean;
    },
  ): Promise<{
    total: number;
    approved: number;
    rejected: number;
    needsReview: number;
    failed: number;
    remaining: number;
    dryRun: boolean;
    details?: Array<{ id: number; decision: string; reason: string }>;
  }> {
    const batchSize = options?.batchSize ?? 100;
    const dryRun = options?.dryRun ?? false;

    this.logger.log(`자동 리뷰 시작 (batchSize=${batchSize}, dryRun=${dryRun})`);

    // Step 1: pending FAQ 조회 (단일 배치만 처리)
    const pendingFaqs = await this.prisma.faq.findMany({
      where: { status: 'pending' },
      select: {
        id: true,
        question: true,
        answer: true,
        questionKo: true,
        answerKo: true,
        confidence: true,
        category: true,
        source: true,
      },
      orderBy: { id: 'asc' },
      take: batchSize,
    });

    if (pendingFaqs.length === 0) {
      return { total: 0, approved: 0, rejected: 0, needsReview: 0, failed: 0, remaining: 0, dryRun };
    }

    // Step 2: 룰 기반 사전 필터
    const { autoReject, autoReview, geminiCandidates } = this.preFilterFaqs(pendingFaqs);

    let approved = 0;
    let rejected = 0;
    let needsReview = 0;
    let failed = 0;
    const dryRunDetails: Array<{ id: number; decision: string; reason: string }> = [];

    // Step 3: 룰 기반 자동 reject 처리
    if (autoReject.length > 0) {
      const rejectIds = autoReject.map((r) => r.id);
      rejected += autoReject.length;

      if (dryRun) {
        autoReject.forEach((r) => dryRunDetails.push(r));
      } else {
        await this.prisma.faq.updateMany({
          where: { id: { in: rejectIds } },
          data: { status: 'rejected', approvedBy: userId },
        });
        for (const { id, reason } of autoReject) {
          this.prisma.faq
            .update({ where: { id }, data: { rejectionReason: `[Rule] ${reason}` } })
            .catch(() => {});
        }
        this.cleanupBulkEmailRawData(rejectIds).catch((err) =>
          this.logger.error('룰 거절 rawData 정리 실패:', err),
        );
      }
    }

    // Step 4: 룰 기반 자동 review (보류) 처리
    if (autoReview.length > 0) {
      needsReview += autoReview.length;
      if (dryRun) {
        autoReview.forEach((r) => dryRunDetails.push(r));
      }
    }

    this.logger.log(
      `사전 필터: 전체 ${pendingFaqs.length}건 → 자동 거절 ${autoReject.length}, 자동 보류 ${autoReview.length}, Gemini 대상 ${geminiCandidates.length}`,
    );

    // Step 5: Gemini 배치 처리 (나머지)
    if (geminiCandidates.length > 0) {
      try {
        const decisions = await this.reviewBatchWithGemini(geminiCandidates);

        const approveIds: number[] = [];
        const rejectIds: number[] = [];
        const rejectReasons = new Map<number, string>();

        for (const { id, decision, reason } of decisions) {
          if (dryRun) {
            dryRunDetails.push({ id, decision, reason });
          }

          if (decision === 'approve') {
            approveIds.push(id);
            approved++;
          } else if (decision === 'reject') {
            rejectIds.push(id);
            rejectReasons.set(id, reason);
            rejected++;
          } else {
            needsReview++;
          }
        }

        if (!dryRun) {
          if (approveIds.length > 0) {
            await this.prisma.faq.updateMany({
              where: { id: { in: approveIds } },
              data: {
                status: 'approved',
                approvedAt: new Date(),
                approvedBy: userId,
                rejectionReason: null,
              },
            });
            this.generateBulkEmbeddings(approveIds).catch((err) =>
              this.logger.error('자동 승인 임베딩 생성 실패:', err),
            );
          }

          if (rejectIds.length > 0) {
            await this.prisma.faq.updateMany({
              where: { id: { in: rejectIds } },
              data: { status: 'rejected', approvedBy: userId },
            });
            for (const [faqId, reason] of rejectReasons) {
              this.prisma.faq
                .update({ where: { id: faqId }, data: { rejectionReason: reason } })
                .catch(() => {});
            }
            this.cleanupBulkEmailRawData(rejectIds).catch((err) =>
              this.logger.error('자동 거절 rawData 정리 실패:', err),
            );
          }
        }
      } catch (error) {
        this.logger.error('자동 리뷰 Gemini 배치 실패:', error);
        failed += geminiCandidates.length;
      }
    }

    // Step 6: 남은 pending 수 조회
    const remaining = await this.prisma.faq.count({ where: { status: 'pending' } });

    this.cache.clear();

    const totalProcessed = pendingFaqs.length;
    this.logger.log(
      `자동 리뷰 완료: 총 ${totalProcessed}건 (승인 ${approved}, 거절 ${rejected}, 보류 ${needsReview}, 실패 ${failed}, 남은 pending ${remaining})`,
    );

    return {
      total: totalProcessed,
      approved,
      rejected,
      needsReview,
      failed,
      remaining,
      dryRun,
      details: dryRun ? dryRunDetails : undefined,
    };
  }

  /**
   * 룰 기반 사전 필터: Gemini 호출 전에 확실한 reject/review 분류
   */
  private preFilterFaqs(
    faqs: Array<{
      id: number;
      question: string;
      answer: string;
      questionKo: string | null;
      answerKo: string | null;
      confidence: any;
      category: string | null;
      source: string;
    }>,
  ): {
    autoReject: Array<{ id: number; decision: string; reason: string }>;
    autoReview: Array<{ id: number; decision: string; reason: string }>;
    geminiCandidates: typeof faqs;
  } {
    const GREETING_PATTERN = /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|bye|good|sure|great|nice|wow|cool|haha|lol|hmm)\b/i;
    const INCOMPLETE_ANSWER_PATTERN = /\b(I'll check|Let me get back|I will confirm|I'll get back|I will check|I'll confirm|let me check|let me confirm|I need to check|I will get back)\b/i;
    const PERSONAL_QUESTION_PATTERN = /\b(my tour|my guide|my booking|my pickup|my reservation|my itinerary|my schedule|my hotel|my flight|my driver|my transfer)\b/i;
    const SPECIFIC_DATE_PATTERN = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}\b/i;
    const YEAR_PATTERN = /\b202[4-9]\b/;
    const PHONE_PATTERN = /(\+82|010[-.\s]?\d{4})/;
    const CUSTOMER_NAME_PATTERN = /\b(Mr\.|Mrs\.|Ms\.|Miss)\s+[A-Z]/;

    const autoReject: Array<{ id: number; decision: string; reason: string }> = [];
    const autoReview: Array<{ id: number; decision: string; reason: string }> = [];
    const geminiCandidates: typeof faqs = [];

    for (const faq of faqs) {
      const q = faq.question.trim();
      const a = faq.answer.trim();

      // 자동 REJECT 룰
      if (a.length < 20) {
        autoReject.push({ id: faq.id, decision: 'reject', reason: 'Answer too short (< 20 chars)' });
        continue;
      }

      if (GREETING_PATTERN.test(q)) {
        autoReject.push({ id: faq.id, decision: 'reject', reason: 'Question is greeting/acknowledgment' });
        continue;
      }

      if (INCOMPLETE_ANSWER_PATTERN.test(a)) {
        autoReject.push({ id: faq.id, decision: 'reject', reason: 'Answer is incomplete/deferred response' });
        continue;
      }

      if (PERSONAL_QUESTION_PATTERN.test(q)) {
        autoReject.push({ id: faq.id, decision: 'reject', reason: 'Personal/customer-specific question' });
        continue;
      }

      // 자동 REVIEW 룰
      if (SPECIFIC_DATE_PATTERN.test(a) || YEAR_PATTERN.test(a)) {
        autoReview.push({ id: faq.id, decision: 'review', reason: 'Contains specific dates — may be outdated' });
        continue;
      }

      if (PHONE_PATTERN.test(a)) {
        autoReview.push({ id: faq.id, decision: 'review', reason: 'Contains phone number — needs verification' });
        continue;
      }

      if (CUSTOMER_NAME_PATTERN.test(a)) {
        autoReview.push({ id: faq.id, decision: 'review', reason: 'Contains customer name — needs anonymization' });
        continue;
      }

      // Gemini에 전달
      geminiCandidates.push(faq);
    }

    return { autoReject, autoReview, geminiCandidates };
  }

  private async reviewBatchWithGemini(
    faqs: Array<{
      id: number;
      question: string;
      answer: string;
      questionKo: string | null;
      answerKo: string | null;
      confidence: any;
      category: string | null;
      source: string;
    }>,
  ): Promise<Array<{ id: number; decision: 'approve' | 'reject' | 'review'; reason: string }>> {
    const faqListText = faqs
      .map((f) => {
        const q = f.question;
        const a = f.answer.length > 300 ? f.answer.substring(0, 300) + '...' : f.answer;
        return `id=${f.id}\nQ: ${q}\nA: ${a}`;
      })
      .join('\n---\n');

    const built = await this.aiPromptService.buildPrompt(
      PromptKey.FAQ_AUTO_REVIEW,
      { faqList: faqListText },
    );

    const result = await this.geminiCore.callGemini(built.text, {
      temperature: built.temperature,
      maxOutputTokens: built.maxOutputTokens,
    });

    const jsonStr = result.replace(/```json?\n?/g, '').replace(/```/g, '').trim();

    this.logger.log(`Gemini raw (first 300): ${jsonStr.substring(0, 300)}`);

    let parsed: Array<{ id: number | string; decision: string; confidence?: number; reason: string }>;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (parseErr) {
      this.logger.error(`JSON parse 실패: ${(parseErr as Error).message}`);
      this.logger.error(`Raw: ${jsonStr.substring(0, 500)}`);
      return [];
    }

    this.logger.log(`Parsed ${parsed.length}건, 첫 항목: ${JSON.stringify(parsed[0])}`);

    const validDecisions = new Set(['approve', 'reject', 'review']);
    const validIds = new Set(faqs.map((f) => f.id));

    const filtered = parsed
      .filter((r) => {
        const numId = Number(r.id);
        return !isNaN(numId) && validIds.has(numId) && validDecisions.has(r.decision.toLowerCase());
      })
      .map((r) => {
        let decision = r.decision.toLowerCase() as 'approve' | 'reject' | 'review';
        const confidence = typeof r.confidence === 'number' ? r.confidence : 50;

        // confidence < 90인 approve → review로 격하
        if (decision === 'approve' && confidence < 90) {
          this.logger.debug(`FAQ #${r.id}: approve → review (confidence ${confidence} < 90)`);
          decision = 'review';
        }

        return {
          id: Number(r.id),
          decision,
          reason: r.reason || '',
        };
      });

    this.logger.log(`필터 후 ${filtered.length}건 (승인/거절/보류 처리 대상)`);
    return filtered;
  }

  // ============================================================================
  // FAQ Chat (AI) — 하이브리드 응답 전략
  // 1. FAQ 유사도 높음 → FAQ 답변 (회사 관련)
  // 2. FAQ 유사도 낮음 → 의도 분류 후 분기
  //    - company → FAQ RAG
  //    - travel → Gemini 직접 (일반 한국 여행)
  // ============================================================================

  private static readonly DEFAULT_DIRECT_THRESHOLD = 0.7;
  private static readonly DEFAULT_RAG_THRESHOLD = 0.5;

  async chatWithFaq(
    message: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>,
    meta?: { ipAddress?: string; visitorId?: string },
  ): Promise<{
    answer: string;
    sources?: Array<{ question: string; id: number }>;
    noMatch: boolean;
    responseTier: 'direct' | 'rag' | 'general' | 'tour_recommend' | 'no_match';
    suggestedQuestions?: Array<{ id: number; question: string }>;
    tourRecommendations?: Array<{
      id: number;
      name: string;
      nameKor: string | null;
      thumbnailUrl: string | null;
      websiteUrl: string;
      price: number | null;
      region: string | null;
      duration: string | null;
    }>;
  }> {
    // 0. FaqChatConfig 로드
    const chatConfig = await this.aiPromptService.getFaqChatConfig();
    const directThreshold = chatConfig.directThreshold ?? FaqService.DEFAULT_DIRECT_THRESHOLD;
    const ragThreshold = chatConfig.ragThreshold ?? FaqService.DEFAULT_RAG_THRESHOLD;

    // 1. 의도 분류 + 유사 FAQ 검색 + 투어 검색 (병렬)
    const [intent, similar, relatedTours] = await Promise.all([
      this.classifyIntent(message),
      this.searchSimilar(message, 5),
      this.searchOdkTours(message, 5),
    ]);
    const topSimilarity = similar.length > 0 ? similar[0].similarity : 0;

    this.logger.debug(
      `Intent: ${intent}, topSim: ${topSimilarity.toFixed(2)} for: "${message.substring(0, 50)}..."`,
    );

    // 2. 하이브리드 분기
    let answer: string;
    let responseTier: 'direct' | 'rag' | 'general' | 'tour_recommend' | 'no_match';
    let suggestedQuestions: Array<{ id: number; question: string }> | undefined;
    let tourRecommendations:
      | Array<{
          id: number;
          name: string;
          nameKor: string | null;
          thumbnailUrl: string | null;
          websiteUrl: string;
          price: number | null;
          region: string | null;
          duration: string | null;
        }>
      | undefined;

    // 투어 매핑 헬퍼
    const mapTours = (tours: typeof relatedTours) =>
      tours.map((t) => ({
        id: t.id,
        name: t.name,
        nameKor: t.nameKor,
        description: t.description,
        thumbnailUrl: t.thumbnailUrl,
        websiteUrl: t.websiteUrl,
        price: t.price,
        region: t.region,
        duration: t.duration,
      }));

    if (intent === 'tour_recommend') {
      // === Tour Recommend: 투어 추천 요청 (최우선) ===
      if (relatedTours.length > 0) {
        responseTier = 'tour_recommend';
        answer = await this.generateTourRecommendationAnswer(
          message,
          relatedTours,
          history,
        );
        tourRecommendations = mapTours(relatedTours);
      } else {
        // 매칭 투어 없음 → 일반 여행 답변 폴백
        responseTier = 'general';
        answer = await this.generateGeneralTravelAnswer(message, history);
      }
    } else if (topSimilarity >= directThreshold) {
      // === Direct: FAQ 원문 직접 반환 (확실히 회사 관련) ===
      responseTier = 'direct';
      answer = similar[0].answer;
    } else if (intent === 'company' && topSimilarity >= ragThreshold) {
      // === RAG: 회사 관련이지만 정확한 FAQ 없음 → FAQ 컨텍스트로 생성 ===
      responseTier = 'rag';
      const relevant = similar.filter(
        (f) => f.similarity >= ragThreshold,
      );
      answer = await this.generateRagAnswer(message, relevant, history);
    } else if (intent === 'company') {
      // === 회사 관련인데 매칭 FAQ 없음 → 문의 안내 ===
      responseTier = 'no_match';
      const noMatchBuilt = await this.aiPromptService.buildPrompt(PromptKey.FAQ_NO_MATCH_RESPONSE, {});
      answer = chatConfig.noMatchResponse || noMatchBuilt.text;
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

    // 2.5. 투어 추천 보충: tour_recommend가 아닌 응답에서도 관련 투어가 있으면 카드 첨부
    if (!tourRecommendations && relatedTours.length > 0) {
      tourRecommendations = mapTours(relatedTours);
    }

    // 3. 매칭된 FAQ 정보
    const relevant = similar.filter(
      (f) => f.similarity >= ragThreshold,
    );
    const noMatch = relevant.length === 0;
    const matchedFaqIds = relevant.map((f) => f.id);
    const matchedSimilarities = relevant.map((f) => f.similarity);

    // 4. 로그 저장 (fire-and-forget)
    const logAnswer = answer;
    const saveLog = async () => {
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
      tourRecommendations,
    };
  }

  /**
   * 의도 분류: company / tour_recommend / travel
   */
  private async classifyIntent(
    message: string,
  ): Promise<'company' | 'tour_recommend' | 'travel'> {
    const built = await this.aiPromptService.buildPrompt(
      PromptKey.FAQ_CLASSIFY_INTENT,
      { message },
    );

    try {
      const result = await this.geminiCore.callGemini(built.text, {
        temperature: built.temperature,
        maxOutputTokens: built.maxOutputTokens,
      });
      const intent = result.trim().toLowerCase();
      if (intent === 'company') return 'company';
      if (intent === 'tour_recommend') return 'tour_recommend';
      return 'travel';
    } catch (error) {
      this.logger.error(
        'Intent classification failed, defaulting to travel:',
        error,
      );
      return 'travel';
    }
  }

  /**
   * OdkTourList 유사도 검색
   */
  private async searchOdkTours(message: string, limit = 5) {
    const embedding = await this.embeddingService.generateEmbedding(message);
    if (!embedding) return [];

    const vectorStr = `[${embedding.join(',')}]`;
    const results = await this.prisma.$queryRawUnsafe<
      Array<{
        id: number;
        name: string;
        name_kor: string | null;
        description: string | null;
        thumbnail_url: string | null;
        website_url: string;
        price: string | null;
        region: string | null;
        duration: string | null;
        similarity: number;
      }>
    >(
      `SELECT id, name, name_kor, description, thumbnail_url, website_url, price, region, duration,
              1 - (embedding <=> $1::vector) as similarity
       FROM odk_tours
       WHERE is_active = true AND embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      vectorStr,
      limit,
    );

    return results
      .filter((r) => Number(r.similarity) >= 0.45)
      .map((r) => ({
        id: r.id,
        name: r.name,
        nameKor: r.name_kor,
        description: r.description,
        thumbnailUrl: r.thumbnail_url,
        websiteUrl: r.website_url,
        price: r.price ? Number(r.price) : null,
        region: r.region,
        duration: r.duration,
        similarity: Number(r.similarity),
      }));
  }

  /**
   * 투어 추천 답변 생성
   */
  private async generateTourRecommendationAnswer(
    message: string,
    tours: Array<{
      name: string;
      price: number | null;
      region: string | null;
      duration: string | null;
    }>,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): Promise<string> {
    const tourInfo = tours
      .map(
        (t, i) =>
          `${i + 1}. ${t.name} — Region: ${t.region || 'Seoul'}, Duration: ${t.duration || 'Full day'}${t.price ? `, From $${t.price}` : ''}`,
      )
      .join('\n');

    const built = await this.aiPromptService.buildPrompt(
      PromptKey.FAQ_TOUR_RECOMMENDATION,
      { tourInfo },
    );

    const geminiHistory = history?.map((h) => ({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.content }],
    }));

    return this.geminiCore.callGemini(message, {
      temperature: built.temperature,
      maxOutputTokens: built.maxOutputTokens,
      systemPrompt: built.text,
      history: geminiHistory,
    });
  }

  /**
   * 일반 한국 여행 질문에 대한 Gemini 직접 답변
   */
  private async generateGeneralTravelAnswer(
    message: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): Promise<string> {
    const built = await this.aiPromptService.buildPrompt(PromptKey.FAQ_GENERAL_TRAVEL, {});

    const geminiHistory = history?.map((h) => ({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.content }],
    }));

    return this.geminiCore.callGemini(message, {
      temperature: built.temperature,
      maxOutputTokens: built.maxOutputTokens,
      systemPrompt: built.text,
      history: geminiHistory,
    });
  }

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

    const built = await this.aiPromptService.buildPrompt(PromptKey.FAQ_RAG_ANSWER, { faqContext });

    const geminiHistory = history?.map((h) => ({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.content }],
    }));

    return this.geminiCore.callGemini(message, {
      temperature: built.temperature,
      maxOutputTokens: built.maxOutputTokens,
      systemPrompt: built.text,
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
