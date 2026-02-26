import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GeminiCoreService } from '../ai/core/gemini-core.service';
import { AiPromptService } from '../ai-prompt/ai-prompt.service';
import { PromptKey } from '../ai-prompt/prompt-registry';
import { FAQ_SIMILARITY, FAQ_BATCH } from './faq.constants';
import { FaqEmbeddingService } from './faq-embedding.service';

@Injectable()
export class FaqCategorizeService {
  private readonly logger = new Logger(FaqCategorizeService.name);

  static readonly VALID_CATEGORIES = [
    'general',
    'booking',
    'tour',
    'payment',
    'transportation',
    'accommodation',
    'visa',
    'other',
  ];

  constructor(
    private prisma: PrismaService,
    private geminiCore: GeminiCoreService,
    private aiPromptService: AiPromptService,
    private faqEmbeddingService: FaqEmbeddingService,
  ) {}

  // ============================================================================
  // Auto-Categorization (Embedding-based)
  // ============================================================================

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
    const byCategory = new Map<string, number[]>();

    for (const { id, best_category, similarity } of results) {
      const category =
        similarity < FAQ_SIMILARITY.LOW_CONFIDENCE ? 'other' : best_category;
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

    this.logger.log(
      `자동 분류 완료: 임베딩 ${embeddingsGenerated}건 생성, ${results.length}건 중 ${categorized}건 분류`,
    );
    return { total: results.length, categorized, failed, embeddingsGenerated };
  }

  /** 임베딩 없는 모든 FAQ에 임베딩 생성 */
  async backfillMissingEmbeddings(): Promise<number> {
    let generated = 0;

    while (true) {
      const ids = await this.prisma.$queryRawUnsafe<Array<{ id: number }>>(
        `SELECT id FROM faqs WHERE embedding IS NULL ORDER BY id LIMIT $1`,
        FAQ_BATCH.BACKFILL,
      );

      if (ids.length === 0) break;

      const faqs = await this.prisma.faq.findMany({
        where: { id: { in: ids.map((r) => r.id) } },
        select: {
          id: true,
          question: true,
          questionKo: true,
        },
      });

      const result = await this.faqEmbeddingService.processEmbeddingBatch(faqs);
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
      select: {
        id: true,
        question: true,
        questionKo: true,
      },
      orderBy: { id: 'asc' },
    });

    if (uncategorized.length === 0) {
      return { total: 0, categorized: 0, failed: 0 };
    }

    let categorized = 0;
    let failed = 0;

    for (
      let i = 0;
      i < uncategorized.length;
      i += FAQ_BATCH.GEMINI_CATEGORIZE
    ) {
      const batch = uncategorized.slice(i, i + FAQ_BATCH.GEMINI_CATEGORIZE);
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

    this.logger.log(
      `Gemini 자동 분류: ${uncategorized.length}건 중 ${categorized}건 성공, ${failed}건 실패`,
    );
    return { total: uncategorized.length, categorized, failed };
  }

  private async classifyBatchCategories(
    faqs: Array<{
      id: number;
      question: string;
      questionKo: string | null;
    }>,
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

    const jsonStr = result
      .replace(/```json?\n?/g, '')
      .replace(/```/g, '')
      .trim();

    let parsed: Array<{ id: number; category: string }>;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      this.logger.error(`카테고리 분류 JSON 파싱 실패: ${jsonStr.substring(0, 200)}`, e);
      return [];
    }

    const validSet = new Set(FaqCategorizeService.VALID_CATEGORIES);

    return parsed
      .filter((r) => validSet.has(r.category))
      .map((r) => ({ id: r.id, category: r.category }));
  }
}
