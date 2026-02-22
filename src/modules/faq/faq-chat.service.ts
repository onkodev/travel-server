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

    // 1. 의도 분류 + 유사 FAQ 검색 + 투어 검색 (병렬, 대화 컨텍스트 반영)
    const topFaqCount = chatConfig.topFaqCount ?? 4;
    const tourSearchQuery = this.buildTourSearchQuery(message, history);
    const [intent, similar, relatedTours] = await Promise.all([
      this.classifyIntent(message),
      this.faqEmbeddingService.searchSimilar(message, topFaqCount),
      this.searchOdkTours(tourSearchQuery, 5),
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
    } else if (intent === 'company' && topSimilarity >= FAQ_SIMILARITY.DIRECT_THRESHOLD) {
      responseTier = 'direct';
      answer = similar[0].answer;
    } else if (intent === 'company') {
      const ragResult = await this.generateRagAnswer(message, similar, history);
      if (!ragResult.matched) {
        responseTier = 'no_match';
        const noMatchBuilt = await this.aiPromptService.buildPrompt(PromptKey.FAQ_NO_MATCH_RESPONSE, {});
        answer = chatConfig.noMatchResponse || noMatchBuilt.text;
        const relevantSuggestions = similar.filter((f) => f.similarity >= FAQ_SIMILARITY.SUGGESTION_THRESHOLD);
        if (relevantSuggestions.length > 0) {
          suggestedQuestions = relevantSuggestions.slice(0, 3).map((f) => ({
            id: f.id,
            question: f.question,
          }));
        }
      } else {
        responseTier = 'rag';
        answer = ragResult.answer;
      }
    } else {
      responseTier = 'general';
      answer = await this.generateGeneralTravelAnswer(message, history);
    }

    // 2.5. 투어 추천 보충 (company 인텐트는 제외, 관련 투어가 있을 때만)
    if (intent !== 'company' && (!tourRecommendations || tourRecommendations.length === 0)) {
      if (relatedTours.length > 0) {
        tourRecommendations = mapTours(relatedTours);
      }
    }

    // 3. 매칭된 FAQ 정보
    const noMatch = responseTier === 'no_match';
    const matchedFaqIds = similar.map((f) => f.id);
    const matchedSimilarities = similar.map((f) => f.similarity);

    // 4. 로그 저장 (동기 — chatLogId 반환 필요)
    let chatLogId: number | undefined;
    try {
      const log = await this.prisma.faqChatLog.create({
        data: {
          message,
          answer,
          matchedFaqIds,
          matchedSimilarities,
          topSimilarity: similar.length > 0 ? similar[0].similarity : null,
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

    const filteredSources = similar.filter((f) => f.similarity >= FAQ_SIMILARITY.SOURCE_FILTER);

    return {
      answer,
      sources:
        filteredSources.length > 0
          ? filteredSources.map((f) => ({ question: f.question, id: f.id }))
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
    });
  }

  private async generateGeneralTravelAnswer(
    message: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): Promise<string> {
    const built = await this.aiPromptService.buildPrompt(PromptKey.FAQ_GENERAL_TRAVEL, {});

    return this.geminiCore.callGemini(message, {
      temperature: built.temperature,
      maxOutputTokens: built.maxOutputTokens,
      systemPrompt: built.text,
      history: toGeminiHistory(history),
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
  ): Promise<{ matched: boolean; answer: string }> {
    const faqContext = relevant
      .map((f) => `Q: ${f.question}\nA: ${f.answer}`)
      .join('\n\n');

    const built = await this.aiPromptService.buildPrompt(PromptKey.FAQ_RAG_ANSWER, { faqContext });

    const raw = await this.geminiCore.callGemini(message, {
      temperature: built.temperature,
      maxOutputTokens: built.maxOutputTokens,
      systemPrompt: built.text,
      history: toGeminiHistory(history),
      disableThinking: true,
    });

    // JSON 파싱 시도 → 실패 시 기존 텍스트 방식 폴백
    try {
      const cleaned = raw.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      if (typeof parsed.matched === 'boolean') {
        return { matched: parsed.matched, answer: parsed.answer || '' };
      }
    } catch {
      this.logger.warn('RAG JSON 파싱 실패, 텍스트 폴백:', raw.slice(0, 100));
    }

    if (raw.startsWith('[NO_MATCH]')) {
      return { matched: false, answer: '' };
    }
    return { matched: true, answer: raw };
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
    const similar = await this.faqEmbeddingService.searchSimilar(log.message, 10);
    const remaining = similar.filter((f) => !excludeIds.includes(f.id));

    if (remaining.length === 0) {
      throw new NotFoundException('더 이상 유사한 FAQ가 없습니다');
    }

    const topFaqs = remaining.slice(0, 4);
    const ragResult = await this.generateRagAnswer(log.message, topFaqs);

    const answer = ragResult.matched
      ? ragResult.answer
      : topFaqs[0].answer;

    const newMatchedFaqIds = [...excludeIds, ...topFaqs.map((f) => f.id)];
    const newMatchedSimilarities = topFaqs.map((f) => f.similarity);

    let newChatLogId: number;
    try {
      const newLog = await this.prisma.faqChatLog.create({
        data: {
          message: log.message,
          answer,
          matchedFaqIds: newMatchedFaqIds,
          matchedSimilarities: newMatchedSimilarities,
          topSimilarity: topFaqs.length > 0 ? topFaqs[0].similarity : null,
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

    const nextRemaining = similar.filter((f) => !newMatchedFaqIds.includes(f.id));
    const filteredSources = topFaqs.filter((f) => f.similarity >= 0.4);

    return {
      answer,
      sources:
        filteredSources.length > 0
          ? filteredSources.map((f) => ({ question: f.question, id: f.id }))
          : undefined,
      chatLogId: newChatLogId,
      hasMore: nextRemaining.length > 0,
    };
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
