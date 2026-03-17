import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmbeddingService } from '../ai/core/embedding.service';
import { GeminiCoreService } from '../ai/core/gemini-core.service';
import { AiPromptService } from '../ai-prompt/ai-prompt.service';
import { PromptKey } from '../ai-prompt/prompt-registry';
import { FaqEmbeddingService } from './faq-embedding.service';
import { WooCommerceService, WcOrderData } from '../woocommerce/woocommerce.service';
import { FAQ_SIMILARITY, toGeminiHistory } from './faq.constants';
import { MemoryCache, formatUrlsAsMarkdown, stripMarkdownLinks } from '../../common/utils';

/** 인텐트별 레퍼런스 문장 (임베딩 기반 분류용) */
const INTENT_REFERENCES: Record<string, string[]> = {
  company: [
    'What is your refund policy?',
    'How do I cancel my booking?',
    'Do you offer group discounts?',
    'What payment methods do you accept?',
    'How can I contact customer support?',
    'Is there a minimum number of people required?',
    'Can I change my reservation date?',
    'What is included in the tour price?',
    'Do you provide pickup service?',
    'What are your operating hours?',
  ],
  tour_recommend: [
    'Recommend a tour for me',
    'What are the best day trips from Seoul?',
    'I want to visit Jeju Island, which tour should I take?',
    'Show me popular tours',
    'What tours do you have for families with kids?',
    'I am looking for a food tour in Seoul',
    'Which tour is best for first-time visitors?',
    'Suggest an adventure tour in Korea',
  ],
  travel: [
    'What is the best time to visit Korea?',
    'How do I get from Incheon airport to Seoul?',
    'What should I pack for a trip to Korea?',
    'Is Korea safe for solo travelers?',
    'What are the must-see places in Seoul?',
    'How does the subway system work in Seoul?',
    'What Korean food should I try?',
    'Do I need a visa to visit Korea?',
    'Tell me about Jeju Island',
    'What is there to do in Busan?',
    'What is Gyeongju known for?',
    'Tell me about Korean culture and traditions',
  ],
  order_inquiry: [
    'I want to check my order',
    'What is my order status?',
    'Can I check my booking status?',
    'Order number 12345',
    'I made a payment but need to check',
    'Where is my reservation?',
    'Check my booking',
    'I booked a tour and want to confirm',
    'Can you look up my order?',
    'Payment confirmation',
    'Check my estimate',
    'I want to see my quotation',
    'Estimate number 123',
    'Check estimate status',
    'What is the status of my quotation?',
  ],
};

@Injectable()
export class FaqChatService {
  private readonly logger = new Logger(FaqChatService.name);
  private intentEmbeddings: Map<string, number[][]> | null = null;
  /** 고유사도 FAQ 답변 캐시 (faqId → answer, 30분 TTL) */
  private readonly answerCache = new MemoryCache(30 * 60 * 1000, 100);

  /** FAQ 수정 시 외부에서 답변 캐시 무효화 */
  clearAnswerCache(): void {
    this.answerCache.clear();
  }

  constructor(
    private prisma: PrismaService,
    private embeddingService: EmbeddingService,
    private geminiCore: GeminiCoreService,
    private aiPromptService: AiPromptService,
    private faqEmbeddingService: FaqEmbeddingService,
    private wooCommerceService: WooCommerceService,
  ) {}

  // ============================================================================
  // FAQ Chat (AI) — 하이브리드 응답 전략
  // ============================================================================

  /**
   * Corrective RAG: 회색 지대(0.65~0.85) FAQ 매칭의 실제 관련성 검증
   * @returns true면 RAG 진행, false면 general/no_match로 우회
   */
  private async verifyFaqRelevance(
    userQuestion: string,
    faq: { question: string; guideline?: string | null },
  ): Promise<boolean> {
    try {
      const built = await this.aiPromptService.buildPrompt(
        PromptKey.FAQ_RELEVANCE_GATE,
        {
          userQuestion,
          faqQuestion: faq.question,
          faqGuideline: faq.guideline || 'N/A',
        },
      );

      const result = await this.geminiCore.callGemini(built.text, {
        temperature: built.temperature,
        maxOutputTokens: built.maxOutputTokens,
        disableThinking: true,
      });

      const answer = result.trim().toUpperCase();
      this.logger.debug(
        `Relevance gate: "${userQuestion.substring(0, 40)}" vs FAQ "${faq.question.substring(0, 40)}" → ${answer}`,
      );
      return answer.startsWith('YES');
    } catch (error) {
      // 검증 실패 시 기존 동작(RAG) 유지 — 안전한 폴백
      this.logger.warn('Relevance gate failed, defaulting to RAG:', error);
      return true;
    }
  }

  async chatWithFaq(
    message: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>,
    meta?: { ipAddress?: string; visitorId?: string },
  ): Promise<{
    answer: string;
    sources?: Array<{ question: string; id: number }>;
    noMatch: boolean;
    responseTier: 'direct' | 'rag' | 'general' | 'tour_recommend' | 'no_match' | 'order_inquiry';
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
    orderData?: WcOrderData | WcOrderData[];
  }> {
    // 1. 임베딩 1회 생성 → FAQ 검색 + 투어 검색 + 의도 분류에 재사용
    const queryEmbedding =
      await this.embeddingService.generateEmbedding(message);

    const [intent, suggestions, relatedTours] = await Promise.all([
      this.classifyIntent(message, queryEmbedding),
      this.faqEmbeddingService.searchSimilarByVector(
        queryEmbedding,
        5,
        FAQ_SIMILARITY.SUGGESTION_THRESHOLD,
        message,
      ),
      this.searchOdkToursByVector(queryEmbedding, 5),
    ]);
    const topFaq =
      suggestions.length > 0 &&
      suggestions[0].similarity >= FAQ_SIMILARITY.MIN_SEARCH
        ? suggestions[0]
        : null;
    const topSimilarity = topFaq?.similarity ?? 0;

    this.logger.debug(
      `Intent: ${intent}, topSim: ${topSimilarity.toFixed(2)}, hits: ${suggestions.length} for: "${message.substring(0, 50)}..."`,
    );
    if (suggestions.length > 0) {
      this.logger.debug(
        `Top FAQs: ${suggestions.slice(0, 3).map((f) => `#${f.id}[${f.category}] "${f.question.substring(0, 40)}" sim=${f.similarity.toFixed(3)}`).join(' | ')}`,
      );
    }

    // ── 주문 조회 인텐트: 임베딩 기반 분류 + 패턴 매칭 + 대화 이력 보강 ──
    let orderData: WcOrderData | WcOrderData[] | undefined;
    const isOrderFollowUp = this.isOrderInquiryFollowUp(message, history);
    const isOrderInquiry = intent === 'order_inquiry' || this.detectOrderPattern(message) || isOrderFollowUp;

    if (isOrderInquiry) {
      const result = await this.handleOrderInquiry(message, history);
      if (result) {
        return {
          answer: result.answer,
          noMatch: false,
          responseTier: 'order_inquiry',
          chatLogId: await this.saveOrderChatLog(message, result.answer, meta),
          orderData: result.orderData,
        };
      }
      // 주문번호/이메일 추출 실패 시 되묻기
      const askMessage = "Could you please provide your **order number** or the **email address** you used when booking? I'll look up your order right away!";
      return {
        answer: askMessage,
        noMatch: false,
        responseTier: 'order_inquiry',
        chatLogId: await this.saveOrderChatLog(message, askMessage, meta),
      };
    }

    // 2. 하이브리드 분기
    let answer: string;
    let responseTier:
      | 'direct'
      | 'rag'
      | 'general'
      | 'tour_recommend'
      | 'no_match'
      | 'order_inquiry';
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

    // 멀티 FAQ 컨텍스트 추적 (rag 분기에서 설정)
    let ragContextFaqs: typeof suggestions = [];

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

    // ── 듀얼 스코어 매트릭스: (intent × FAQ 유사도) 조합으로 분기 결정 ──
    let hasFaqMatch =
      topFaq && topSimilarity >= FAQ_SIMILARITY.DIRECT_THRESHOLD;

    // Corrective RAG: 회색 지대(0.65~0.85)에서 관련성 검증
    if (
      hasFaqMatch &&
      topSimilarity < FAQ_SIMILARITY.HIGH_CONFIDENCE
    ) {
      const isRelevant = await this.verifyFaqRelevance(message, topFaq!);
      if (!isRelevant) {
        hasFaqMatch = false;
        this.logger.debug(
          `Relevance gate rejected: "${message.substring(0, 50)}" (sim=${topSimilarity.toFixed(3)})`,
        );
      }
    }

    if (intent === 'tour_recommend') {
      // FAQ 가이드라인이 있으면 투어 추천에 정책 컨텍스트로 전달
      // → LLM이 가이드라인 vs 투어 추천을 자연스럽게 판단
      const faqGuideline =
        hasFaqMatch && topFaq!.guideline ? topFaq!.guideline : null;

      if (relatedTours.length > 0 || faqGuideline) {
        answer = await this.generateTourRecommendationAnswer(
          message,
          relatedTours,
          history,
          faqGuideline,
        );

        // FAQ 가이드라인이 투어 추천을 오버라이드했는지 판별:
        // 가이드라인의 외부 URL이 답변에 포함되면 정책이 적용된 것
        const guidelineUrls =
          faqGuideline?.match(/https?:\/\/[^\s)]+/g) || [];
        const policyApplied = guidelineUrls.some(
          (url) =>
            !url.includes('onedaykorea.com') && answer.includes(url),
        );

        if (policyApplied) {
          responseTier = 'rag';
          ragContextFaqs = [topFaq!];
        } else {
          responseTier = 'tour_recommend';
          tourRecommendations =
            relatedTours.length > 0 ? mapTours(relatedTours) : undefined;
        }
      } else {
        responseTier = 'general';
        answer = await this.generateGeneralTravelAnswer(message, history);
      }
    } else if (hasFaqMatch) {
      // FAQ 고유사도 매칭 (company/travel intent)
      responseTier = 'rag';
      ragContextFaqs = suggestions
        .filter((f) => f.similarity >= FAQ_SIMILARITY.DIRECT_THRESHOLD)
        .slice(0, 3);

      const cacheKey = `faq:${ragContextFaqs
        .map((f) => f.id)
        .sort((a, b) => a - b)
        .join(',')}`;
      const cached =
        topSimilarity >= 0.95 ? this.answerCache.get<string>(cacheKey) : null;
      if (cached) {
        answer = cached;
      } else {
        answer = await this.generateGuidelineAnswer(
          message,
          ragContextFaqs,
          history,
        );
        if (topSimilarity >= 0.95) {
          this.answerCache.set(cacheKey, answer);
        }
      }
    } else if (intent === 'company') {
      // 유사도 낮음 → no_match + 제안 질문
      responseTier = 'no_match';
      const noMatchBuilt = await this.aiPromptService.buildPrompt(
        PromptKey.FAQ_NO_MATCH_RESPONSE,
        {},
      );
      answer = noMatchBuilt.text;
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

    // 2.5. 투어 추천 보충 (rag/company 인텐트는 제외, 관련 투어가 있을 때만)
    if (
      responseTier !== 'rag' &&
      intent !== 'company' &&
      (!tourRecommendations || tourRecommendations.length === 0)
    ) {
      if (relatedTours.length > 0) {
        tourRecommendations = mapTours(relatedTours);
      }
    }

    // 3. 매칭된 FAQ 정보 (멀티 FAQ 컨텍스트 반영)
    const noMatch = responseTier === 'no_match';
    const matchedFaqIds =
      ragContextFaqs.length > 0
        ? ragContextFaqs.map((f) => f.id)
        : topFaq
          ? [topFaq.id]
          : [];
    const matchedSimilarities =
      ragContextFaqs.length > 0
        ? ragContextFaqs.map((f) => f.similarity)
        : topFaq
          ? [topFaq.similarity]
          : [];

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
      answer: formatUrlsAsMarkdown(stripMarkdownLinks(answer)),
      sources:
        ragContextFaqs.length > 0
          ? ragContextFaqs
              .filter((f) => f.similarity >= FAQ_SIMILARITY.SOURCE_FILTER)
              .map((f) => ({ question: f.question, id: f.id }))
          : topFaq && topFaq.similarity >= FAQ_SIMILARITY.SOURCE_FILTER
            ? [{ question: topFaq.question, id: topFaq.id }]
            : undefined,
      noMatch,
      responseTier,
      suggestedQuestions,
      tourRecommendations,
      chatLogId,
      orderData: undefined,
    };
  }

  /**
   * 인텐트별 레퍼런스 임베딩 초기화 (lazy, 1회만 실행)
   */
  private async ensureIntentEmbeddings(): Promise<void> {
    if (this.intentEmbeddings) return;

    const map = new Map<string, number[][]>();

    for (const [intent, sentences] of Object.entries(INTENT_REFERENCES)) {
      const vectors: number[][] = [];
      for (const sentence of sentences) {
        const vec = await this.embeddingService.generateEmbedding(sentence);
        if (vec) vectors.push(vec);
      }
      map.set(intent, vectors);
    }

    this.intentEmbeddings = map;
    this.logger.log(
      `인텐트 레퍼런스 임베딩 초기화 완료: ${[...map.entries()].map(([k, v]) => `${k}=${v.length}`).join(', ')}`,
    );
  }

  /**
   * 의도 분류: 임베딩 cosine similarity 기반 (LLM 호출 없음)
   */
  private async classifyIntent(
    message: string,
    queryEmbedding: number[] | null,
  ): Promise<'company' | 'tour_recommend' | 'travel' | 'order_inquiry'> {
    if (!queryEmbedding) return 'travel';

    try {
      await this.ensureIntentEmbeddings();

      let bestIntent = 'travel';
      let bestScore = -1;

      for (const [intent, vectors] of this.intentEmbeddings!) {
        for (const refVec of vectors) {
          const score = this.cosineSimilarity(queryEmbedding, refVec);
          if (score > bestScore) {
            bestScore = score;
            bestIntent = intent;
          }
        }
      }

      this.logger.debug(
        `Intent classified: ${bestIntent} (score: ${bestScore.toFixed(3)}) for: "${message.substring(0, 50)}"`,
      );

      if (bestIntent === 'company') return 'company';
      if (bestIntent === 'tour_recommend') return 'tour_recommend';
      if (bestIntent === 'order_inquiry') return 'order_inquiry';
      return 'travel';
    } catch (error) {
      this.logger.error(
        'Intent classification failed, defaulting to travel:',
        error,
      );
      return 'travel';
    }
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  private async searchOdkToursByVector(embedding: number[] | null, limit = 5) {
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
    faqGuideline?: string | null,
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

    // FAQ 가이드라인이 있으면 정책 컨텍스트로 시스템 프롬프트에 추가
    let systemPrompt = built.text;
    if (faqGuideline) {
      systemPrompt += `\n\n## Company Policy (MUST follow if applicable)
The following FAQ guideline matched this query. If the guideline contains a redirect, restriction, or alternative service instruction, you MUST follow it instead of recommending tours.
If the guideline is purely informational (e.g., general info about a destination), proceed with tour recommendations normally.

**Interpreting guidelines**: Guidelines are often written as indirect Korean meta-instructions (e.g., "~하라고 안내", "~을 추천", "~버튼을 이용하라고"). Treat ALL such expressions as mandatory actions you MUST perform in your response.

=== FAQ Guideline ===
${faqGuideline}
=== End Guideline ===`;
    }

    return this.geminiCore.callGemini(message, {
      temperature: built.temperature,
      maxOutputTokens: built.maxOutputTokens,
      systemPrompt,
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
    faqs: Array<{
      question: string;
      guideline?: string | null;
      reference?: string | null;
    }>,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): Promise<string> {
    let faqGuideline = '';

    if (faqs.length === 1) {
      // 단일 FAQ — 기존 포맷 유지
      const faq = faqs[0];
      const parts: string[] = [];
      if (faq.guideline)
        parts.push(
          `=== Guideline ===\n${faq.guideline}\n=== End Guideline ===`,
        );
      if (faq.reference)
        parts.push(
          `=== Reference ===\n${faq.reference}\n=== End Reference ===`,
        );
      faqGuideline = parts.length > 0 ? `\n${parts.join('\n')}` : '';
    } else if (faqs.length > 1) {
      // 멀티 FAQ — 각 FAQ 섹션을 번호 매겨 구분
      const sections = faqs.map((faq, i) => {
        const parts: string[] = [`[FAQ ${i + 1}] ${faq.question}`];
        if (faq.guideline) parts.push(`Guideline: ${faq.guideline}`);
        if (faq.reference) parts.push(`Reference: ${faq.reference}`);
        return parts.join('\n');
      });
      faqGuideline = `\n=== Related FAQ Context (${faqs.length} FAQs) ===\n${sections.join('\n---\n')}\n=== End FAQ Context ===`;
    }

    const faqQuestion = faqs.map((f) => f.question).join(' | ');
    const userLanguage = /[\uAC00-\uD7AF]/.test(message) ? 'Korean' : 'English';

    const built = await this.aiPromptService.buildPrompt(
      PromptKey.FAQ_GUIDELINE_ANSWER,
      { faqQuestion, faqGuideline, userLanguage },
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
    const answer = await this.generateGuidelineAnswer(log.message, [nextFaq]);

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
      answer: formatUrlsAsMarkdown(stripMarkdownLinks(answer)),
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
    const answer = await this.generateGuidelineAnswer(faq.question, [faq]);
    return { question: faq.question, answer: formatUrlsAsMarkdown(stripMarkdownLinks(answer)) };
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

  /**
   * 메시지에서 주문번호 또는 이메일 패턴을 감지
   */
  private detectOrderPattern(message: string): boolean {
    // 주문번호 패턴 (4-6자리 숫자 or # 접두사)
    if (/(?:#|order\s*#?\s*|주문\s*번호?\s*#?\s*)?\b\d{4,6}\b/i.test(message)) {
      // 단순 숫자만 있는 경우 맥락도 확인
      const hasOrderContext = /order|booking|check|confirm|status|주문|예약|확인|결제|estimate|quotation|견적/i.test(message);
      if (hasOrderContext) return true;
    }
    // estimate/quotation/견적 패턴 (estimate #123, quotation 123, 견적 123)
    if (/(?:estimate|quotation|견적)\s*#?\s*\d+/i.test(message)) {
      return true;
    }
    // estimate/quotation/견적 키워드 + 숫자 조합
    if (/estimate|quotation|견적/i.test(message) && /\d+/.test(message)) {
      return true;
    }
    // 이메일 + 주문 맥락
    if (/[\w.-]+@[\w.-]+\.\w+/.test(message) && /order|booking|check|confirm|주문|예약|확인|estimate|quotation|견적/i.test(message)) {
      return true;
    }
    return false;
  }

  /**
   * 대화 이력에서 이전 봇 응답이 주문 조회 되묻기였는지 확인
   * → "29450" 같은 단순 숫자/이메일도 주문 조회로 자동 연결
   */
  private isOrderInquiryFollowUp(
    message: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): boolean {
    if (!history || history.length < 2) return false;

    // 현재 메시지에 주문번호(4-6자리) 또는 이메일이 포함되어야 함
    const hasOrderNum = /\b\d{4,6}\b/.test(message);
    const hasEmail = /[\w.-]+@[\w.-]+\.\w+/.test(message);
    if (!hasOrderNum && !hasEmail) return false;

    // 직전 assistant 메시지가 주문번호/이메일을 요청하는 내용인지 확인
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].role === 'assistant') {
        const content = history[i].content.toLowerCase();
        if (
          content.includes('order number') ||
          content.includes('email') ||
          content.includes('주문번호') ||
          content.includes('주문 번호') ||
          content.includes('look up your order')
        ) {
          return true;
        }
        break; // 직전 assistant 메시지만 확인
      }
    }
    return false;
  }

  /**
   * 주문 조회 처리: 메시지에서 주문번호/이메일 추출 → WC API + Tumakr Payment 조회
   */
  private async handleOrderInquiry(
    message: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): Promise<{ answer: string; orderData: WcOrderData | WcOrderData[] } | null> {
    // 1. 주문번호 추출 (4-6자리 숫자) — 현재 메시지 우선, 없으면 이력에서 추출
    let orderNumMatch = message.match(/\b(\d{4,6})\b/);
    // 2. 이메일 추출 — 현재 메시지 우선, 없으면 이력에서 추출
    let emailMatch = message.match(/([\w.-]+@[\w.-]+\.\w+)/);

    // 현재 메시지에서 못 찾으면 대화 이력의 user 메시지에서도 추출 시도
    if (!orderNumMatch && !emailMatch && history?.length) {
      for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].role !== 'user') continue;
        const prevMsg = history[i].content;
        if (!orderNumMatch) {
          orderNumMatch = prevMsg.match(/\b(\d{4,6})\b/);
        }
        if (!emailMatch) {
          emailMatch = prevMsg.match(/([\w.-]+@[\w.-]+\.\w+)/);
        }
        if (orderNumMatch || emailMatch) break;
      }
    }

    let orders: WcOrderData[] = [];

    // estimate/quotation 키워드가 있으면 estimateId로 직접 조회
    const isEstimateQuery = /estimate|quotation|견적/i.test(message) ||
      (history?.some(h => /estimate|quotation|견적/i.test(h.content)) ?? false);

    if (isEstimateQuery && orderNumMatch) {
      const estimateId = parseInt(orderNumMatch[1], 10);
      const estimateOrders = await this.getEstimatePaymentInfo(estimateId);
      if (estimateOrders.length > 0) {
        orders = estimateOrders;
      }
    }

    if (orders.length === 0 && orderNumMatch) {
      const orderId = parseInt(orderNumMatch[1], 10);
      const order = await this.wooCommerceService.getOrderById(orderId);
      if (order) orders = [order];
    }

    if (emailMatch) {
      // WC + Tumakr Payment 병렬 조회
      const [wcOrders, tumakrOrders] = await Promise.all([
        orders.length === 0
          ? this.wooCommerceService.getOrdersByEmail(emailMatch[1])
          : Promise.resolve([]),
        this.getTumakrPaymentsByEmail(emailMatch[1]),
      ]);
      orders = [...orders, ...wcOrders, ...tumakrOrders];
    }

    if (orders.length === 0) return null;

    // Gemini로 자연어 답변 생성
    const orderContext = orders
      .map(o => this.wooCommerceService.formatOrderForContext(o))
      .join('\n---\n');

    const systemPrompt = `You are a helpful customer service assistant for OneDayKorea/Tumakr, a tour company in Korea.
The customer is asking about their order. Below is the order information from our system.
Orders may come from two sources: "OneDayKorea" (our main booking site) and "Tumakr" (custom quotation payments).
Provide a friendly, clear summary of the order status and details.
If there are orders from both sources, present them clearly grouped by source.
Answer in the same language the customer used.
Do NOT reveal sensitive information like IP addresses or full payment details.
Keep your response concise but informative.

=== Order Information ===
${orderContext}
=== End Order Information ===`;

    const answer = await this.geminiCore.callGemini(message, {
      temperature: 0.3,
      maxOutputTokens: 500,
      systemPrompt,
      history: toGeminiHistory(history),
      disableThinking: true,
    });

    return {
      answer,
      orderData: orders.length === 1 ? orders[0] : orders,
    };
  }

  /**
   * 주문 조회 채팅 로그 저장
   */
  private async saveOrderChatLog(
    message: string,
    answer: string,
    meta?: { ipAddress?: string; visitorId?: string },
  ): Promise<number | undefined> {
    try {
      const log = await this.prisma.faqChatLog.create({
        data: {
          message,
          answer,
          matchedFaqIds: [],
          matchedSimilarities: [],
          topSimilarity: null,
          noMatch: false,
          responseTier: 'order_inquiry',
          visitorId: meta?.visitorId || null,
        },
        select: { id: true },
      });
      return log.id;
    } catch (err) {
      this.logger.error('주문 조회 채팅 로그 저장 실패:', err);
      return undefined;
    }
  }

  /**
   * 견적 ID로 직접 결제/견적 정보 조회
   */
  private async getEstimatePaymentInfo(estimateId: number): Promise<WcOrderData[]> {
    try {
      const estimate = await this.prisma.estimate.findUnique({
        where: { id: estimateId },
        select: { id: true, title: true, customerName: true, customerEmail: true, items: true },
      });

      if (!estimate) return [];

      // 해당 견적의 Payment 조회
      const payments = await this.prisma.payment.findMany({
        where: {
          estimateId: estimateId,
          status: { in: ['completed', 'pending', 'refunded'] },
        },
        orderBy: { createdAt: 'desc' },
      });

      const TUMAKR_STATUS_LABELS: Record<string, string> = {
        pending: 'Pending Payment',
        completed: 'Completed',
        failed: 'Failed',
        refunded: 'Refunded',
        cancelled: 'Cancelled',
      };

      if (payments.length === 0) {
        // Payment이 없어도 견적 정보는 반환
        const items = estimate.items as Array<{ name?: string; nameEng?: string; category?: string; quantity?: number; subtotal?: number }> || [];
        return [{
          orderId: estimate.id,
          status: 'pending',
          statusLabel: 'Quotation (No Payment)',
          total: '0',
          currency: 'USD',
          dateCreated: new Date().toISOString(),
          datePaid: null,
          paymentMethod: 'N/A',
          paymentStatus: 'Unpaid',
          customerName: estimate.customerName || '',
          customerEmail: estimate.customerEmail || '',
          items: items.slice(0, 10).map((item) => ({
            name: item.nameEng || item.name || item.category || 'Tour Item',
            quantity: item.quantity || 1,
            total: item.subtotal?.toString() || '0',
          })),
          source: 'tumakr' as const,
        }];
      }

      return payments.map((p) => {
        const items = estimate.items as Array<{ name?: string; nameEng?: string; category?: string; quantity?: number; subtotal?: number }> || [];
        return {
          orderId: estimate.id,
          status: p.status,
          statusLabel: TUMAKR_STATUS_LABELS[p.status] || p.status,
          total: p.amount.toString(),
          currency: p.currency || 'USD',
          dateCreated: p.createdAt.toISOString(),
          datePaid: p.paidAt?.toISOString() || null,
          paymentMethod: p.paymentMethod === 'paypal' ? 'PayPal' : p.paymentMethod,
          paymentStatus: p.paidAt ? 'Paid' : 'Unpaid',
          customerName: estimate.customerName || '',
          customerEmail: p.payerEmail || estimate.customerEmail || '',
          items: items.slice(0, 10).map((item) => ({
            name: item.nameEng || item.name || item.category || 'Tour Item',
            quantity: item.quantity || 1,
            total: item.subtotal?.toString() || '0',
          })),
          source: 'tumakr' as const,
        };
      });
    } catch (error) {
      this.logger.error(`Estimate payment lookup error (estimateId: ${estimateId}):`, error);
      return [];
    }
  }

  /**
   * Tumakr 견적 결제 내역을 이메일로 조회
   */
  private async getTumakrPaymentsByEmail(email: string): Promise<WcOrderData[]> {
    try {
      // 1. payerEmail로 Payment 조회
      const payments = await this.prisma.payment.findMany({
        where: {
          status: { in: ['completed', 'pending', 'refunded'] },
          payerEmail: { equals: email, mode: 'insensitive' },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });

      // 2. customerEmail로 Estimate 조회 후 관련 Payment 추가 조회
      const estimates = await this.prisma.estimate.findMany({
        where: {
          customerEmail: { equals: email, mode: 'insensitive' },
        },
        select: { id: true, title: true, customerName: true, customerEmail: true, items: true },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });

      const existingPaymentEstimateIds = new Set(
        payments.filter((p) => p.estimateId).map((p) => p.estimateId!),
      );
      const estimateIds = estimates.map((e) => e.id);

      // payerEmail이 아닌 estimateId로 연결된 Payment도 조회
      const additionalPayments = estimateIds.length > 0
        ? await this.prisma.payment.findMany({
            where: {
              estimateId: { in: estimateIds },
              id: { notIn: payments.map((p) => p.id) },
              status: { in: ['completed', 'pending', 'refunded'] },
            },
          })
        : [];

      const allPayments = [...payments, ...additionalPayments];

      // Estimate 정보 맵
      const estimateMap = new Map(estimates.map((e) => [e.id, e]));

      // estimateId가 있는 Payment 중 아직 estimate 정보 없는 것도 조회
      const missingEstimateIds = allPayments
        .filter((p) => p.estimateId && !estimateMap.has(p.estimateId))
        .map((p) => p.estimateId!);

      if (missingEstimateIds.length > 0) {
        const missingEstimates = await this.prisma.estimate.findMany({
          where: { id: { in: missingEstimateIds } },
          select: { id: true, title: true, customerName: true, customerEmail: true, items: true },
        });
        for (const e of missingEstimates) {
          estimateMap.set(e.id, e);
        }
      }

      const TUMAKR_STATUS_LABELS: Record<string, string> = {
        pending: 'Pending Payment',
        completed: 'Completed',
        failed: 'Failed',
        refunded: 'Refunded',
        cancelled: 'Cancelled',
      };

      return allPayments.map((p) => {
        const estimate = p.estimateId ? estimateMap.get(p.estimateId) : null;
        const items = estimate?.items as Array<{ name?: string; nameEng?: string; category?: string; quantity?: number; subtotal?: number }> || [];

        return {
          orderId: p.estimateId || p.id,
          status: p.status,
          statusLabel: TUMAKR_STATUS_LABELS[p.status] || p.status,
          total: p.amount.toString(),
          currency: p.currency || 'USD',
          dateCreated: p.createdAt.toISOString(),
          datePaid: p.paidAt?.toISOString() || null,
          paymentMethod: p.paymentMethod === 'paypal' ? 'PayPal' : p.paymentMethod,
          paymentStatus: p.paidAt ? 'Paid' : 'Unpaid',
          customerName: estimate?.customerName || '',
          customerEmail: p.payerEmail || estimate?.customerEmail || '',
          items: items.slice(0, 10).map((item) => ({
            name: item.nameEng || item.name || item.category || 'Tour Item',
            quantity: item.quantity || 1,
            total: item.subtotal?.toString() || '0',
          })),
          source: 'tumakr' as const,
        };
      });
    } catch (error) {
      this.logger.error(`Tumakr payment lookup error (email: ${email}):`, error);
      return [];
    }
  }
}
