import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmbeddingService } from '../ai/core/embedding.service';
import { GeminiCoreService } from '../ai/core/gemini-core.service';
import { AiPromptService } from '../ai-prompt/ai-prompt.service';
import { PromptKey } from '../ai-prompt/prompt-registry';
import { FaqEmbeddingService } from './faq-embedding.service';
import { FAQ_SIMILARITY, toGeminiHistory } from './faq.constants';

@Injectable()
export class FaqChatService {
  private readonly logger = new Logger(FaqChatService.name);

  constructor(
    private prisma: PrismaService,
    private embeddingService: EmbeddingService,
    private geminiCore: GeminiCoreService,
    private aiPromptService: AiPromptService,
    private faqEmbeddingService: FaqEmbeddingService,
  ) {}

  // ============================================================================
  // FAQ Chat (AI) — 하이브리드 응답 전략
  // ============================================================================

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
      rating: number | null;
      reviewCount: number | null;
    }>;
    chatLogId?: number;
  }> {
    // 0. FaqChatConfig 로드
    const chatConfig = await this.aiPromptService.getFaqChatConfig();

    // 1. 의도 분류 + 유사 FAQ 검색 + 제안 질문 + 투어 검색 (병렬)
    const tourSearchQuery = this.buildTourSearchQuery(message, history);
    const [intent, suggestions, relatedTours] = await Promise.all([
      this.classifyIntent(message),
      this.faqEmbeddingService.searchSimilar(
        message,
        3,
        FAQ_SIMILARITY.SUGGESTION_THRESHOLD,
      ),
      this.searchOdkTours(tourSearchQuery, 5),
    ]);
    const topFaq = suggestions.length > 0 && suggestions[0].similarity >= FAQ_SIMILARITY.MIN_SEARCH ? suggestions[0] : null;
    const topSimilarity = topFaq?.similarity ?? 0;

    this.logger.debug(
      `Intent: ${intent}, topSim: ${topSimilarity.toFixed(2)} for: "${message.substring(0, 50)}..."`,
    );

    // 2. 하이브리드 분기
    let answer: string;
    let responseTier:
      | 'direct'
      | 'rag'
      | 'general'
      | 'tour_recommend'
      | 'no_match';
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
          rating: number | null;
          reviewCount: number | null;
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
        rating: t.rating,
        reviewCount: t.reviewCount,
      }));

    if (intent === 'tour_recommend') {
      if (relatedTours.length > 0) {
        responseTier = 'tour_recommend';
        answer = await this.generateTourRecommendationAnswer(
          message,
          relatedTours,
          history,
        );
        tourRecommendations = mapTours(relatedTours);
      } else {
        responseTier = 'general';
        answer = await this.generateGeneralTravelAnswer(message, history);
      }
    } else if (
      intent === 'company' &&
      topFaq &&
      topSimilarity >= FAQ_SIMILARITY.DIRECT_THRESHOLD
    ) {
      // 단일 FAQ 매칭 → 가이드라인 기반 답변 생성
      responseTier = 'rag';
      answer = await this.generateGuidelineAnswer(message, topFaq, history);
    } else if (intent === 'company') {
      // 유사도 낮음 → no_match + 제안 질문
      responseTier = 'no_match';
      const noMatchBuilt = await this.aiPromptService.buildPrompt(
        PromptKey.FAQ_NO_MATCH_RESPONSE,
        {},
      );
      answer = chatConfig.noMatchResponse || noMatchBuilt.text;
      const relevantSuggestions = suggestions.filter(
        (f) => f.similarity >= FAQ_SIMILARITY.SUGGESTION_THRESHOLD,
      );
      if (relevantSuggestions.length > 0) {
        suggestedQuestions = relevantSuggestions.slice(0, 3).map((f) => ({
          id: f.id,
          question: f.question,
        }));
      }
    } else {
      responseTier = 'general';
      answer = await this.generateGeneralTravelAnswer(message, history);
    }

    // 2.5. 투어 추천 보충 (company 인텐트는 제외, 관련 투어가 있을 때만)
    if (
      intent !== 'company' &&
      (!tourRecommendations || tourRecommendations.length === 0)
    ) {
      if (relatedTours.length > 0) {
        tourRecommendations = mapTours(relatedTours);
      }
    }

    // 3. 매칭된 FAQ 정보
    const noMatch = responseTier === 'no_match';
    const matchedFaqIds = topFaq ? [topFaq.id] : [];
    const matchedSimilarities = topFaq ? [topFaq.similarity] : [];

    // 4. 로그 저장 (동기 — chatLogId 반환 필요)
    let chatLogId: number | undefined;
    try {
      const log = await this.prisma.faqChatLog.create({
        data: {
          message,
          answer,
          matchedFaqIds,
          matchedSimilarities,
          topSimilarity: topFaq ? topFaq.similarity : null,
          noMatch,
          responseTier,
          visitorId: meta?.visitorId || null,
        },
        select: { id: true },
      });
      chatLogId = log.id;
    } catch (err) {
      this.logger.error('FAQ 채팅 로그 저장 실패:', err);
    }

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
        topFaq && topFaq.similarity >= FAQ_SIMILARITY.SOURCE_FILTER
          ? [{ question: topFaq.question, id: topFaq.id }]
          : undefined,
      noMatch,
      responseTier,
      suggestedQuestions,
      tourRecommendations,
      chatLogId,
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
        disableThinking: true,
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

  private buildTourSearchQuery(
    message: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): string {
    if (!history || history.length === 0) return message;

    const recentUserMessages = history
      .filter((h) => h.role === 'user')
      .slice(-3)
      .map((h) => h.content.substring(0, 100));

    if (recentUserMessages.length === 0) return message;

    return `${message} Context: ${recentUserMessages.join(' ')}`;
  }

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
        rating: number | null;
        review_count: number | null;
        similarity: number;
      }>
    >(
      `SELECT id, name, name_kor, description, thumbnail_url, website_url, price, region, duration,
              rating, review_count,
              1 - (embedding <=> $1::vector) as similarity
       FROM odk_tours
       WHERE is_active = true AND embedding IS NOT NULL
         AND (1 - (embedding <=> $1::vector)) >= ${FAQ_SIMILARITY.TOUR_SEARCH}
       ORDER BY sort_order DESC, embedding <=> $1::vector ASC
       LIMIT $2`,
      vectorStr,
      limit,
    );

    return results.map((r) => ({
      id: r.id,
      name: r.name,
      nameKor: r.name_kor,
      description: r.description,
      thumbnailUrl: r.thumbnail_url,
      websiteUrl: r.website_url,
      price: r.price ? Number(r.price) : null,
      region: r.region,
      duration: r.duration,
      rating: r.rating,
      reviewCount: r.review_count,
      similarity: Number(r.similarity),
    }));
  }

  private async generateTourRecommendationAnswer(
    message: string,
    tours: Array<{
      name: string;
      price: number | null;
      region: string | null;
      duration: string | null;
      rating?: number | null;
      reviewCount?: number | null;
    }>,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): Promise<string> {
    const tourInfo = tours
      .map(
        (t, i) =>
          `${i + 1}. ${t.name} — Region: ${t.region || 'Seoul'}, Duration: ${t.duration || 'Full day'}${t.price ? `, From $${t.price}` : ''}${t.rating ? ` ⭐ ${t.rating}/5 (${t.reviewCount || 0} reviews)` : ''}`,
      )
      .join('\n');

    const built = await this.aiPromptService.buildPrompt(
      PromptKey.FAQ_TOUR_RECOMMENDATION,
      { tourInfo },
    );

    return this.geminiCore.callGemini(message, {
      temperature: built.temperature,
      maxOutputTokens: built.maxOutputTokens,
      systemPrompt: built.text,
      history: toGeminiHistory(history),
      disableThinking: true,
    });
  }

  private async generateGeneralTravelAnswer(
    message: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): Promise<string> {
    const built = await this.aiPromptService.buildPrompt(
      PromptKey.FAQ_GENERAL_TRAVEL,
      {},
    );

    return this.geminiCore.callGemini(message, {
      temperature: built.temperature,
      maxOutputTokens: built.maxOutputTokens,
      systemPrompt: built.text,
      history: toGeminiHistory(history),
      disableThinking: true,
    });
  }

  private async generateGuidelineAnswer(
    message: string,
    faq: {
      question: string;
      guideline?: string | null;
      reference?: string | null;
    },
    history?: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): Promise<string> {
    const parts: string[] = [];
    if (faq.guideline)
      parts.push(`=== Guideline ===\n${faq.guideline}\n=== End Guideline ===`);
    if (faq.reference)
      parts.push(`=== Reference ===\n${faq.reference}\n=== End Reference ===`);
    const faqGuideline = parts.length > 0 ? `\n${parts.join('\n')}` : '';

    const built = await this.aiPromptService.buildPrompt(
      PromptKey.FAQ_GUIDELINE_ANSWER,
      {
        faqQuestion: faq.question,
        faqGuideline,
      },
    );

    return this.geminiCore.callGemini(message, {
      temperature: built.temperature,
      maxOutputTokens: built.maxOutputTokens,
      systemPrompt: built.text,
      history: toGeminiHistory(history),
      disableThinking: true,
    });
  }

  /**
   * FAQ 답변 재생성 (다른 유사 FAQ 기반)
   */
  async regenerateAnswer(chatLogId: number): Promise<{
    answer: string;
    sources?: Array<{ question: string; id: number }>;
    chatLogId: number;
    hasMore: boolean;
  }> {
    const log = await this.prisma.faqChatLog.findUnique({
      where: { id: chatLogId },
      select: { message: true, matchedFaqIds: true },
    });

    if (!log) {
      throw new NotFoundException('채팅 로그를 찾을 수 없습니다');
    }

    const excludeIds = log.matchedFaqIds;
    const similar = await this.faqEmbeddingService.searchSimilar(
      log.message,
      10,
    );
    const remaining = similar.filter((f) => !excludeIds.includes(f.id));

    if (remaining.length === 0) {
      throw new NotFoundException('더 이상 유사한 FAQ가 없습니다');
    }

    const nextFaq = remaining[0];
    const answer = await this.generateGuidelineAnswer(log.message, nextFaq);

    const newMatchedFaqIds = [...excludeIds, nextFaq.id];
    const newMatchedSimilarities = [nextFaq.similarity];

    let newChatLogId: number;
    try {
      const newLog = await this.prisma.faqChatLog.create({
        data: {
          message: log.message,
          answer,
          matchedFaqIds: newMatchedFaqIds,
          matchedSimilarities: newMatchedSimilarities,
          topSimilarity: nextFaq.similarity,
          noMatch: false,
          responseTier: 'rag',
        },
        select: { id: true },
      });
      newChatLogId = newLog.id;
    } catch (err) {
      this.logger.error('재생성 채팅 로그 저장 실패:', err);
      throw err;
    }

    const nextRemaining = similar.filter(
      (f) => !newMatchedFaqIds.includes(f.id),
    );

    return {
      answer,
      sources:
        nextFaq.similarity >= 0.4
          ? [{ question: nextFaq.question, id: nextFaq.id }]
          : undefined,
      chatLogId: newChatLogId,
      hasMore: nextRemaining.length > 0,
    };
  }

  /**
   * FAQ 가이드라인 기반 AI 답변 생성 (제안 질문 클릭 시 사용)
   * 기존에는 answer 원문을 반환했으나, guideline 기반 AI 생성으로 변경
   */
  async getDirectFaqAnswer(
    faqId: number,
  ): Promise<{ question: string; answer: string }> {
    const faq = await this.prisma.faq.findUnique({
      where: { id: faqId },
      select: {
        id: true,
        question: true,
        guideline: true,
        reference: true,
      },
    });

    if (!faq) {
      throw new NotFoundException('FAQ를 찾을 수 없습니다');
    }

    // viewCount 증가 (fire-and-forget)
    this.prisma.faq
      .update({ where: { id: faqId }, data: { viewCount: { increment: 1 } } })
      .catch((err) => this.logger.error('FAQ viewCount 증가 실패:', err));

    // guideline 기반 AI 답변 생성
    const answer = await this.generateGuidelineAnswer(faq.question, faq);
    return { question: faq.question, answer };
  }

  /**
   * FAQ 챗봇 응답 피드백 (👍/👎)
   */
  async submitFeedback(
    chatLogId: number,
    helpful: boolean,
  ): Promise<{ success: boolean }> {
    const log = await this.prisma.faqChatLog.findUnique({
      where: { id: chatLogId },
      select: { matchedFaqIds: true },
    });

    if (!log) {
      throw new NotFoundException('채팅 로그를 찾을 수 없습니다');
    }

    if (log.matchedFaqIds.length > 0) {
      await this.prisma.faq.updateMany({
        where: { id: { in: log.matchedFaqIds } },
        data: helpful
          ? { helpfulCount: { increment: 1 } }
          : { notHelpfulCount: { increment: 1 } },
      });
    }

    return { success: true };
  }
}
