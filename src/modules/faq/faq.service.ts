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

@Injectable()
export class FaqService {
  private readonly logger = new Logger(FaqService.name);

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
  }) {
    const { page = 1, limit = 20, status, source, search } = params;
    const skip = calculateSkip(page, limit);

    const where: Prisma.FaqWhereInput = {};

    if (status) where.status = status;
    if (source) where.source = source;

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
        await this.generateAndSaveEmbedding(faq.id, faq.question, faq.answer, faq.questionKo, faq.answerKo);
      } catch (error) {
        this.logger.error(`임베딩 생성 실패 (FAQ #${faq.id}):`, error);
      }
    }

    return faq;
  }

  async updateFaq(id: number, data: Prisma.FaqUpdateInput) {
    const faq = await this.prisma.faq.update({
      where: { id },
      data,
    });

    // approved 상태에서 question/answer/ko 변경 시 임베딩 재생성 (실패해도 업데이트는 유지)
    if (faq.status === 'approved' && (data.question || data.answer || data.questionKo || data.answerKo)) {
      try {
        await this.generateAndSaveEmbedding(faq.id, faq.question, faq.answer, faq.questionKo, faq.answerKo);
      } catch (error) {
        this.logger.error(`임베딩 재생성 실패 (FAQ #${faq.id}):`, error);
      }
    }

    return faq;
  }

  async deleteFaq(id: number) {
    return this.prisma.faq.delete({ where: { id } });
  }

  async approveFaq(
    id: number,
    userId: string,
    updates?: { question?: string; answer?: string; questionKo?: string; answerKo?: string },
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
      await this.generateAndSaveEmbedding(faq.id, faq.question, faq.answer, faq.questionKo, faq.answerKo);
    } catch (error) {
      this.logger.error(`임베딩 생성 실패 (FAQ #${faq.id}):`, error);
    }

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

    return faq;
  }

  async bulkAction(
    ids: number[],
    action: 'approve' | 'reject' | 'delete',
    userId: string,
    reason?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
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
  }

  async getStats() {
    const [total, pending, approved, rejected, fromGmail] = await Promise.all([
      this.prisma.faq.count(),
      this.prisma.faq.count({ where: { status: 'pending' } }),
      this.prisma.faq.count({ where: { status: 'approved' } }),
      this.prisma.faq.count({ where: { status: 'rejected' } }),
      this.prisma.faq.count({ where: { source: 'gmail' } }),
    ]);

    return { total, pending, approved, rejected, fromGmail };
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
      where: { id: { in: faqIds }, source: 'gmail', sourceEmailId: { not: null } },
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
      const text = this.embeddingService.buildFaqText(question, answer, questionKo, answerKo);
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
      select: { id: true, question: true, answer: true, questionKo: true, answerKo: true },
    });

    let failed = 0;
    for (const faq of faqs) {
      try {
        await this.generateAndSaveEmbedding(faq.id, faq.question, faq.answer, faq.questionKo, faq.answerKo);
      } catch {
        failed++;
      }
    }

    if (failed > 0) {
      this.logger.warn(`일괄 임베딩: ${faqs.length}건 중 ${failed}건 실패`);
    } else {
      this.logger.log(`일괄 임베딩: ${faqs.length}건 완료`);
    }
  }

  async regenerateAllEmbeddings(): Promise<{ total: number; success: number; failed: number }> {
    const faqs = await this.prisma.faq.findMany({
      where: { status: 'approved' },
      select: { id: true, question: true, answer: true, questionKo: true, answerKo: true },
    });

    let success = 0;
    let failed = 0;

    for (const faq of faqs) {
      try {
        await this.generateAndSaveEmbedding(faq.id, faq.question, faq.answer, faq.questionKo, faq.answerKo);
        success++;
      } catch {
        failed++;
      }
    }

    this.logger.log(`임베딩 전체 재생성: ${faqs.length}건 중 성공 ${success}, 실패 ${failed}`);
    return { total: faqs.length, success, failed };
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

  // ============================================================================
  // FAQ Chat (AI) — 하이브리드 응답 전략
  // 1. FAQ 유사도 높음 → FAQ 답변 (회사 관련)
  // 2. FAQ 유사도 낮음 → 의도 분류 후 분기
  //    - company → FAQ RAG
  //    - travel → Gemini 직접 (일반 한국 여행)
  // ============================================================================

  private static readonly DIRECT_THRESHOLD = 0.70; // FAQ 직접 답변 임계값
  private static readonly RAG_THRESHOLD = 0.50;    // FAQ RAG 임계값

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
      this.logger.debug(`Intent classified: ${intent} for message: "${message.substring(0, 50)}..."`);

      if (intent === 'company' && topSimilarity >= FaqService.RAG_THRESHOLD) {
        // === RAG: 회사 관련이지만 정확한 FAQ 없음 → FAQ 컨텍스트로 생성 ===
        responseTier = 'rag';
        const relevant = similar.filter((f) => f.similarity >= FaqService.RAG_THRESHOLD);
        answer = await this.generateRagAnswer(message, relevant, history);
      } else if (intent === 'company') {
        // === 회사 관련인데 매칭 FAQ 없음 → 문의 안내 ===
        responseTier = 'no_match';
        answer = "I don't have specific information about that in our FAQ. For questions about our tours, pricing, or bookings, please start a tour inquiry or contact us directly at info@tumakr.com.";
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
    const relevant = similar.filter((f) => f.similarity >= FaqService.RAG_THRESHOLD);
    const noMatch = relevant.length === 0;
    const matchedFaqIds = relevant.map((f) => f.id);
    const matchedSimilarities = relevant.map((f) => f.similarity);

    // 4. 로그 저장 (fire-and-forget)
    const logAnswer = answer;
    const saveLog = async () => {
      let geo = { country: null as string | null, countryName: null as string | null, city: null as string | null };
      if (meta?.ipAddress) {
        const geoData = await this.geoIpService.lookup(meta.ipAddress);
        geo = { country: geoData.country, countryName: geoData.countryName, city: geoData.city };
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
    saveLog().catch((err) => this.logger.error('FAQ 채팅 로그 저장 실패:', err));

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
      sources: relevant.length > 0
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
      this.logger.error('Intent classification failed, defaulting to travel:', error);
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
    relevant: Array<{ id: number; question: string; answer: string; similarity: number }>,
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
  async getDirectFaqAnswer(faqId: number): Promise<{ question: string; answer: string }> {
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
    const { page = 1, limit = 20, noMatch, startDate, endDate, search, responseTier, visitorId } = params;
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
      responseTier: (log as any).responseTier ?? null,
      matchedFaqs: log.matchedFaqIds.map((id, idx) => ({
        id,
        question: faqMap.get(id) || null,
        similarity: log.matchedSimilarities[idx] ?? null,
      })),
    }));

    return createPaginatedResponse(enriched, total, page, limit);
  }

  async getFaqChatStats() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [totalChats, todayChats, noMatchCount, directCount, ragCount, dailyTrend, topFaqs] = await Promise.all([
      this.prisma.faqChatLog.count(),
      this.prisma.faqChatLog.count({ where: { createdAt: { gte: todayStart } } }),
      this.prisma.faqChatLog.count({ where: { noMatch: true } }),
      this.prisma.faqChatLog.count({ where: { responseTier: 'direct' } }),
      this.prisma.faqChatLog.count({ where: { responseTier: 'rag' } }),
      // 일별 추이 (30일)
      this.prisma.$queryRaw<Array<{ date: Date; count: bigint }>>`
        SELECT DATE(created_at AT TIME ZONE 'UTC') as date, COUNT(*)::bigint as count
        FROM faq_chat_logs
        WHERE created_at >= ${thirtyDaysAgo}
        GROUP BY DATE(created_at AT TIME ZONE 'UTC')
        ORDER BY date ASC
      `,
      // 자주 매칭되는 FAQ Top 10
      this.prisma.$queryRaw<Array<{ faq_id: number; match_count: bigint }>>`
        SELECT unnest(matched_faq_ids) as faq_id, COUNT(*)::bigint as match_count
        FROM faq_chat_logs
        WHERE array_length(matched_faq_ids, 1) > 0
        GROUP BY faq_id
        ORDER BY match_count DESC
        LIMIT 10
      `,
    ]);

    // Top FAQ 상세 정보 조회
    const topFaqIds = topFaqs.map((f) => f.faq_id);
    const faqDetails =
      topFaqIds.length > 0
        ? await this.prisma.faq.findMany({
            where: { id: { in: topFaqIds } },
            select: { id: true, question: true, viewCount: true },
          })
        : [];

    const faqDetailMap = new Map(faqDetails.map((f) => [f.id, f]));

    return {
      totalChats,
      todayChats,
      noMatchCount,
      noMatchRate: totalChats > 0 ? ((noMatchCount / totalChats) * 100).toFixed(1) : '0.0',
      directCount,
      ragCount,
      dailyTrend: dailyTrend.map((d) => ({
        date: d.date,
        count: Number(d.count),
      })),
      topMatchedFaqs: topFaqs.map((f) => ({
        faqId: f.faq_id,
        matchCount: Number(f.match_count),
        question: faqDetailMap.get(f.faq_id)?.question || null,
      })),
    };
  }
}
