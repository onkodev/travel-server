import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GeminiCoreService } from '../ai/core/gemini-core.service';
import { AiPromptService } from '../ai-prompt/ai-prompt.service';
import { PromptKey } from '../ai-prompt/prompt-registry';
import { FAQ_BATCH } from './faq.constants';
import { FaqEmbeddingService } from './faq-embedding.service';

@Injectable()
export class FaqReviewService {
  private readonly logger = new Logger(FaqReviewService.name);

  constructor(
    private prisma: PrismaService,
    private geminiCore: GeminiCoreService,
    private aiPromptService: AiPromptService,
    private faqEmbeddingService: FaqEmbeddingService,
  ) {}

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

    this.logger.log(
      `자동 리뷰 시작 (batchSize=${batchSize}, dryRun=${dryRun})`,
    );

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
      return {
        total: 0,
        approved: 0,
        rejected: 0,
        needsReview: 0,
        failed: 0,
        remaining: 0,
        dryRun,
      };
    }

    // Step 2: 룰 기반 사전 필터
    const { autoReject, autoReview, geminiCandidates } =
      this.preFilterFaqs(pendingFaqs);

    let approved = 0;
    let rejected = 0;
    let needsReview = 0;
    let failed = 0;
    const dryRunDetails: Array<{
      id: number;
      decision: string;
      reason: string;
    }> = [];

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
            .update({
              where: { id },
              data: { rejectionReason: `[Rule] ${reason}` },
            })
            .catch(() => {});
        }
        this.faqEmbeddingService
          .cleanupBulkEmailRawData(rejectIds)
          .catch((err) => this.logger.error('룰 거절 rawData 정리 실패:', err));
      }
    }

    // Step 4: 룰 기반 자동 review (보류) 처리 → needs_review status로 변경
    if (autoReview.length > 0) {
      needsReview += autoReview.length;
      if (dryRun) {
        autoReview.forEach((r) => dryRunDetails.push(r));
      } else {
        const reviewIds = autoReview.map((r) => r.id);
        await this.prisma.faq.updateMany({
          where: { id: { in: reviewIds } },
          data: { status: 'needs_review' },
        });
        for (const { id, reason } of autoReview) {
          this.prisma.faq
            .update({
              where: { id },
              data: { rejectionReason: `[Rule] ${reason}` },
            })
            .catch(() => {});
        }
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
        const reviewIds: number[] = [];
        const rejectReasons = new Map<number, string>();
        const reviewReasons = new Map<number, string>();

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
            reviewIds.push(id);
            reviewReasons.set(id, reason);
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
            this.faqEmbeddingService
              .generateBulkEmbeddings(approveIds)
              .catch((err) =>
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
                .update({
                  where: { id: faqId },
                  data: { rejectionReason: reason },
                })
                .catch(() => {});
            }
            this.faqEmbeddingService
              .cleanupBulkEmailRawData(rejectIds)
              .catch((err) =>
                this.logger.error('자동 거절 rawData 정리 실패:', err),
              );
          }

          if (reviewIds.length > 0) {
            await this.prisma.faq.updateMany({
              where: { id: { in: reviewIds } },
              data: { status: 'needs_review' },
            });
            for (const [faqId, reason] of reviewReasons) {
              this.prisma.faq
                .update({
                  where: { id: faqId },
                  data: { rejectionReason: `[AI] ${reason}` },
                })
                .catch(() => {});
            }
          }
        }
      } catch (error) {
        this.logger.error('자동 리뷰 Gemini 배치 실패:', error);
        failed += geminiCandidates.length;
      }
    }

    // Step 6: 남은 pending 수 조회
    const remaining = await this.prisma.faq.count({
      where: { status: 'pending' },
    });

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
    const GREETING_PATTERN =
      /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|bye|good|sure|great|nice|wow|cool|haha|lol|hmm)\b/i;
    const INCOMPLETE_ANSWER_PATTERN =
      /\b(I'll check|Let me get back|I will confirm|I'll get back|I will check|I'll confirm|let me check|let me confirm|I need to check|I will get back)\b/i;
    const PERSONAL_QUESTION_PATTERN =
      /\b(my tour|my guide|my booking|my pickup|my reservation|my itinerary|my schedule|my hotel|my flight|my driver|my transfer)\b/i;
    const SPECIFIC_DATE_PATTERN =
      /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}\b/i;
    const YEAR_PATTERN = /\b202[4-9]\b/;
    const PHONE_PATTERN = /(\+82|010[-.\s]?\d{4})/;
    const CUSTOMER_NAME_PATTERN = /\b(Mr\.|Mrs\.|Ms\.|Miss)\s+[A-Z]/;

    const autoReject: Array<{ id: number; decision: string; reason: string }> =
      [];
    const autoReview: Array<{ id: number; decision: string; reason: string }> =
      [];
    const geminiCandidates: typeof faqs = [];

    for (const faq of faqs) {
      const q = faq.question.trim();
      const a = faq.answer.trim();

      // 자동 REJECT 룰
      if (a.length < 20) {
        autoReject.push({
          id: faq.id,
          decision: 'reject',
          reason: 'Answer too short (< 20 chars)',
        });
        continue;
      }

      if (GREETING_PATTERN.test(q)) {
        autoReject.push({
          id: faq.id,
          decision: 'reject',
          reason: 'Question is greeting/acknowledgment',
        });
        continue;
      }

      if (INCOMPLETE_ANSWER_PATTERN.test(a)) {
        autoReject.push({
          id: faq.id,
          decision: 'reject',
          reason: 'Answer is incomplete/deferred response',
        });
        continue;
      }

      if (PERSONAL_QUESTION_PATTERN.test(q)) {
        autoReject.push({
          id: faq.id,
          decision: 'reject',
          reason: 'Personal/customer-specific question',
        });
        continue;
      }

      // 자동 REVIEW 룰
      if (SPECIFIC_DATE_PATTERN.test(a) || YEAR_PATTERN.test(a)) {
        autoReview.push({
          id: faq.id,
          decision: 'review',
          reason: 'Contains specific dates — may be outdated',
        });
        continue;
      }

      if (PHONE_PATTERN.test(a)) {
        autoReview.push({
          id: faq.id,
          decision: 'review',
          reason: 'Contains phone number — needs verification',
        });
        continue;
      }

      if (CUSTOMER_NAME_PATTERN.test(a)) {
        autoReview.push({
          id: faq.id,
          decision: 'review',
          reason: 'Contains customer name — needs anonymization',
        });
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
  ): Promise<
    Array<{
      id: number;
      decision: 'approve' | 'reject' | 'review';
      reason: string;
    }>
  > {
    const chunkSize = FAQ_BATCH.GEMINI_REVIEW_CHUNK;
    const allResults: Array<{
      id: number;
      decision: 'approve' | 'reject' | 'review';
      reason: string;
    }> = [];

    for (let i = 0; i < faqs.length; i += chunkSize) {
      const chunk = faqs.slice(i, i + chunkSize);
      const chunkResults = await this.reviewChunkWithGemini(chunk);
      allResults.push(...chunkResults);
    }

    return allResults;
  }

  private async reviewChunkWithGemini(
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
  ): Promise<
    Array<{
      id: number;
      decision: 'approve' | 'reject' | 'review';
      reason: string;
    }>
  > {
    const faqListText = faqs
      .map((f) => {
        const q = f.question;
        const a =
          f.answer.length > 300 ? f.answer.substring(0, 300) + '...' : f.answer;
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

    let jsonStr = result
      .replace(/```json?\n?/g, '')
      .replace(/```/g, '')
      .trim();

    this.logger.log(
      `Gemini raw (${faqs.length}건, first 300): ${jsonStr.substring(0, 300)}`,
    );

    // 잘린 JSON 배열 복구 시도
    if (jsonStr.startsWith('[') && !jsonStr.endsWith(']')) {
      const lastComplete = jsonStr.lastIndexOf('}');
      if (lastComplete > 0) {
        jsonStr = jsonStr.substring(0, lastComplete + 1) + ']';
        this.logger.warn('잘린 JSON 배열 복구 시도');
      }
    }

    let parsed: Array<{
      id: number | string;
      decision: string;
      confidence?: number;
      reason: string;
    }>;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (parseErr) {
      this.logger.error(`JSON parse 실패: ${(parseErr as Error).message}`);
      this.logger.error(`Raw: ${jsonStr.substring(0, 500)}`);
      return [];
    }

    this.logger.log(
      `Parsed ${parsed.length}건, 첫 항목: ${JSON.stringify(parsed[0])}`,
    );

    const validDecisions = new Set(['approve', 'reject', 'review']);
    const validIds = new Set(faqs.map((f) => f.id));

    const filtered = parsed
      .filter((r) => {
        const numId = Number(r.id);
        return (
          !isNaN(numId) &&
          validIds.has(numId) &&
          validDecisions.has(r.decision.toLowerCase())
        );
      })
      .map((r) => {
        let decision = r.decision.toLowerCase() as
          | 'approve'
          | 'reject'
          | 'review';
        const confidence = typeof r.confidence === 'number' ? r.confidence : 50;

        // confidence < 90인 approve → review로 격하
        if (decision === 'approve' && confidence < 90) {
          this.logger.debug(
            `FAQ #${r.id}: approve → review (confidence ${confidence} < 90)`,
          );
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
}
