import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmbeddingService } from '../ai/core/embedding.service';
import { GeminiCoreService } from '../ai/core/gemini-core.service';
import { parseJsonResponse } from '../ai/core/response-parser.util';
import {
  INTEREST_KEYWORDS,
  expandInterests,
} from '../ai/prompts/email-rag.prompts';
import { AiPromptService } from '../ai-prompt/ai-prompt.service';
import { PromptKey } from '../ai-prompt/prompt-registry';
import type {
  EmailSearchResult,
  DraftResult,
  DraftItem,
  ExtractedPlace,
} from './dto';

export interface PipelineLog {
  expandedInterests: string;
  searchQuery: string;
  vectorSearchResults: Array<{
    emailThreadId: number;
    subject: string | null;
    similarity: number;
    contentLength: number;
  }>;
  reranking: {
    keywords: string[];
    details: Array<{
      emailThreadId: number;
      subject: string | null;
      vectorScore: number;
      contentScore: number;
      finalScore: number;
      matchedKeywords: string[];
    }>;
  };
  selectedEmails: Array<{ emailThreadId: number; subject: string | null; similarity: number }>;
  availablePlacesCount: number;
  geminiPromptLength: number;
  geminiResponseLength: number;
  postMatching: Array<{
    placeName: string;
    placeNameKor?: string;
    method: 'gemini' | 'exact' | 'partial' | 'fuzzy' | 'unmatched';
    matchedItemId?: number;
    matchedItemName?: string;
    score?: number;
  }>;
  totalTimeMs: number;
}

interface ChatbotFlowForRag {
  sessionId: string;
  region: string | null;
  duration: number | null;
  interestMain: string[];
  interestSub: string[];
  attractions: string[];
  tourType: string | null;
  isFirstVisit: boolean | null;
  adultsCount: number | null;
  childrenCount: number | null;
  budgetRange: string | null;
  needsPickup: boolean | null;
  nationality: string | null;
  additionalNotes: string | null;
}

@Injectable()
export class EmailRagService {
  private readonly logger = new Logger(EmailRagService.name);

  constructor(
    private prisma: PrismaService,
    private embeddingService: EmbeddingService,
    private geminiCore: GeminiCoreService,
    private aiPromptService: AiPromptService,
  ) {}

  /**
   * 유사 이메일 스레드 검색 (pgvector - email_threads 직접)
   */
  async searchSimilarEmails(
    query: string,
    limit = 5,
    similarityMin = 0.3,
  ): Promise<EmailSearchResult[]> {
    const embedding = await this.embeddingService.generateEmbedding(query);
    if (!embedding) {
      this.logger.warn('Failed to generate embedding for query');
      return [];
    }

    const vectorStr = `[${embedding.join(',')}]`;

    const results = await this.prisma.$queryRaw<
      Array<{
        id: number;
        subject: string | null;
        from_email: string | null;
        raw_data: unknown;
        similarity: number;
      }>
    >`
      SELECT
        et.id,
        et.subject,
        et.from_email,
        et.raw_data,
        1 - (et.embedding <=> ${vectorStr}::vector) AS similarity
      FROM email_threads et
      WHERE et.embedding IS NOT NULL
      ORDER BY et.embedding <=> ${vectorStr}::vector
      LIMIT ${limit}
    `;

    return results
      .filter((r) => r.similarity > similarityMin)
      .map((r) => ({
        emailThreadId: r.id,
        subject: r.subject,
        fromEmail: r.from_email,
        content: this.extractSnippet(r.raw_data),
        similarity: Number(r.similarity),
      }));
  }

  /**
   * ChatbotFlow 데이터 기반으로 검색 쿼리 생성
   * 관심사 확장 키워드를 쿼리 앞부분에 배치 → 임베딩 벡터에 관심사가 강하게 반영됨
   */
  buildSearchQuery(flow: ChatbotFlowForRag): string {
    const region = flow.region || 'Seoul';

    // 관심사 확장 키워드 (쿼리의 핵심)
    const expandedInterestText = expandInterests(
      flow.interestMain || [],
      flow.interestSub || [],
    );

    // 보조 정보
    const meta: string[] = [];
    if (flow.duration) meta.push(`${flow.duration} days`);
    if (flow.tourType) meta.push(`${flow.tourType} tour`);
    if (flow.budgetRange) meta.push(`${flow.budgetRange} budget`);
    if (flow.isFirstVisit) meta.push('first visit');
    if (flow.attractions?.length) meta.push(flow.attractions.join(', '));

    return `${region} Korea travel: ${expandedInterestText} | ${meta.join(' ')}`.trim();
  }

  /**
   * 이메일 RAG + Gemini로 견적 초안 생성
   */
  async generateDraftFromFlow(
    flow: ChatbotFlowForRag,
    config?: {
      ragSearchLimit?: number;
      ragSimilarityMin?: number;
      geminiTemperature?: number;
      geminiMaxTokens?: number;
      placesPerDay?: number;
      customPromptAddon?: string;
      signal?: AbortSignal;
    },
  ): Promise<(DraftResult & { searchQuery: string; pipelineLog: PipelineLog }) | null> {
    const startTime = Date.now();

    // ── 0. 입력 요약 로그 ──
    this.logger.log(
      `[pipeline:start] session=${flow.sessionId}\n` +
      `  region=${flow.region}, duration=${flow.duration}days, tourType=${flow.tourType}\n` +
      `  interestMain=[${flow.interestMain.join(', ')}], interestSub=[${flow.interestSub.join(', ')}]\n` +
      `  attractions=[${flow.attractions?.join(', ') || 'none'}]\n` +
      `  budget=${flow.budgetRange}, firstVisit=${flow.isFirstVisit}, nationality=${flow.nationality}\n` +
      `  adults=${flow.adultsCount}, children=${flow.childrenCount}, pickup=${flow.needsPickup}`,
    );

    // ── 1. 관심사 확장 ──
    const expandedInterestsText = expandInterests(flow.interestMain, flow.interestSub);
    this.logger.log(`[pipeline:interests] 확장된 관심사: "${expandedInterestsText}"`);

    // ── 2. 검색 쿼리 생성 ──
    const searchQuery = this.buildSearchQuery(flow);
    this.logger.log(`[pipeline:query] RAG 검색 쿼리: "${searchQuery}"`);

    // ── 3. 유사 이메일 검색 (리랭킹 풀 확보를 위해 2배로 가져옴) ──
    const searchLimit = config?.ragSearchLimit ?? 8;
    const similarityMin = config?.ragSimilarityMin ?? 0.3;
    const fetchLimit = searchLimit * 2;
    const rawEmails = await this.searchSimilarEmails(searchQuery, fetchLimit, similarityMin);

    if (rawEmails.length === 0) {
      this.logger.log('[pipeline:search] 유사 이메일 없음 → 종료');
      return null;
    }

    this.logger.log(
      `[pipeline:search] 벡터검색 결과 ${rawEmails.length}개 (fetchLimit=${fetchLimit}, minSim=${similarityMin}):\n` +
        rawEmails
          .map(
            (e, i) =>
              `  ${i + 1}. [ID:${e.emailThreadId}] "${e.subject}" (sim=${e.similarity.toFixed(3)}) content=${e.content.length}자`,
          )
          .join('\n'),
    );

    // ── 4. 관심사 기반 리랭킹 + DB 장소 조회 병렬 실행 ──
    this.logger.log(`[pipeline:rerank] 리랭킹 시작 (관심사 키워드로 이메일 본문 스캔)...`);
    const regionFilter = flow.region || 'Seoul';

    // 리랭킹(CPU)과 DB 장소 조회(I/O)를 동시에 실행
    const [rerankResult, dbPlacesResult] = await Promise.all([
      Promise.resolve(this.rerankByRelevance(
        rawEmails,
        flow.interestMain,
        flow.interestSub,
        searchLimit,
      )),
      this.prisma.item.findMany({
        where: {
          type: 'place',
          OR: [
            { region: { contains: regionFilter, mode: 'insensitive' } },
            { addressEnglish: { contains: regionFilter, mode: 'insensitive' } },
          ],
        },
        select: { id: true, nameEng: true, nameKor: true },
        take: 200,
      }).catch((e) => {
        this.logger.warn(`[pipeline:dbPlaces] 장소 조회 실패: ${e.message}`);
        return [] as Array<{ id: number; nameEng: string; nameKor: string }>;
      }),
    ]);

    const emails = rerankResult.emails;

    this.logger.log(
      `[pipeline:rerank] 리랭킹 후 사용할 이메일 ${emails.length}개:\n` +
        emails
          .map(
            (e, i) =>
              `  ${i + 1}. [ID:${e.emailThreadId}] "${e.subject}" (sim=${e.similarity.toFixed(3)})`,
          )
          .join('\n'),
    );

    // ── 5. 컨텍스트 구성 ──
    const emailContext = emails
      .map(
        (e, i) =>
          `[Email ${i + 1}] (similarity: ${e.similarity.toFixed(2)})\nSubject: ${e.subject || 'N/A'}\n${e.content}`,
      )
      .join('\n\n---\n\n');

    this.logger.log(
      `[pipeline:context] 이메일 컨텍스트 길이: ${emailContext.length}자 (${emails.length}개 이메일)`,
    );

    // ── 6. DB 장소 목록 포맷팅 ──
    let availablePlaces: string | undefined;
    const availablePlacesCount = dbPlacesResult.length;
    if (dbPlacesResult.length > 0) {
      availablePlaces = dbPlacesResult
        .map((p) => `[ID:${p.id}] ${p.nameEng} (${p.nameKor})`)
        .join('\n');
      this.logger.log(
        `[pipeline:dbPlaces] "${regionFilter}" 지역 DB 장소 ${dbPlacesResult.length}개 로드 (프롬프트에 포함)`,
      );
    } else {
      this.logger.warn(`[pipeline:dbPlaces] "${regionFilter}" 지역 DB 장소 0개`);
    }

    // ── 7. Gemini 프롬프트 생성 + 호출 ──
    const placesPerDay = config?.placesPerDay ?? 4;
    const minPlaces = Math.max(2, placesPerDay - 1);
    const maxPlaces = placesPerDay + 1;
    const duration = flow.duration || 3;
    const budgetRange = flow.budgetRange || 'mid';
    const isFirstVisit = flow.isFirstVisit ?? true;
    const childrenCount = flow.childrenCount || 0;
    const interestSub = flow.interestSub.join(', ') || '';

    const built = await this.aiPromptService.buildPrompt(
      PromptKey.EMAIL_RAG_DRAFT,
      {
        region: flow.region || 'Seoul',
        duration: String(duration),
        groupDescription: `${flow.adultsCount || 1} adult(s)${childrenCount > 0 ? `, ${childrenCount} child(ren)` : ''}`,
        interestMain: flow.interestMain.join(', ') || 'general',
        interestSub: interestSub ? ` (${interestSub})` : '',
        interestDetail: expandedInterestsText ? `\n  → Specifically looking for: ${expandedInterestsText}` : '',
        tourType: flow.tourType || 'private',
        budgetRange,
        isFirstVisit: isFirstVisit ? 'Yes' : 'No',
        nationalityLine: flow.nationality ? `- Nationality: ${flow.nationality}` : '',
        additionalNotesLine: flow.additionalNotes ? `- Special requests: ${flow.additionalNotes}` : '',
        attractionsLine: flow.attractions.length > 0 ? `- MUST include these attractions: ${flow.attractions.join(', ')}` : '',
        pickupLine: (flow.needsPickup ?? false) ? '- Needs airport pickup (add pickup point as Day 1 first item)' : '',
        availablePlacesSection: availablePlaces
          ? `\n2. AVAILABLE PLACES IN OUR DATABASE (prefer these when possible):\n${availablePlaces}\n\n- When a place from this list fits, include its ID in the response as "itemId"\n- You may also suggest places NOT in this list if they're clearly better for the customer\n`
          : '',
        emailContext,
        placesPerDayRange: `${minPlaces}-${maxPlaces}`,
        visitorTip: isFirstVisit ? 'Prioritize must-see landmarks for first-time visitors' : 'Include hidden gems and local favorites for returning visitors',
        customPromptAddon: config?.customPromptAddon ? `\nADDITIONAL INSTRUCTIONS:\n${config.customPromptAddon}` : '',
      },
    );

    const prompt = built.text;
    this.logger.log(
      `[pipeline:gemini] 프롬프트 생성완료 (${prompt.length}자), Gemini 호출 중...`,
    );

    const temperature = config?.geminiTemperature ?? built.temperature;
    const maxOutputTokens = config?.geminiMaxTokens ?? built.maxOutputTokens;
    const text = await this.geminiCore.callGemini(prompt, {
      temperature,
      maxOutputTokens,
      signal: config?.signal,
    });

    this.logger.log(`[pipeline:gemini] 응답 수신 (${text.length}자)`);

    interface ParsedDraftItem {
      placeName?: string;
      placeNameKor?: string;
      dayNumber?: number;
      orderIndex?: number;
      reason?: string;
      itemId?: number | null;
    }

    const parsed = parseJsonResponse<{ items: ParsedDraftItem[] } | null>(
      text,
      null,
    );

    if (!parsed?.items || parsed.items.length === 0) {
      this.logger.warn('[pipeline:gemini] Gemini 응답에 items 없음 → 종료');
      return null;
    }

    // ── 8. Gemini 결과 파싱 ──
    const rawItems: DraftItem[] = parsed.items.map((item, idx) => ({
      placeName: item.placeName || `Place ${idx + 1}`,
      placeNameKor: item.placeNameKor,
      dayNumber: item.dayNumber || Math.floor(idx / placesPerDay) + 1,
      orderIndex: item.orderIndex ?? idx % placesPerDay,
      reason: item.reason || '',
      itemId: item.itemId ?? undefined,
    }));

    const geminiMatched = rawItems.filter((i) => i.itemId).length;
    this.logger.log(
      `[pipeline:parsed] Gemini 결과 ${rawItems.length}개 장소:\n` +
        rawItems
          .map(
            (item) =>
              `  Day${item.dayNumber}-${item.orderIndex}: ${item.placeName}${item.placeNameKor ? ` (${item.placeNameKor})` : ''} → ${item.itemId ? `[ID:${item.itemId}]` : 'TBD'} | ${item.reason.slice(0, 50)}`,
          )
          .join('\n') +
        `\n  → Gemini 자체 매칭: ${geminiMatched}/${rawItems.length}개`,
    );

    // ── 9. 후처리: 미매칭 장소 DB 매칭 ──
    this.logger.log(`[pipeline:postMatch] 후처리 DB 매칭 시작...`);
    const { items, matchingDetails } = await this.matchDraftItemsToDb(rawItems);

    // ── 10. 최종 요약 ──
    const finalMatched = items.filter((i) => i.itemId).length;
    const finalTbd = items.filter((i) => !i.itemId).length;
    const elapsed = Date.now() - startTime;

    this.logger.log(
      `[pipeline:done] 완료 (${elapsed}ms)\n` +
        `  총 ${items.length}개 장소: ${finalMatched}개 DB매칭, ${finalTbd}개 TBD\n` +
        `  Gemini 매칭: ${geminiMatched} → 후처리 후: ${finalMatched} (+${finalMatched - geminiMatched}개 추가매칭)\n` +
        `  참조 이메일: ${emails.slice(0, 3).map((e) => `[${e.emailThreadId}]"${e.subject}"`).join(', ')}\n` +
        `  TBD 장소: ${items.filter((i) => !i.itemId).map((i) => `"${i.placeName}"`).join(', ') || '없음'}`,
    );

    const pipelineLog: PipelineLog = {
      expandedInterests: expandedInterestsText,
      searchQuery,
      vectorSearchResults: rawEmails.map((e) => ({
        emailThreadId: e.emailThreadId,
        subject: e.subject,
        similarity: e.similarity,
        contentLength: e.content.length,
      })),
      reranking: {
        keywords: rerankResult.keywords,
        details: rerankResult.details,
      },
      selectedEmails: emails.map((e) => ({
        emailThreadId: e.emailThreadId,
        subject: e.subject,
        similarity: e.similarity,
      })),
      availablePlacesCount,
      geminiPromptLength: prompt.length,
      geminiResponseLength: text.length,
      postMatching: matchingDetails,
      totalTimeMs: elapsed,
    };

    return {
      items,
      ragSources: emails.slice(0, 3).map((e) => ({
        emailThreadId: e.emailThreadId,
        subject: e.subject,
        similarity: e.similarity,
      })),
      searchQuery,
      pipelineLog,
    };
  }

  /**
   * 이메일 분석 → 장소 추출 → DB 매칭
   */
  async analyzePlaces(
    query: string,
    limit?: number,
    similarityMin?: number,
  ): Promise<{
    threads: Array<{ emailThreadId: number; subject: string | null; similarity: number }>;
    places: ExtractedPlace[];
  }> {
    // 1. 유사 이메일 검색
    const emails = await this.searchSimilarEmails(query, limit || 5, similarityMin || 0.3);
    if (emails.length === 0) {
      return { threads: [], places: [] };
    }

    const threads = emails.map((e) => ({
      emailThreadId: e.emailThreadId,
      subject: e.subject,
      similarity: e.similarity,
    }));

    // 2. 이메일 콘텐츠 결합
    const combinedContent = emails
      .map((e) => `[${e.subject || 'N/A'}]\n${e.content}`)
      .join('\n\n---\n\n');

    // 3. Gemini로 장소 추출
    const extractBuilt = await this.aiPromptService.buildPrompt(
      PromptKey.PLACE_EXTRACTION,
      { emailContent: combinedContent },
    );
    const text = await this.geminiCore.callGemini(extractBuilt.text, {
      temperature: extractBuilt.temperature,
      maxOutputTokens: extractBuilt.maxOutputTokens,
    });

    interface ParsedPlace {
      name?: string;
      nameKor?: string | null;
      type?: string;
      region?: string | null;
    }

    const parsed = parseJsonResponse<{ places: ParsedPlace[] } | null>(text, null);
    if (!parsed?.places || parsed.places.length === 0) {
      return { threads, places: [] };
    }

    // 4. DB 대조 (정확 + 퍼지)
    const placeNames = parsed.places.map((p) => p.name || '').filter(Boolean);

    // 정확 매칭
    const exactResults = await this.prisma.item.findMany({
      where: {
        type: 'place',
        OR: placeNames.map((name) => ({
          OR: [
            { nameEng: { contains: name, mode: 'insensitive' as const } },
            { nameKor: { contains: name } },
          ],
        })),
      },
      select: { id: true, nameEng: true, nameKor: true },
    });

    const exactMap = new Map<string, { id: number; name: string }>();
    for (const item of exactResults) {
      exactMap.set(item.nameEng.toLowerCase(), { id: item.id, name: item.nameEng });
      exactMap.set(item.nameKor.toLowerCase(), { id: item.id, name: item.nameEng });
    }

    // 퍼지 매칭 (미매칭 아이템만)
    const unmatchedNames: string[] = [];
    const matchedPlaces = new Map<string, { id: number; name: string }>();

    for (const p of parsed.places) {
      const name = p.name || '';
      const key = name.toLowerCase();
      const fromMap = exactMap.get(key);

      if (fromMap) {
        matchedPlaces.set(name, fromMap);
      } else {
        const fromFind = exactResults.find((item) =>
          item.nameEng.toLowerCase().includes(key) || key.includes(item.nameEng.toLowerCase()) ||
          (p.nameKor && item.nameKor.includes(p.nameKor))
        );
        if (fromFind) {
          matchedPlaces.set(name, { id: fromFind.id, name: fromFind.nameEng });
        } else {
          unmatchedNames.push(name);
        }
      }
    }

    // 배치 퍼지 매칭
    const fuzzyMap = new Map<string, { id: number; name: string; score: number }>();
    if (unmatchedNames.length > 0) {
      const threshold = 0.3;
      const fuzzyResults = await this.prisma.$queryRaw<
        Array<{ query_name: string; id: number; name_eng: string; sim: number }>
      >`
        SELECT DISTINCT ON (query_name)
          query_name, id, name_eng,
          GREATEST(similarity(name_eng, query_name), similarity(name_kor, query_name)) AS sim
        FROM items
        CROSS JOIN unnest(${unmatchedNames}::text[]) AS query_name
        WHERE type = 'place'
          AND GREATEST(similarity(name_eng, query_name), similarity(name_kor, query_name)) > ${threshold}
        ORDER BY query_name, sim DESC
      `;

      for (const r of fuzzyResults) {
        fuzzyMap.set(r.query_name, { id: r.id, name: r.name_eng, score: Number(r.sim) });
      }
    }

    // 5. 결과 조합
    const places: ExtractedPlace[] = parsed.places.map((p) => {
      const name = p.name || '';
      const exact = matchedPlaces.get(name);
      if (exact) {
        return {
          name,
          nameKor: p.nameKor || null,
          type: p.type || 'attraction',
          region: p.region || null,
          status: 'matched' as const,
          matchedItemId: exact.id,
          matchedItemName: exact.name,
        };
      }

      const fuzzy = fuzzyMap.get(name);
      if (fuzzy) {
        return {
          name,
          nameKor: p.nameKor || null,
          type: p.type || 'attraction',
          region: p.region || null,
          status: 'fuzzy' as const,
          matchedItemId: fuzzy.id,
          matchedItemName: fuzzy.name,
          matchScore: Math.round(fuzzy.score * 100),
        };
      }

      return {
        name,
        nameKor: p.nameKor || null,
        type: p.type || 'attraction',
        region: p.region || null,
        status: 'unmatched' as const,
      };
    });

    this.logger.log(
      `[analyzePlaces] ${places.length} places extracted: ` +
      `${places.filter((p) => p.status === 'matched').length} matched, ` +
      `${places.filter((p) => p.status === 'fuzzy').length} fuzzy, ` +
      `${places.filter((p) => p.status === 'unmatched').length} unmatched`,
    );

    return { threads, places };
  }

  // ========== Private helpers ==========

  /**
   * 벡터 검색 결과를 관심사 키워드 매칭으로 리랭킹
   * finalScore = vectorSimilarity * 0.4 + contentRelevance * 0.6
   */
  private rerankByRelevance(
    emails: EmailSearchResult[],
    interestMain: string[],
    interestSub: string[],
    limit: number,
  ): {
    emails: EmailSearchResult[];
    keywords: string[];
    details: Array<{
      emailThreadId: number;
      subject: string | null;
      vectorScore: number;
      contentScore: number;
      finalScore: number;
      matchedKeywords: string[];
    }>;
  } {
    // 관심사에서 개별 키워드 추출 (소문자)
    const keywords: string[] = [];
    for (const key of [...interestSub, ...interestMain]) {
      const expanded = INTEREST_KEYWORDS[key];
      if (expanded) {
        keywords.push(
          ...expanded.split(',').map((k) => k.trim().toLowerCase()),
        );
      }
    }

    this.logger.log(
      `[rerank:keywords] 관심사 키워드 ${keywords.length}개: [${keywords.join(', ')}]`,
    );

    if (keywords.length === 0) {
      this.logger.log('[rerank] 관심사 키워드 없음 → 벡터 유사도 순서 유지');
      return {
        emails: emails.slice(0, limit),
        keywords: [],
        details: emails.map((e) => ({
          emailThreadId: e.emailThreadId,
          subject: e.subject,
          vectorScore: e.similarity,
          contentScore: 0,
          finalScore: e.similarity,
          matchedKeywords: [],
        })),
      };
    }

    const scored = emails.map((email) => {
      const content = (email.content || '').toLowerCase();
      const matchedKeywords = keywords.filter((kw) => content.includes(kw));
      const contentRelevance = matchedKeywords.length / keywords.length;
      const finalScore = email.similarity * 0.4 + contentRelevance * 0.6;
      return { email, finalScore, contentRelevance, matchedKeywords };
    });

    scored.sort((a, b) => b.finalScore - a.finalScore);

    // 각 이메일의 상세 매칭 정보 로그
    this.logger.log(
      `[rerank:detail] 이메일별 관심사 키워드 매칭:\n` +
        scored
          .map(
            (s, i) =>
              `  ${i + 1}. [ID:${s.email.emailThreadId}] "${s.email.subject}"\n` +
              `     벡터=${s.email.similarity.toFixed(3)}, 콘텐츠=${s.contentRelevance.toFixed(3)}, 최종=${s.finalScore.toFixed(3)}\n` +
              `     매칭키워드(${s.matchedKeywords.length}/${keywords.length}): [${s.matchedKeywords.join(', ')}]`,
          )
          .join('\n'),
    );

    const details = scored.map((s) => ({
      emailThreadId: s.email.emailThreadId,
      subject: s.email.subject,
      vectorScore: s.email.similarity,
      contentScore: s.contentRelevance,
      finalScore: s.finalScore,
      matchedKeywords: s.matchedKeywords,
    }));

    return {
      emails: scored.slice(0, limit).map((s) => s.email),
      keywords,
      details,
    };
  }

  /**
   * Gemini 결과에서 itemId가 없는 장소를 DB와 매칭 (정확 + 퍼지)
   */
  private async matchDraftItemsToDb(items: DraftItem[]): Promise<{
    items: DraftItem[];
    matchingDetails: PipelineLog['postMatching'];
  }> {
    const matchingDetails: PipelineLog['postMatching'] = [];
    const unmatchedItems = items.filter((item) => !item.itemId);

    // Gemini가 이미 매칭한 아이템 기록
    for (const item of items) {
      if (item.itemId) {
        matchingDetails.push({
          placeName: item.placeName,
          placeNameKor: item.placeNameKor,
          method: 'gemini',
          matchedItemId: item.itemId,
        });
      }
    }

    if (unmatchedItems.length === 0) {
      this.logger.log('[postMatch] 모든 장소가 이미 DB 매칭됨');
      return { items, matchingDetails };
    }

    this.logger.log(
      `[postMatch] 미매칭 ${unmatchedItems.length}/${items.length}개 장소 DB 매칭 시도`,
    );

    // 1) 영문명 + 한글명으로 정확(contains) 매칭
    const searchNames = unmatchedItems.map((item) => item.placeName);
    const searchNamesKor = unmatchedItems
      .map((item) => item.placeNameKor)
      .filter((n): n is string => !!n);

    const orConditions = [
      ...searchNames.map((name) => ({
        OR: [
          { nameEng: { contains: name, mode: 'insensitive' as const } },
          { nameKor: { contains: name } },
        ],
      })),
      ...searchNamesKor.map((name) => ({
        OR: [
          { nameKor: { contains: name } },
          { nameEng: { contains: name, mode: 'insensitive' as const } },
        ],
      })),
    ];

    const exactResults = await this.prisma.item.findMany({
      where: { type: 'place', OR: orConditions },
      select: { id: true, nameEng: true, nameKor: true },
    });

    // 정확 매칭 맵 구축
    const exactMap = new Map<string, { id: number; nameEng: string; nameKor: string }>();
    for (const item of exactResults) {
      exactMap.set(item.nameEng.toLowerCase(), item);
      exactMap.set(item.nameKor.toLowerCase(), item);
    }

    // 각 미매칭 아이템에 대해 정확 매칭 시도
    const stillUnmatched: Array<{ item: DraftItem; idx: number }> = [];
    const result = [...items];

    for (let i = 0; i < result.length; i++) {
      const item = result[i];
      if (item.itemId) continue;

      const keyEng = item.placeName.toLowerCase();
      const keyKor = item.placeNameKor?.toLowerCase() || '';

      // 직접 매칭
      let matched = exactMap.get(keyEng) || exactMap.get(keyKor);

      // 부분 포함 매칭
      if (!matched) {
        matched = exactResults.find(
          (db) =>
            db.nameEng.toLowerCase().includes(keyEng) ||
            keyEng.includes(db.nameEng.toLowerCase()) ||
            (keyKor && db.nameKor.toLowerCase().includes(keyKor)) ||
            (keyKor && keyKor.includes(db.nameKor.toLowerCase())),
        );
      }

      if (matched) {
        const isExact = exactMap.has(keyEng) || exactMap.has(keyKor);
        result[i] = { ...item, itemId: matched.id };
        matchingDetails.push({
          placeName: item.placeName,
          placeNameKor: item.placeNameKor,
          method: isExact ? 'exact' : 'partial',
          matchedItemId: matched.id,
          matchedItemName: matched.nameEng,
        });
        this.logger.log(
          `[postMatch] 정확매칭: "${item.placeName}" → [ID:${matched.id}] ${matched.nameEng} (${matched.nameKor})`,
        );
      } else {
        stillUnmatched.push({ item, idx: i });
      }
    }

    // 2) pg_trgm 퍼지 매칭
    if (stillUnmatched.length > 0) {
      const fuzzyNames = stillUnmatched.map((u) => u.item.placeName);
      const threshold = 0.25;

      try {
        const fuzzyResults = await this.prisma.$queryRaw<
          Array<{ query_name: string; id: number; name_eng: string; name_kor: string; sim: number }>
        >`
          SELECT DISTINCT ON (query_name)
            query_name, id, name_eng, name_kor,
            GREATEST(similarity(name_eng, query_name), similarity(name_kor, query_name)) AS sim
          FROM items
          CROSS JOIN unnest(${fuzzyNames}::text[]) AS query_name
          WHERE type = 'place'
            AND GREATEST(similarity(name_eng, query_name), similarity(name_kor, query_name)) > ${threshold}
          ORDER BY query_name, sim DESC
        `;

        const fuzzyMap = new Map<string, { id: number; nameEng: string; nameKor: string; sim: number }>();
        for (const r of fuzzyResults) {
          fuzzyMap.set(r.query_name, {
            id: r.id,
            nameEng: r.name_eng,
            nameKor: r.name_kor,
            sim: Number(r.sim),
          });
        }

        for (const { item, idx } of stillUnmatched) {
          const fuzzy = fuzzyMap.get(item.placeName);
          if (fuzzy) {
            result[idx] = { ...item, itemId: fuzzy.id };
            matchingDetails.push({
              placeName: item.placeName,
              placeNameKor: item.placeNameKor,
              method: 'fuzzy',
              matchedItemId: fuzzy.id,
              matchedItemName: fuzzy.nameEng,
              score: fuzzy.sim,
            });
            this.logger.log(
              `[postMatch] 퍼지매칭: "${item.placeName}" → [ID:${fuzzy.id}] ${fuzzy.nameEng} (${fuzzy.nameKor}) (유사도: ${(fuzzy.sim * 100).toFixed(0)}%)`,
            );
          } else {
            matchingDetails.push({
              placeName: item.placeName,
              placeNameKor: item.placeNameKor,
              method: 'unmatched',
            });
            this.logger.warn(
              `[postMatch] 매칭실패: "${item.placeName}"${item.placeNameKor ? ` (${item.placeNameKor})` : ''} → DB에 없음`,
            );
          }
        }
      } catch (e) {
        this.logger.warn(`[postMatch] 퍼지매칭 쿼리 실패: ${e.message}`);
        // 퍼지 매칭 실패 시 모든 미매칭 아이템을 unmatched로 기록
        for (const { item } of stillUnmatched) {
          if (!matchingDetails.some((d) => d.placeName === item.placeName)) {
            matchingDetails.push({
              placeName: item.placeName,
              placeNameKor: item.placeNameKor,
              method: 'unmatched',
            });
          }
        }
      }
    }

    const matchedCount = result.filter((i) => i.itemId).length;
    const unmatchedCount = result.filter((i) => !i.itemId).length;
    this.logger.log(
      `[postMatch] 최종결과: ${matchedCount}/${result.length} 매칭 성공, ${unmatchedCount}개 미매칭(TBD)`,
    );

    return { items: result, matchingDetails };
  }

  /**
   * rawData에서 요약 텍스트 추출 (검색 결과 표시용, 2000자 제한)
   */
  private extractSnippet(rawData: unknown): string {
    if (!rawData || typeof rawData !== 'object') return '';

    const data = rawData as Record<string, unknown>;

    if (typeof data.body === 'string') return data.body.slice(0, 2000);
    if (typeof data.snippet === 'string') return data.snippet;

    if (Array.isArray(data.messages)) {
      return data.messages
        .map((msg: Record<string, unknown>) => {
          if (typeof msg.snippet === 'string') return msg.snippet;
          if (typeof msg.body === 'string') return msg.body.slice(0, 500);
          return '';
        })
        .filter(Boolean)
        .join('\n---\n')
        .slice(0, 2000);
    }

    if (Array.isArray(rawData)) {
      return (rawData as Array<Record<string, unknown>>)
        .map((msg) => {
          if (typeof msg.snippet === 'string') return msg.snippet;
          if (typeof msg.body === 'string') return msg.body.slice(0, 500);
          return '';
        })
        .filter(Boolean)
        .join('\n---\n')
        .slice(0, 2000);
    }

    return '';
  }
}
