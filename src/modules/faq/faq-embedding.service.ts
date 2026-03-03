import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { EmbeddingService } from '../ai/core/embedding.service';
import { GeminiCoreService } from '../ai/core/gemini-core.service';
import { FAQ_SIMILARITY, FAQ_BATCH } from './faq.constants';

@Injectable()
export class FaqEmbeddingService {
  private readonly logger = new Logger(FaqEmbeddingService.name);

  constructor(
    private prisma: PrismaService,
    private embeddingService: EmbeddingService,
    private geminiCore: GeminiCoreService,
  ) {}

  // ============================================================================
  // Embedding Generation
  // ============================================================================

  async generateAndSaveEmbedding(
    faqId: number,
    question: string,
    questionKo?: string | null,
  ): Promise<void> {
    try {
      const faq = await this.prisma.faq.findUnique({
        where: { id: faqId },
        select: { alternativeQuestions: true },
      });

      // variant 배열 구성
      const variants: Array<{ variant: string; text: string }> = [
        { variant: 'primary', text: question },
      ];

      if (questionKo) {
        variants.push({ variant: 'primary_ko', text: questionKo });
      }

      const alts = faq?.alternativeQuestions || [];
      alts.forEach((alt, i) => {
        variants.push({ variant: `alternative_${i}`, text: alt });
      });

      // 각 variant에 대해 개별 임베딩 생성 (순차 처리, rate limit 안전)
      let primaryEmbedding: number[] | null = null;
      const validVariants: string[] = [];

      for (const { variant, text } of variants) {
        const embedding = await this.embeddingService.generateEmbedding(text);
        if (!embedding) {
          this.logger.warn(
            `FAQ #${faqId} variant "${variant}" 임베딩 생성 실패`,
          );
          continue;
        }

        const vectorStr = `[${embedding.join(',')}]`;

        await this.prisma.$executeRawUnsafe(
          `INSERT INTO faq_question_embeddings (faq_id, variant, question, embedding)
           VALUES ($1, $2, $3, $4::vector)
           ON CONFLICT (faq_id, variant) DO UPDATE
           SET question = EXCLUDED.question, embedding = EXCLUDED.embedding, created_at = NOW()`,
          faqId,
          variant,
          text,
          vectorStr,
        );

        validVariants.push(variant);

        if (variant === 'primary') {
          primaryEmbedding = embedding;
        }
      }

      // faqs.embedding = primary 임베딩 (scanDuplicates 호환용 유지)
      if (primaryEmbedding) {
        const primaryText = this.embeddingService.buildFaqText(
          question,
          questionKo,
        );
        await this.prisma.$executeRawUnsafe(
          `UPDATE faqs SET embedding = $1::vector, embedded_at = NOW(), embedding_text = $3 WHERE id = $2`,
          `[${primaryEmbedding.join(',')}]`,
          faqId,
          primaryText,
        );
      }

      // stale variants 삭제 (variant 수가 줄어든 경우)
      if (validVariants.length > 0) {
        await this.prisma.$executeRawUnsafe(
          `DELETE FROM faq_question_embeddings
           WHERE faq_id = $1 AND variant != ALL($2::varchar[])`,
          faqId,
          validVariants,
        );
      }
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
        questionKo: true,
      },
    });

    const { failed } = await this.processEmbeddingBatch(faqs);

    if (failed > 0) {
      this.logger.warn(`일괄 임베딩: ${faqs.length}건 중 ${failed}건 실패`);
    } else {
      this.logger.log(`일괄 임베딩: ${faqs.length}건 완료`);
    }
  }

  async regenerateAllEmbeddings(options?: {
    regenerateAlternatives?: boolean;
  }): Promise<{
    total: number;
    success: number;
    failed: number;
    message: string;
  }> {
    const regenerateAlts = options?.regenerateAlternatives ?? false;
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
          questionKo: true,
          alternativeQuestions: true,
          guideline: true,
          reference: true,
          tags: true,
        },
        skip: offset,
        take: FAQ_BATCH.EMBEDDING,
        orderBy: { id: 'asc' },
      });

      if (faqs.length === 0) break;

      // 대안 질문이 없거나 강제 재생성 시 LLM으로 생성
      for (const faq of faqs) {
        const needsAltGen =
          regenerateAlts || !faq.alternativeQuestions.length;
        if (needsAltGen) {
          try {
            const alts = await this.generateAlternativeQuestions(
              faq.question,
              faq.guideline,
            );
            if (alts.length > 0) {
              await this.prisma.faq.update({
                where: { id: faq.id },
                data: { alternativeQuestions: alts },
              });
              faq.alternativeQuestions = alts;
            }
          } catch (error) {
            this.logger.warn(
              `FAQ #${faq.id} 대안 질문 생성 실패:`,
              error,
            );
          }
        }
      }

      total += faqs.length;
      const result = await this.processEmbeddingBatch(faqs);
      success += result.success;
      failed += result.failed;
      offset += FAQ_BATCH.EMBEDDING;
    }

    const message = `${total}개 FAQ 임베딩 완료 (${failed}개 실패)`;
    this.logger.log(
      `임베딩 전체 재생성: ${total}건 중 성공 ${success}, 실패 ${failed}`,
    );
    return { total, success, failed, message };
  }

  /**
   * 승인된 FAQ 중 임베딩이 없는 항목만 찾아 임베딩 생성
   * (동기화 완료 후 자동 호출용)
   */
  async syncMissingEmbeddings(): Promise<{
    total: number;
    success: number;
    failed: number;
  }> {
    const unembedded = await this.prisma.$queryRawUnsafe<
      Array<{ id: number; question: string; question_ko: string | null }>
    >(
      `SELECT f.id, f.question, f.question_ko FROM faqs f
       WHERE f.status = 'approved'
         AND NOT EXISTS (
           SELECT 1 FROM faq_question_embeddings qe
           WHERE qe.faq_id = f.id AND qe.variant = 'primary'
         )
       ORDER BY f.id ASC`,
    );

    if (unembedded.length === 0) {
      return { total: 0, success: 0, failed: 0 };
    }

    const faqs = unembedded.map((f) => ({
      id: f.id,
      question: f.question,
      questionKo: f.question_ko,
    }));

    const { success, failed } = await this.processEmbeddingBatch(faqs);

    this.logger.log(
      `미임베딩 FAQ 동기화: ${faqs.length}건 중 성공 ${success}, 실패 ${failed}`,
    );

    return { total: faqs.length, success, failed };
  }

  /** 임베딩 배치 처리 (동시 처리) */
  async processEmbeddingBatch(
    faqs: Array<{
      id: number;
      question: string;
      questionKo: string | null;
    }>,
  ): Promise<{ success: number; failed: number }> {
    const CONCURRENCY = FAQ_BATCH.EMBEDDING_CONCURRENCY;
    let success = 0;
    let failed = 0;

    for (let i = 0; i < faqs.length; i += CONCURRENCY) {
      const batch = faqs.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((faq) =>
          this.generateAndSaveEmbedding(faq.id, faq.question, faq.questionKo),
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
  // Alternative Questions Generation
  // ============================================================================

  async generateAlternativeQuestions(
    question: string,
    guideline?: string | null,
  ): Promise<string[]> {
    const contextPart = guideline
      ? `\nContext (if available): "${guideline}"`
      : '';

    const prompt = `Given the following FAQ question, generate 5-8 alternative ways a customer might ask the same question.
Consider different phrasings, synonyms, and varying levels of formality.
Include both direct and indirect ways of asking.

FAQ Question: "${question}"${contextPart}

Return ONLY a JSON array of strings, no explanation.
Example: ["Can I cancel my booking?", "How do I get a refund?"]`;

    const result = await this.geminiCore.callGemini(prompt, {
      temperature: 0.7,
      maxOutputTokens: 1024,
      disableThinking: true,
    });

    try {
      const jsonStr = result
        .replace(/```json?\n?/g, '')
        .replace(/```/g, '')
        .trim();
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed)) {
        return parsed.filter((q: unknown) => typeof q === 'string');
      }
    } catch {
      this.logger.warn(`대안 질문 JSON 파싱 실패: ${result.slice(0, 200)}`);
    }
    return [];
  }

  // ============================================================================
  // Embedding Status
  // ============================================================================

  async getEmbeddingStatus(): Promise<{
    totalFaqs: number;
    embeddedFaqs: number;
    unembeddedFaqs: number;
    lastEmbeddedAt: string | null;
  }> {
    const stats = await this.prisma.$queryRawUnsafe<
      Array<{
        total_faqs: bigint;
        embedded_faqs: bigint;
        last_embedded_at: Date | null;
      }>
    >(
      `SELECT
        COUNT(*) FILTER (WHERE status = 'approved') as total_faqs,
        COUNT(*) FILTER (WHERE status = 'approved' AND embedded_at IS NOT NULL) as embedded_faqs,
        MAX(embedded_at) as last_embedded_at
      FROM faqs`,
    );

    const row = stats[0];
    const totalFaqs = Number(row.total_faqs);
    const embeddedFaqs = Number(row.embedded_faqs);

    return {
      totalFaqs,
      embeddedFaqs,
      unembeddedFaqs: totalFaqs - embeddedFaqs,
      lastEmbeddedAt: row.last_embedded_at?.toISOString() || null,
    };
  }

  // ============================================================================
  // Similarity Search
  // ============================================================================

  async searchSimilar(
    query: string,
    limit = 5,
    minSimilarity: number = FAQ_SIMILARITY.MIN_SEARCH,
  ) {
    const embedding = await this.embeddingService.generateEmbedding(query);

    if (!embedding) {
      return [];
    }

    const vectorStr = `[${embedding.join(',')}]`;

    const results = await this.prisma.$queryRawUnsafe<
      Array<{
        id: number;
        question: string;
        tags: string[];
        guideline: string | null;
        reference: string | null;
        similarity: number;
      }>
    >(
      `SELECT f.id, f.question, f.tags, f.guideline, f.reference,
              MAX(1 - (qe.embedding <=> $1::vector)) AS similarity
       FROM faq_question_embeddings qe
       JOIN faqs f ON f.id = qe.faq_id
       WHERE f.status = 'approved'
       GROUP BY f.id, f.question, f.tags, f.guideline, f.reference
       HAVING MAX(1 - (qe.embedding <=> $1::vector)) >= $3
       ORDER BY MAX(qe.embedding <=> $1::vector) ASC
       LIMIT $2`,
      vectorStr,
      limit,
      minSimilarity,
    );

    return results.map((r) => ({
      id: r.id,
      question: r.question,
      tags: r.tags,
      guideline: r.guideline,
      reference: r.reference,
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
      `SELECT f.id, f.question, f.question_ko, f.status,
              MAX(1 - (qe.embedding <=> $1::vector)) AS similarity
       FROM faq_question_embeddings qe
       JOIN faqs f ON f.id = qe.faq_id
       WHERE f.status IN ('pending', 'approved')
       GROUP BY f.id, f.question, f.question_ko, f.status
       ORDER BY MAX(qe.embedding <=> $1::vector) ASC
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
