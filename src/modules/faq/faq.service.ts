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
import { FaqChatService } from './faq-chat.service';
import { GeminiCoreService } from '../ai/core/gemini-core.service';
import { FaqCategorizeService } from './faq-categorize.service';
import { AiPromptService } from '../ai-prompt/ai-prompt.service';
import { PromptKey } from '../ai-prompt/prompt-registry';

@Injectable()
export class FaqService {
  private readonly logger = new Logger(FaqService.name);
  private cache = new MemoryCache(5 * 60 * 1000);

  constructor(
    private prisma: PrismaService,
    private faqEmbeddingService: FaqEmbeddingService,
    private faqChatService: FaqChatService,
    private geminiCore: GeminiCoreService,
    private aiPromptService: AiPromptService,
  ) {}

  /** FAQ 목록 캐시 + 챗봇 답변 캐시 동시 초기화 */
  private clearCaches(): void {
    this.cache.clear();
    this.faqChatService.clearAnswerCache();
  }

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
    sortColumn?: string;
    sortOrder?: 'asc' | 'desc';
  }) {
    const { page = 1, limit = 20, status, source, search, category, sortColumn, sortOrder = 'desc' } = params;
    const skip = calculateSkip(page, limit);

    const where: Prisma.FaqWhereInput = {};

    if (status) where.status = status;
    if (source) where.source = source;
    if (category === '__none') {
      where.category = null;
    } else if (category) {
      where.category = category;
    }

    // snake_case → camelCase 매핑
    const SORT_COLUMN_MAP: Record<string, string> = {
      created_at: 'createdAt',
      updated_at: 'updatedAt',
      helpful_count: 'helpfulCount',
      not_helpful_count: 'notHelpfulCount',
      view_count: 'viewCount',
      category: 'category',
      question_ko: 'questionKo',
    };

    const prismaColumn = sortColumn ? SORT_COLUMN_MAP[sortColumn] : undefined;
    const orderBy: Prisma.FaqOrderByWithRelationInput = prismaColumn
      ? { [prismaColumn]: sortOrder }
      : { createdAt: 'desc' };

    if (search) {
      const idMatch = search.match(/^#?(\d+)$/);
      if (idMatch) {
        where.id = Number(idMatch[1]);
      } else {
        where.OR = [
          { question: { contains: search, mode: 'insensitive' } },
          { questionKo: { contains: search, mode: 'insensitive' } },
          { guideline: { contains: search, mode: 'insensitive' } },
          { reference: { contains: search, mode: 'insensitive' } },
          { category: { contains: search, mode: 'insensitive' } },
          { tags: { has: search.toLowerCase() } },
          { alternativeQuestions: { hasSome: [search] } },
        ];
      }
    }

    const [faqs, total] = await Promise.all([
      this.prisma.faq.findMany({
        where,
        orderBy,
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

  /**
   * AI 자동 보강: 한국어 번역 + 카테고리 + 태그 (단일 Gemini 호출)
   */
  private async autoEnrichFaq(
    question: string,
  ): Promise<{
    questionKo: string;
    category: string;
    tags: string[];
  } | null> {
    try {
      const built = await this.aiPromptService.buildPrompt(
        PromptKey.FAQ_AUTO_ENRICH,
        { question },
      );

      const result = await this.geminiCore.callGemini(built.text, {
        temperature: built.temperature,
        maxOutputTokens: built.maxOutputTokens,
        disableThinking: true,
      });

      const jsonStr = result
        .replace(/```json?\n?/g, '')
        .replace(/```/g, '')
        .trim();
      const parsed = JSON.parse(jsonStr);

      const validCategories = new Set(FaqCategorizeService.VALID_CATEGORIES);

      return {
        questionKo: parsed.questionKo || '',
        category: validCategories.has(parsed.category)
          ? parsed.category
          : 'other',
        tags: Array.isArray(parsed.tags)
          ? parsed.tags.filter((t: unknown) => typeof t === 'string')
          : [],
      };
    } catch (error) {
      this.logger.error('FAQ 자동 보강 실패:', error);
      return null;
    }
  }

  /**
   * 텍스트 번역 (한↔영)
   */
  async translateText(
    text: string,
    targetLanguage: 'en' | 'ko',
  ): Promise<{ translation: string }> {
    const langLabel = targetLanguage === 'ko' ? 'Korean' : 'English';

    const prompt = `Translate the following text to ${langLabel}.
Keep travel industry terminology consistent. Preserve proper nouns as-is.
Return ONLY the translated text, nothing else.

Text: ${text}`;

    const result = await this.geminiCore.callGemini(prompt, {
      temperature: 0.2,
      maxOutputTokens: 1024,
      disableThinking: true,
    });

    return { translation: result.trim() };
  }

  async createFaq(data: {
    question: string;
    questionKo?: string;
    tags?: string[];
    category?: string;
    guideline?: string;
    reference?: string;
    source?: string;
    sourceEmailId?: string;
    sourceEmailSubject?: string;
    sourceContext?: { questionSource?: string; answerSource?: string };
  }) {
    // 수동 생성 시 누락된 필드 자동 보강 (한국어/카테고리/태그 중 하나라도 없으면)
    const needsEnrich =
      data.source !== 'gmail' &&
      (!data.questionKo || !data.category || !data.tags?.length);

    if (needsEnrich) {
      const enriched = await this.autoEnrichFaq(data.question);
      if (enriched) {
        data.questionKo = data.questionKo || enriched.questionKo;
        data.category = data.category || enriched.category;
        data.tags = data.tags?.length ? data.tags : enriched.tags;
      }
    }

    const faq = await this.prisma.faq.create({
      data: {
        question: data.question,
        questionKo: data.questionKo || null,
        tags: data.tags || [],
        category: data.category || null,
        guideline: data.guideline || null,
        reference: data.reference || null,
        source: data.source || 'manual',
        sourceEmailId: data.sourceEmailId,
        sourceEmailSubject: data.sourceEmailSubject,
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
          faq.questionKo,
        );
      } catch (error) {
        this.logger.error(`임베딩 생성 실패 (FAQ #${faq.id}):`, error);
      }
    }

    this.clearCaches();
    return faq;
  }

  async updateFaq(id: number, data: Prisma.FaqUpdateInput) {
    const faq = await this.prisma.faq.update({
      where: { id },
      data,
    });

    // approved 상태에서 임베딩 관련 필드 변경 시 재임베딩
    const embeddingFields = [
      'question',
      'questionKo',
      'guideline',
      'reference',
      'tags',
      'alternativeQuestions',
    ] as const;
    const hasEmbeddingChange = embeddingFields.some(
      (field) => data[field] !== undefined,
    );

    if (faq.status === 'approved' && hasEmbeddingChange) {
      try {
        // question 변경 시 대안 질문도 재생성
        if (data.question) {
          const alts =
            await this.faqEmbeddingService.generateAlternativeQuestions(
              faq.question,
              faq.guideline,
            );
          if (alts.length > 0) {
            await this.prisma.faq.update({
              where: { id: faq.id },
              data: { alternativeQuestions: alts },
            });
          }
        }

        await this.faqEmbeddingService.generateAndSaveEmbedding(
          faq.id,
          faq.question,
          faq.questionKo,
        );
      } catch (error) {
        this.logger.error(`임베딩 재생성 실패 (FAQ #${faq.id}):`, error);
      }
    }

    this.clearCaches();
    return faq;
  }

  async deleteFaq(id: number) {
    const result = await this.prisma.faq.delete({ where: { id } });
    this.clearCaches();
    return result;
  }

  async approveFaq(
    id: number,
    userId: string,
    updates?: {
      question?: string;
      questionKo?: string;
    },
  ) {
    const data: Prisma.FaqUpdateInput = {
      status: 'approved',
      approvedAt: new Date(),
    };

    if (updates?.question) data.question = updates.question;
    if (updates?.questionKo !== undefined) data.questionKo = updates.questionKo;

    const faq = await this.prisma.faq.update({
      where: { id },
      data,
    });

    // 승인 시 임베딩 생성 (실패해도 승인은 유지)
    try {
      await this.faqEmbeddingService.generateAndSaveEmbedding(
        faq.id,
        faq.question,
        faq.questionKo,
      );
    } catch (error) {
      this.logger.error(`임베딩 생성 실패 (FAQ #${faq.id}):`, error);
    }

    this.clearCaches();
    return faq;
  }

  async rejectFaq(id: number, userId: string, reason?: string) {
    const faq = await this.prisma.faq.update({
      where: { id },
      data: {
        status: 'rejected',
      },
    });

    // gmail 소스인 경우, 해당 이메일 스레드에서 다른 활성 FAQ가 없으면 rawData 정리
    if (faq.source === 'gmail' && faq.sourceEmailId) {
      await this.faqEmbeddingService.cleanupEmailRawData(faq.sourceEmailId);
    }

    this.clearCaches();
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
          },
        });

        // 일괄 승인된 FAQ들의 임베딩 생성 (fire-and-forget, 트랜잭션 외부)
        this.faqEmbeddingService
          .generateBulkEmbeddings(ids)
          .catch((err) => this.logger.error('일괄 임베딩 생성 오류:', err));

        return result;
      }

      const result = await tx.faq.updateMany({
        where: { id: { in: ids } },
        data: {
          status: 'rejected',
        },
      });

      // 거절된 FAQ들의 이메일 rawData 정리 (트랜잭션 외부, fire-and-forget)
      this.faqEmbeddingService
        .cleanupBulkEmailRawData(ids)
        .catch((err) => this.logger.error('일괄 rawData 정리 오류:', err));

      return result;
    });

    this.clearCaches();
    return result;
  }

  async getStats() {
    const cacheKey = 'faq:stats';
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const [
      total,
      pending,
      needsReview,
      approved,
      rejected,
      withGuideline,
      withReference,
      categoryCounts,
    ] = await Promise.all([
      this.prisma.faq.count(),
      this.prisma.faq.count({ where: { status: 'pending' } }),
      this.prisma.faq.count({ where: { status: 'needs_review' } }),
      this.prisma.faq.count({ where: { status: 'approved' } }),
      this.prisma.faq.count({ where: { status: 'rejected' } }),
      this.prisma.faq.count({ where: { guideline: { not: null } } }),
      this.prisma.faq.count({ where: { reference: { not: null } } }),
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

    const byStatus: Record<string, number> = {
      pending,
      needs_review: needsReview,
      approved,
      rejected,
    };

    const result = {
      total,
      pending,
      needsReview,
      approved,
      rejected,
      byStatus,
      withGuideline,
      withReference,
      byCategory,
      uncategorized,
    };
    this.cache.set(cacheKey, result, CACHE_TTL.FAQ_STATS);
    return result;
  }

  async getAllTags(): Promise<string[]> {
    const faqs = await this.prisma.faq.findMany({
      where: { status: 'approved' },
      select: { tags: true },
    });
    const tagSet = new Set<string>();
    faqs.forEach((f) => f.tags.forEach((t) => tagSet.add(t)));
    return [...tagSet].sort();
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
        OR: [{ question: { not: { contains: '          ' } } }],
      },
      select: { id: true, question: true },
    });

    const lowQualityIds = lowQuality
      .filter((f) => f.question.trim().length < 10)
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

    this.clearCaches();

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
        status: string;
        category: string | null;
      }>;
      maxSimilarity: number;
    }>;
    totalGroups: number;
  }> {
    const embeddedRows = await this.prisma.$queryRawUnsafe<
      Array<{ id: number }>
    >(
      `SELECT id FROM faqs
       WHERE status IN ('pending', 'approved') AND embedding IS NOT NULL
       ORDER BY id
       LIMIT 3000`,
    );

    const pairs: Array<{ id1: number; id2: number; similarity: number }> = [];

    for (let i = 0; i < embeddedRows.length; i += FAQ_BATCH.DUPLICATE_SCAN) {
      const batchIds = embeddedRows
        .slice(i, i + FAQ_BATCH.DUPLICATE_SCAN)
        .map((r) => r.id);
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
      const ra = find(a),
        rb = find(b);
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
      select: {
        id: true,
        question: true,
        questionKo: true,
        status: true,
        category: true,
      },
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
}
