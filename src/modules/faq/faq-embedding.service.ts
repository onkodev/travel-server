import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { EmbeddingService } from '../ai/core/embedding.service';
import { FAQ_SIMILARITY, FAQ_BATCH } from './faq.constants';

@Injectable()
export class FaqEmbeddingService {
  private readonly logger = new Logger(FaqEmbeddingService.name);

  constructor(
    private prisma: PrismaService,
    private embeddingService: EmbeddingService,
  ) {}

  // ============================================================================
  // Embedding Generation
  // ============================================================================

  async generateAndSaveEmbedding(
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

  async generateBulkEmbeddings(ids: number[]): Promise<void> {
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
    let success = 0;
    let failed = 0;
    let offset = 0;
    let total = 0;

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
        take: FAQ_BATCH.EMBEDDING,
        orderBy: { id: 'asc' },
      });

      if (faqs.length === 0) break;

      total += faqs.length;
      const result = await this.processEmbeddingBatch(faqs);
      success += result.success;
      failed += result.failed;
      offset += FAQ_BATCH.EMBEDDING;
    }

    this.logger.log(
      `임베딩 전체 재생성: ${total}건 중 성공 ${success}, 실패 ${failed}`,
    );
    return { total, success, failed };
  }

  /** 임베딩 배치 처리 (동시 처리) */
  async processEmbeddingBatch(
    faqs: Array<{
      id: number;
      question: string;
      answer: string;
      questionKo: string | null;
      answerKo: string | null;
    }>,
  ): Promise<{ success: number; failed: number }> {
    const CONCURRENCY = FAQ_BATCH.EMBEDDING_CONCURRENCY;
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

  // ============================================================================
  // Similarity Search
  // ============================================================================

  async searchSimilar(query: string, limit = 5, minSimilarity = FAQ_SIMILARITY.MIN_SEARCH) {
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
         AND (1 - (embedding <=> $1::vector)) >= $3
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      vectorStr,
      limit,
      minSimilarity,
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
  // Email rawData Cleanup
  // ============================================================================

  async cleanupEmailRawData(sourceEmailId: string): Promise<void> {
    const activeFaqCount = await this.prisma.faq.count({
      where: {
        sourceEmailId,
        status: { in: ['pending', 'needs_review', 'approved'] },
      },
    });

    if (activeFaqCount === 0) {
      await this.prisma.emailThread.updateMany({
        where: { gmailThreadId: sourceEmailId },
        data: { rawData: Prisma.DbNull },
      });
    }
  }

  async cleanupBulkEmailRawData(faqIds: number[]): Promise<void> {
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

}
