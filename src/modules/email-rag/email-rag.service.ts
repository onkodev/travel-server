import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmbeddingService } from '../ai/core/embedding.service';
import { GeminiCoreService } from '../ai/core/gemini-core.service';
import { parseJsonResponse } from '../ai/core/response-parser.util';
import {
  INTEREST_KEYWORDS,
  expandInterests,
  interestToCategories,
} from '../ai/prompts/email-rag.prompts';
import { AiPromptService } from '../ai-prompt/ai-prompt.service';
import { PromptKey } from '../ai-prompt/prompt-registry';
import { PlaceMatcherService } from '../item/place-matcher.service';
import type {
  EmailSearchResult,
  DraftResult,
  DraftItem,
  ExtractedPlace,
} from './dto';

export interface EstimateSearchResult {
  estimateId: number;
  title: string;
  regions: string[];
  interests: string[];
  travelDays: number;
  similarity: number;
  itemsSummary: string;
}

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
  selectedEmails: Array<{
    emailThreadId: number;
    subject: string | null;
    similarity: number;
  }>;
  estimateSearchResults?: Array<{
    estimateId: number;
    title: string;
    similarity: number;
  }>;
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
  stepTimings?: {
    vectorSearchMs: number;
    rerankAndDbPlacesMs: number;
    promptBuildMs: number;
    geminiCallMs: number;
    postMatchMs: number;
    totalMs: number;
  };
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
    private placeMatcher: PlaceMatcherService,
  ) {}

  /**
   * 유사 이메일 스레드 검색 (pgvector - email_threads 직접)
   * precomputedEmbedding이 있으면 임베딩 재생성 스킵
   */
  async searchSimilarEmails(
    query: string,
    limit = 5,
    similarityMin = 0.3,
    precomputedEmbedding?: number[],
  ): Promise<EmailSearchResult[]> {
    const embedding =
      precomputedEmbedding ??
      (await this.embeddingService.generateEmbedding(query));
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
        AND et.exclude_from_rag = false
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
   * 유사 견적 검색 (pgvector - estimates 테이블)
   */
  async searchSimilarEstimates(
    embedding: number[],
    limit = 3,
    similarityMin = 0.3,
  ): Promise<EstimateSearchResult[]> {
    const vectorStr = `[${embedding.join(',')}]`;

    const results = await this.prisma.$queryRaw<
      Array<{
        id: number;
        title: string;
        regions: string[];
        interests: string[];
        travel_days: number;
        items: unknown;
        similarity: number;
      }>
    >`
      SELECT
        e.id,
        e.title,
        e.regions,
        e.interests,
        e.travel_days,
        e.items,
        1 - (e.embedding <=> ${vectorStr}::vector) AS similarity
      FROM estimates e
      WHERE e.embedding IS NOT NULL
      ORDER BY e.embedding <=> ${vectorStr}::vector
      LIMIT ${limit}
    `;

    return results
      .filter((r) => r.similarity > similarityMin)
      .map((r) => ({
        estimateId: r.id,
        title: r.title,
        regions: r.regions || [],
        interests: r.interests || [],
        travelDays: r.travel_days,
        similarity: Number(r.similarity),
        itemsSummary: this.extractEstimateItemsSummary(r.items),
      }));
  }

  /**
   * 유사 장소 검색 (pgvector - items 테이블)
   * 프롬프트 토큰 폭발을 막기 위해 연관도 높은 상위 N개 장소만 추출
   */
  async searchSimilarPlaces(
    categories: string[],
    regionFilter: string,
    limit = 30,
  ): Promise<Array<{
    id: number;
    nameEng: string;
    nameKor: string | null;
    categories: string[];
    descriptionEng: string | null;
    similarity: number;
  }>> {
    // 1. 카테고리가 일치하고 지역이 맞는 장소 우선 검색
    const places = await this.prisma.item.findMany({
      where: {
        category: 'place',
        aiEnabled: true,
        OR: regionFilter ? [
          { region: { contains: regionFilter, mode: 'insensitive' } },
          { addressEnglish: { contains: regionFilter, mode: 'insensitive' } }
        ] : undefined,
        ...(categories.length > 0 ? {
          categories: { hasSome: categories }
        } : {})
      },
      take: limit,
      select: {
        id: true,
        nameEng: true,
        nameKor: true,
        categories: true,
        descriptionEng: true,
      }
    });

    // 2. 개수가 부족하면 카테고리 무관하게 해당 지역의 다른 장소 추가
    if (places.length < limit && regionFilter) {
      const morePlaces = await this.prisma.item.findMany({
        where: {
          category: 'place',
          aiEnabled: true,
          OR: [
            { region: { contains: regionFilter, mode: 'insensitive' } },
            { addressEnglish: { contains: regionFilter, mode: 'insensitive' } }
          ],
          id: { notIn: places.map(p => p.id) }
        },
        take: limit - places.length,
        select: {
          id: true,
          nameEng: true,
          nameKor: true,
          categories: true,
          descriptionEng: true,
        }
      });
      places.push(...morePlaces);
    }

    return places.map(p => ({
      id: p.id,
      nameEng: p.nameEng,
      nameKor: p.nameKor,
      categories: p.categories || [],
      descriptionEng: p.descriptionEng,
      similarity: 1.0 // 벡터 미사용이므로 가짜 유사도 1.0 반환
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
      ragEstimateLimit?: number;
      ragSimilarityMin?: number;
      geminiTemperature?: number;
      geminiMaxTokens?: number;
      placesPerDay?: number;
      customPromptAddon?: string;
      geminiModel?: string;
      signal?: AbortSignal;
    },
  ): Promise<
    (DraftResult & { searchQuery: string; pipelineLog: PipelineLog }) | null
  > {
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

    // ── 타이밍 계측 ──
    const timings: Record<string, number> = {};
    const lap = (label: string) => {
      timings[label] = Date.now() - startTime;
    };

    // ── 1. 관심사 확장 ──
    const expandedInterestsText = expandInterests(
      flow.interestMain,
      flow.interestSub,
    );
    this.logger.log(
      `[pipeline:interests] 확장된 관심사: "${expandedInterestsText}"`,
    );

    // ── 2. 검색 쿼리 생성 ──
    const searchQuery = this.buildSearchQuery(flow);
    this.logger.log(`[pipeline:query] RAG 검색 쿼리: "${searchQuery}"`);

    // ── 3. 임베딩 1회 생성 → 이메일+견적 병렬 검색 ──
    const searchLimit = config?.ragSearchLimit ?? 8;
    const similarityMin = config?.ragSimilarityMin ?? 0.3;
    const fetchLimit = searchLimit * 3;

    const queryEmbedding =
      await this.embeddingService.generateEmbedding(searchQuery);
    if (!queryEmbedding) {
      this.logger.warn('[pipeline:embedding] 쿼리 임베딩 생성 실패 → 종료');
      return null;
    }

    const [rawEmails, estimateResults] = await Promise.all([
      this.searchSimilarEmails(
        searchQuery,
        fetchLimit,
        similarityMin,
        queryEmbedding,
      ),
      this.searchSimilarEstimates(
        queryEmbedding,
        config?.ragEstimateLimit ?? 3,
        similarityMin,
      ),
    ]);
    lap('vectorSearch');

    if (estimateResults.length > 0) {
      this.logger.log(
        `[pipeline:estimateSearch] 유사 견적 ${estimateResults.length}개 발견:\n` +
          estimateResults
            .map(
              (e, i) =>
                `  ${i + 1}. [ID:${e.estimateId}] "${e.title}" (sim=${e.similarity.toFixed(3)})`,
            )
            .join('\n'),
      );
    }

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
    this.logger.log(
      `[pipeline:rerank] 리랭킹 시작 (관심사 키워드로 이메일 본문 스캔)...`,
    );
    const regionFilter = flow.region || 'Seoul';

    // 관심사 키 → DB 카테고리 값 변환
    const allInterests = [...flow.interestSub, ...flow.interestMain];
    const dbCategories = interestToCategories(allInterests);
    this.logger.log(
      `[pipeline:categories] 관심사 [${allInterests.join(', ')}] → DB 카테고리 [${dbCategories.join(', ')}]`,
    );

    // 카테고리 기반으로 연관성 높은 30개 장소만 로딩 (토큰 절약)
    const [rerankResult, dbPlacesResult] = await Promise.all([
      Promise.resolve(
        this.rerankByRelevance(
          rawEmails,
          flow.interestMain,
          flow.interestSub,
          searchLimit,
        ),
      ),
      this.searchSimilarPlaces(dbCategories, regionFilter, 30),
    ]);

    lap('rerankAndDbPlaces');
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
        .map((p) => {
          const cats = p.categories?.length
            ? ` [${p.categories.join(', ')}]`
            : '';
          const desc = p.descriptionEng
            ? ` - ${p.descriptionEng.slice(0, 80)}`
            : '';
          return `[ID:${p.id}] ${p.nameEng} (${p.nameKor})${cats}${desc}`;
        })
        .join('\n');
      this.logger.log(
        `[pipeline:dbPlaces] "${regionFilter}" 지역 연관 DB 장소 ${dbPlacesResult.length}개 로드 (프롬프트 주입됨)`,
      );
    } else {
      this.logger.warn(
        `[pipeline:dbPlaces] "${regionFilter}" 지역 DB 장소 0개 검색됨`,
      );
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

    // ── 견적 컨텍스트 구성 ──
    let estimateContext = '';
    if (estimateResults.length > 0) {
      estimateContext =
        '\n## 4. REFERENCE ESTIMATES (similar past itineraries — use as structural examples)\n' +
        estimateResults
          .map(
            (e, i) =>
              `[Estimate ${i + 1}] (similarity: ${e.similarity.toFixed(2)}) ${e.title}\n` +
              `Region: ${e.regions.join(', ')} | Duration: ${e.travelDays} days | Interests: ${e.interests.join(', ')}\n` +
              `Places: ${e.itemsSummary}`,
          )
          .join('\n\n') +
        '\n';
    }

    const built = await this.aiPromptService.buildPrompt(
      PromptKey.EMAIL_RAG_DRAFT,
      {
        region: flow.region || 'Seoul',
        duration: String(duration),
        groupDescription: `${flow.adultsCount || 1} adult(s)${childrenCount > 0 ? `, ${childrenCount} child(ren)` : ''}`,
        interestMain: flow.interestMain.join(', ') || 'general',
        interestSub: interestSub ? ` (${interestSub})` : '',
        interestDetail: expandedInterestsText
          ? `\n  → PRIMARY INTEREST - The customer specifically wants: ${expandedInterestsText}\n  → CRITICAL: At least 60% of selected places MUST directly relate to these interests`
          : '',
        tourType: flow.tourType || 'private',
        budgetRange,
        isFirstVisit: isFirstVisit ? 'Yes' : 'No',
        nationalityLine: flow.nationality
          ? `- Nationality: ${flow.nationality}`
          : '',
        additionalNotesLine: flow.additionalNotes
          ? `- Special requests: ${flow.additionalNotes}`
          : '',
        attractionsLine:
          flow.attractions.length > 0
            ? `- MUST include these attractions: ${flow.attractions.join(', ')}`
            : '',
        pickupLine:
          (flow.needsPickup ?? false)
            ? '- Needs airport pickup (add pickup point as Day 1 first item)'
            : '',
        availablePlacesSection: availablePlaces
          ? `\n3. AVAILABLE PLACES IN OUR DATABASE:\n${availablePlaces}\n\n- Use this list to match specific locations to the planned itinerary\n- Keep the natural flow and pacing observed in the Reference Emails, and pick from this database to fulfill the concepts\n`
          : '',
        emailContext,
        estimateContext,
        placesPerDayRange: `${minPlaces}-${maxPlaces}`,
        visitorTip: isFirstVisit
          ? 'Prioritize must-see landmarks for first-time visitors'
          : 'Include hidden gems and local favorites for returning visitors',
        customPromptAddon: config?.customPromptAddon
          ? `\nADDITIONAL INSTRUCTIONS:\n${config.customPromptAddon}`
          : '',
      },
    );

    const prompt = built.text;
    lap('promptBuild');
    this.logger.log(
      `[pipeline:gemini] 프롬프트 생성완료 (${prompt.length}자), Gemini 호출 중...`,
    );

    const temperature = config?.geminiTemperature ?? built.temperature;
    const maxOutputTokens = config?.geminiMaxTokens ?? built.maxOutputTokens;
    const text = await this.geminiCore.callGemini(prompt, {
      temperature,
      maxOutputTokens,
      signal: config?.signal,
      disableThinking: true,
      model: config?.geminiModel,
    });

    lap('geminiCall');
    this.logger.log(`[pipeline:gemini] 응답 수신 (${text.length}자)`);

    // ── 8. Gemini 결과 파싱 ──
    const parseResult = this.parseGeminiDraftResponse(text, placesPerDay);
    if (!parseResult) return null;
    const { rawItems, geminiMatched } = parseResult;

    // ── 9. 후처리: 미매칭 장소 DB 매칭 ──
    this.logger.log(`[pipeline:postMatch] 후처리 DB 매칭 시작...`);
    const { items, matchingDetails } = await this.matchDraftItemsToDb(rawItems);
    lap('postMatch');

    // ── 10. 최종 요약 ──
    const finalMatched = items.filter((i) => i.itemId).length;
    const finalTbd = items.filter((i) => !i.itemId).length;
    const elapsed = Date.now() - startTime;

    // 단계별 소요시간 계산 (누적 → 구간)
    const stepTimings = {
      vectorSearchMs: timings.vectorSearch,
      rerankAndDbPlacesMs: timings.rerankAndDbPlaces - timings.vectorSearch,
      promptBuildMs: timings.promptBuild - timings.rerankAndDbPlaces,
      geminiCallMs: timings.geminiCall - timings.promptBuild,
      postMatchMs: timings.postMatch - timings.geminiCall,
      totalMs: elapsed,
    };

    this.logger.log(
      `[pipeline:timings] 단계별 소요시간:\n` +
        `  임베딩+벡터검색: ${stepTimings.vectorSearchMs}ms\n` +
        `  리랭킹+DB장소: ${stepTimings.rerankAndDbPlacesMs}ms\n` +
        `  프롬프트빌드: ${stepTimings.promptBuildMs}ms\n` +
        `  Gemini 호출: ${stepTimings.geminiCallMs}ms\n` +
        `  후처리매칭: ${stepTimings.postMatchMs}ms\n` +
        `  총: ${elapsed}ms`,
    );

    this.logger.log(
      `[pipeline:done] 완료 (${elapsed}ms)\n` +
        `  총 ${items.length}개 장소: ${finalMatched}개 DB매칭, ${finalTbd}개 TBD\n` +
        `  Gemini 매칭: ${geminiMatched} → 후처리 후: ${finalMatched} (+${finalMatched - geminiMatched}개 추가매칭)\n` +
        `  참조 이메일: ${emails
          .slice(0, 3)
          .map((e) => `[${e.emailThreadId}]"${e.subject}"`)
          .join(', ')}\n` +
        `  TBD 장소: ${
          items
            .filter((i) => !i.itemId)
            .map((i) => `"${i.placeName}"`)
            .join(', ') || '없음'
        }`,
    );

    const pipelineLog = this.buildPipelineLog({
      expandedInterestsText, searchQuery, rawEmails, rerankResult,
      emails, estimateResults, availablePlacesCount,
      promptLength: prompt.length, textLength: text.length,
      matchingDetails, elapsed, stepTimings,
    });

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
    threads: Array<{
      emailThreadId: number;
      subject: string | null;
      similarity: number;
    }>;
    places: ExtractedPlace[];
  }> {
    // 1. 유사 이메일 검색
    const emails = await this.searchSimilarEmails(
      query,
      limit || 5,
      similarityMin || 0.3,
    );
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

    const parsed = parseJsonResponse<{ places: ParsedPlace[] } | null>(
      text,
      null,
    );
    if (!parsed?.places || parsed.places.length === 0) {
      return { threads, places: [] };
    }

    // 4. PlaceMatcherService로 DB 대조 (exact → partial → fuzzy)
    const validPlaces = parsed.places.filter((p) => p.name);
    const matchResults = await this.placeMatcher.matchPlaces(
      validPlaces.map((p) => ({
        name: p.name!,
        nameKor: p.nameKor || undefined,
      })),
    );

    // 5. 결과 조합
    const places: ExtractedPlace[] = validPlaces.map((p, i) => {
      const match = matchResults[i];
      const base = {
        name: p.name!,
        nameKor: p.nameKor || null,
        type: p.type || 'attraction',
        region: p.region || null,
      };

      if (match.tier === 'fuzzy' && match.item) {
        return {
          ...base,
          status: 'fuzzy' as const,
          matchedItemId: match.item.id,
          matchedItemName: match.item.nameEng,
          matchScore: Math.round((match.score || 0) * 100),
        };
      }

      if (match.tier !== 'unmatched' && match.item) {
        return {
          ...base,
          status: 'matched' as const,
          matchedItemId: match.item.id,
          matchedItemName: match.item.nameEng,
        };
      }

      return { ...base, status: 'unmatched' as const };
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
   * finalScore = vectorSimilarity * 0.5 + contentRelevance * 0.5
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
      const finalScore = email.similarity * 0.5 + contentRelevance * 0.5;
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
   * 관심사 DB 카테고리 기반 장소 로드 (관심사 매칭 → 지역 폴백)
   */
  private async loadDbPlaces(
    region: string,
    dbCategories: string[],
  ): Promise<
    Array<{
      id: number;
      nameEng: string;
      nameKor: string;
      categories: string[];
      descriptionEng: string | null;
    }>
  > {
    type PlaceRow = {
      id: number;
      nameEng: string;
      nameKor: string;
      categories: string[];
      descriptionEng: string | null;
    };
    const regionFilter = {
      OR: [
        { region: { contains: region, mode: 'insensitive' as const } },
        { addressEnglish: { contains: region, mode: 'insensitive' as const } },
      ],
    };
    const select = {
      id: true,
      nameEng: true,
      nameKor: true,
      categories: true,
      descriptionEng: true,
    } as const;

    try {
      // 1차: 관심사 카테고리 + 지역 필터
      let results: PlaceRow[] = [];
      if (dbCategories.length > 0) {
        results = await this.prisma.item.findMany({
          where: {
            category: 'place',
            aiEnabled: true,
            AND: [
              regionFilter,
              { OR: dbCategories.map((cat) => ({ categories: { has: cat } })) },
            ],
          },
          select,
          take: 50,
        });
        this.logger.log(
          `[pipeline:dbPlaces] 관심사 카테고리 [${dbCategories.join(', ')}] + 지역 "${region}" → ${results.length}건`,
        );
      }

      // 2차 폴백: 관심사 결과 부족하면 지역 전체에서 보충 (중복 제거)
      if (results.length < 15) {
        const existIds = new Set(results.map((r) => r.id));
        const fallback = await this.prisma.item.findMany({
          where: { category: 'place', aiEnabled: true, ...regionFilter },
          select,
          take: 50,
        });
        const merged = [
          ...results,
          ...fallback.filter((f) => !existIds.has(f.id)),
        ].slice(0, 50);
        this.logger.log(
          `[pipeline:dbPlaces] 지역 폴백 보충 → 총 ${merged.length}건 (관심사 ${results.length} + 보충 ${merged.length - results.length})`,
        );
        return merged;
      }

      return results;
    } catch (e) {
      this.logger.warn(
        `[pipeline:dbPlaces] 장소 조회 실패: ${(e as Error).message}`,
      );
      return [];
    }
  }

  /**
   * Gemini 결과에서 itemId가 없는 장소를 DB와 매칭 (PlaceMatcherService 위임)
   */
  private async matchDraftItemsToDb(items: DraftItem[]): Promise<{
    items: DraftItem[];
    matchingDetails: PipelineLog['postMatching'];
  }> {
    const matchingDetails: PipelineLog['postMatching'] = [];
    const unmatchedItems: { item: DraftItem; idx: number }[] = [];

    // Gemini가 이미 매칭한 아이템 기록
    for (let i = 0; i < items.length; i++) {
      if (items[i].itemId) {
        matchingDetails.push({
          placeName: items[i].placeName,
          placeNameKor: items[i].placeNameKor,
          method: 'gemini',
          matchedItemId: items[i].itemId,
        });
      } else {
        unmatchedItems.push({ item: items[i], idx: i });
      }
    }

    if (unmatchedItems.length === 0) {
      this.logger.log('[postMatch] 모든 장소가 이미 DB 매칭됨');
      return { items, matchingDetails };
    }

    this.logger.log(
      `[postMatch] 미매칭 ${unmatchedItems.length}/${items.length}개 장소 DB 매칭 시도`,
    );

    // PlaceMatcherService로 3-tier 매칭
    const matchResults = await this.placeMatcher.matchPlaces(
      unmatchedItems.map((u) => ({
        name: u.item.placeName,
        nameKor: u.item.placeNameKor,
      })),
    );

    const result = [...items];
    for (let j = 0; j < unmatchedItems.length; j++) {
      const { item, idx } = unmatchedItems[j];
      const match = matchResults[j];

      if (match.tier !== 'unmatched' && match.item) {
        result[idx] = { ...item, itemId: match.item.id };
        matchingDetails.push({
          placeName: item.placeName,
          placeNameKor: item.placeNameKor,
          method: match.tier,
          matchedItemId: match.item.id,
          matchedItemName: match.item.nameEng,
          score: match.score,
        });
      } else {
        matchingDetails.push({
          placeName: item.placeName,
          placeNameKor: item.placeNameKor,
          method: 'unmatched',
        });
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
   * 견적 아이템에서 장소명 요약 (검색 결과 표시용)
   */
  private extractEstimateItemsSummary(items: unknown): string {
    if (!items || !Array.isArray(items)) return '';
    const placeNames = (items as Array<Record<string, unknown>>)
      .filter((item) => !item.isTbd && item.itemInfo)
      .map((item) => {
        const info = item.itemInfo as Record<string, unknown>;
        return (info.nameEng as string) || (info.nameKor as string) || '';
      })
      .filter(Boolean);
    return placeNames.join(', ').slice(0, 300);
  }

  /**
   * rawData에서 요약 텍스트 추출 (검색 결과 표시용, 800자 제한)
   */
  private extractSnippet(rawData: unknown): string {
    if (!rawData || typeof rawData !== 'object') return '';

    const data = rawData as Record<string, unknown>;

    // subject 필드가 있으면 본문 앞에 추가
    const subject = typeof data.subject === 'string' ? data.subject : '';

    if (typeof data.body === 'string' && data.body.trim()) {
      return (subject ? `[${subject}] ` : '').concat(data.body).slice(0, 800);
    }
    if (typeof data.snippet === 'string' && data.snippet.trim()) {
      return (subject ? `[${subject}] ` : '')
        .concat(data.snippet)
        .slice(0, 800);
    }

    const extractFromMessages = (
      msgs: Array<Record<string, unknown>>,
    ): string => {
      const parts = msgs
        .map((msg) => {
          if (typeof msg.snippet === 'string' && msg.snippet.trim())
            return msg.snippet;
          if (typeof msg.body === 'string' && msg.body.trim())
            return msg.body.slice(0, 500);
          return '';
        })
        .filter(Boolean);
      if (parts.length === 0) return '';
      return (subject ? `[${subject}] ` : '')
        .concat(parts.join('\n---\n'))
        .slice(0, 800);
    };

    if (Array.isArray(data.messages)) {
      return extractFromMessages(
        data.messages as Array<Record<string, unknown>>,
      );
    }

    if (Array.isArray(rawData)) {
      return extractFromMessages(rawData as Array<Record<string, unknown>>);
    }

    // 구조를 파악할 수 없는 경우 JSON 문자열화 시도
    try {
      const str = JSON.stringify(rawData).slice(0, 800);
      if (str.length > 10) return str;
    } catch {
      /* ignore */
    }

    return '';
  }

  /**
   * Gemini 응답 JSON → DraftItem[] 파싱
   */
  private parseGeminiDraftResponse(
    text: string,
    placesPerDay: number,
  ): { rawItems: DraftItem[]; geminiMatched: number } | null {
    interface ParsedDraftItem {
      placeName?: string;
      placeNameKor?: string;
      dayNumber?: number;
      orderIndex?: number;
      timeOfDay?: string;
      expectedDurationMins?: number;
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

    const rawItems: DraftItem[] = parsed.items.map((item, idx) => {
      let itemId: number | undefined;
      if (item.itemId != null) {
        const parsedId = Number(item.itemId);
        itemId = !isNaN(parsedId) && parsedId > 0 ? parsedId : undefined;
      }
      return {
        placeName: item.placeName || `Place ${idx + 1}`,
        placeNameKor: item.placeNameKor,
        dayNumber: item.dayNumber || Math.floor(idx / placesPerDay) + 1,
        orderIndex: item.orderIndex ?? idx % placesPerDay,
        timeOfDay: item.timeOfDay,
        expectedDurationMins: item.expectedDurationMins,
        reason: item.reason || '',
        itemId,
      } as any;
    });

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

    return { rawItems, geminiMatched };
  }

  /**
   * PipelineLog 객체 조립
   */
  private buildPipelineLog(params: {
    expandedInterestsText: string;
    searchQuery: string;
    rawEmails: EmailSearchResult[];
    rerankResult: { keywords: string[]; details: PipelineLog['reranking']['details'] };
    emails: EmailSearchResult[];
    estimateResults: EstimateSearchResult[];
    availablePlacesCount: number;
    promptLength: number;
    textLength: number;
    matchingDetails: PipelineLog['postMatching'];
    elapsed: number;
    stepTimings: NonNullable<PipelineLog['stepTimings']>;
  }): PipelineLog {
    return {
      expandedInterests: params.expandedInterestsText,
      searchQuery: params.searchQuery,
      vectorSearchResults: params.rawEmails.map((e) => ({
        emailThreadId: e.emailThreadId,
        subject: e.subject,
        similarity: e.similarity,
        contentLength: e.content.length,
      })),
      reranking: {
        keywords: params.rerankResult.keywords,
        details: params.rerankResult.details,
      },
      selectedEmails: params.emails.map((e) => ({
        emailThreadId: e.emailThreadId,
        subject: e.subject,
        similarity: e.similarity,
      })),
      estimateSearchResults: params.estimateResults.map((e) => ({
        estimateId: e.estimateId,
        title: e.title,
        similarity: e.similarity,
      })),
      availablePlacesCount: params.availablePlacesCount,
      geminiPromptLength: params.promptLength,
      geminiResponseLength: params.textLength,
      postMatching: params.matchingDetails,
      totalTimeMs: params.elapsed,
      stepTimings: params.stepTimings,
    };
  }
}
