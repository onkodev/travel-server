import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { CACHE_TTL } from '../../common/constants/cache';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import {
  extractImageUrls,
  calculateTotalPax,
  jsonCast,
  formatDateKR,
  formatDateTimeKR,
  buildItemInfo,
} from '../../common/utils';
import { EstimateItem, EstimateStatusAi, EstimateSource } from '../../common/types';
import {
  EmailRagService,
  type PipelineLog,
} from '../email-rag/email-rag.service';
import { EmailEmbeddingService } from '../email-rag/email-embedding.service';
import type { DraftResult } from '../email-rag/dto';
import {
  PlaceMatcherService,
  type MatchedItemFull,
  type PlaceMatchResult,
} from '../item/place-matcher.service';

function generateItemId(): string {
  return randomUUID();
}

// 매칭 tier 정보 포함
type MatchTier = 'geminiId' | 'exact' | 'partial' | 'fuzzy';

interface MatchedItemInfo {
  name: string;
  itemId: number;
  tier: MatchTier;
  score?: number; // 퍼지 매칭 시 유사도 점수
}

// AiEstimateMetadata 타입
interface AiEstimateMetadata {
  generatedAt: string;
  generationTimeMs: number;
  source: 'rag' | 'tbd';
  ragSearch: {
    query: string;
    resultsCount: number;
    sources: Array<{
      emailThreadId: number;
      subject: string | null;
      similarity: number;
    }>;
  } | null;
  itemMatching: {
    totalDraftItems: number;
    matchedCount: number;
    tbdCount: number;
    matchedItems: MatchedItemInfo[];
    tbdItems: Array<{ name: string; reason: string }>;
  };
  userAttractions: string[];
  config: {
    ragSearchLimit: number;
    ragSimilarityMin: number;
    geminiTemperature: number;
  };
  pipelineLog?: PipelineLog;
  confidenceScore?: number; // 0-100
}

// 프론트엔드용 가공된 아이템
export interface FormattedEstimateItem {
  id: string;
  category: string;
  itemId: number | null;
  itemName: string | undefined;
  name: string | undefined;
  nameEng: string | undefined;
  dayNumber: number;
  orderIndex: number;
  isTbd: boolean;
  note: string | undefined;
  itemInfo?: {
    nameKor: string | undefined;
    nameEng: string | undefined;
    descriptionEng: string | undefined;
    images: string[];
    lat: number | undefined;
    lng: number | undefined;
    addressEnglish: string | undefined;
  };
}

// ChatbotFlow 데이터
interface ChatbotFlowData {
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
  infantsCount: number | null;
  seniorsCount: number | null;
  ageRange: string | null;
  budgetRange: string | null;
  needsPickup: boolean | null;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  nationality: string | null;
  travelDate: Date | null;
  additionalNotes: string | null;
}

@Injectable()
export class AiEstimateService {
  private readonly logger = new Logger(AiEstimateService.name);
  private configCache: {
    data: {
      geminiModel: string;
      ragSearchLimit: number;
      ragEstimateLimit: number;
      ragSimilarityMin: number;
      geminiTemperature: number;
      geminiMaxTokens: number;
      placesPerDay: number;
      ragTimeout: number;
      customPromptAddon: string | null;
      fuzzyMatchThreshold: number;
      directThreshold: number;
      ragThreshold: number;
      noMatchResponse: string | null;
      estimateValidityDays: number;
      aiEstimateValidityDays: number;
      includeTbdItems: boolean;
    };
    expiresAt: number;
  } | null = null;
  private static readonly CONFIG_TTL_MS = CACHE_TTL.AI_CONFIG;

  // 영어 → 한글 지역명 매핑
  private readonly REGION_MAP: Record<string, string> = {
    seoul: '서울',
    busan: '부산',
    jeju: '제주',
    gyeonggi: '경기',
    gangwon: '강원',
    incheon: '인천',
    daegu: '대구',
    daejeon: '대전',
    gwangju: '광주',
    ulsan: '울산',
  };

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private emailRagService: EmailRagService,
    private placeMatcher: PlaceMatcherService,
    private emailEmbeddingService: EmailEmbeddingService,
  ) { }

  /**
   * AiGenerationConfig 로드 (인메모리 캐시, 5분 TTL)
   */
  private async loadConfig() {
    if (this.configCache && Date.now() < this.configCache.expiresAt) {
      return this.configCache.data;
    }
    const config = await this.prisma.aiGenerationConfig.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1 },
    });
    this.configCache = {
      data: config,
      expiresAt: Date.now() + AiEstimateService.CONFIG_TTL_MS,
    };
    return config;
  }

  /**
   * 첫 견적 생성 - Email RAG only
   * 1. Email RAG 시도 (유사 이메일에서 장소 추천)
   * 2. 실패 시 → TBD 견적 생성
   * 3. 사용자 attractions 반영
   */
  async generateFirstEstimate(sessionId: string): Promise<{
    estimateId: number;
    shareHash: string;
    items: FormattedEstimateItem[];
    hasTbdDays: boolean;
  }> {
    const startTime = Date.now();
    this.logger.log(`[generateFirstEstimate] 시작 - sessionId: ${sessionId}`);

    // Flow 조회 + Config 로드 병렬 실행
    const [flow, config] = await Promise.all([
      this.getChatbotFlow(sessionId),
      this.loadConfig(),
    ]);
    if (!flow) {
      throw new NotFoundException('Chatbot session not found.');
    }

    this.logger.log(
      `[generateFirstEstimate] 요청 - region: ${flow.region}, days: ${flow.duration || 3}, interests: ${flow.interestMain?.join(',')}`,
    );

    let items: EstimateItem[] = [];
    let generationSource: 'rag' | 'tbd' = 'tbd';

    // Metadata 수집용 변수
    let ragSearchQuery: string | null = null;
    let ragSources: DraftResult['ragSources'] = [];
    let matchedItems: MatchedItemInfo[] = [];
    let tbdItems: Array<{ name: string; reason: string }> = [];
    let totalDraftItems = 0;

    // === Email RAG 시도 (실패해도 진행, timeout 시 Gemini fetch도 취소) ===
    let ragDraft:
      | (DraftResult & {
        searchQuery: string;
        pipelineLog: import('../email-rag/email-rag.service').PipelineLog;
      })
      | null = null;
    const abortController = new AbortController();
    let ragTimeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      ragDraft = await Promise.race([
        this.emailRagService.generateDraftFromFlow(flow, {
          ragSearchLimit: config.ragSearchLimit,
          ragEstimateLimit: config.ragEstimateLimit,
          ragSimilarityMin: config.ragSimilarityMin,
          geminiTemperature: config.geminiTemperature,
          geminiMaxTokens: config.geminiMaxTokens,
          placesPerDay: config.placesPerDay,
          customPromptAddon: config.customPromptAddon ?? undefined,
          geminiModel: config.geminiModel,
          signal: abortController.signal,
        }),
        new Promise<null>((_, reject) => {
          ragTimeoutId = setTimeout(() => {
            abortController.abort();
            reject(new Error('RAG timeout'));
          }, config.ragTimeout);
        }),
      ]);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.warn(`[generateFirstEstimate] Email RAG failed: ${message}`);
    } finally {
      clearTimeout(ragTimeoutId);
    }

    if (ragDraft?.items?.length) {
      ragSearchQuery = ragDraft.searchQuery;
      ragSources = ragDraft.ragSources;
      totalDraftItems = ragDraft.items.length;

      const conversionResult = await this.convertRagDraftToItems(
        ragDraft,
        flow,
        config.fuzzyMatchThreshold,
      );
      items = conversionResult.items;
      matchedItems = conversionResult.matchedItems;
      tbdItems = conversionResult.tbdItems;

      // TBD 항목 제외 설정
      if (!config.includeTbdItems) {
        const beforeCount = items.length;
        items = items.filter((i) => !i.isTbd);
        if (beforeCount > items.length) {
          this.logger.log(
            `[generateFirstEstimate] TBD 항목 ${beforeCount - items.length}개 제외 (설정: includeTbdItems=false)`,
          );
        }
      }

      generationSource = 'rag';
      this.logger.log(
        `[generateFirstEstimate] RAG 성공: ${items.length}개 아이템, sources: ${ragDraft.ragSources.length}`,
      );
    }

    // === RAG 실패 → TBD 견적 ===
    if (items.length === 0) {
      this.logger.warn('[generateFirstEstimate] RAG 실패 - TBD 견적 생성');

      const metadata: AiEstimateMetadata = {
        generatedAt: new Date().toISOString(),
        generationTimeMs: Date.now() - startTime,
        source: 'tbd',
        ragSearch: ragSearchQuery
          ? {
            query: ragSearchQuery,
            resultsCount: 0,
            sources: [],
          }
          : null,
        itemMatching: {
          totalDraftItems: 0,
          matchedCount: 0,
          tbdCount: 0,
          matchedItems: [],
          tbdItems: [],
        },
        userAttractions: flow.attractions || [],
        config: {
          ragSearchLimit: config.ragSearchLimit,
          ragSimilarityMin: config.ragSimilarityMin,
          geminiTemperature: config.geminiTemperature,
        },
      };

      return this.generateTbdEstimate(
        flow,
        metadata,
        config.aiEstimateValidityDays,
        config.includeTbdItems,
      );
    }

    // 사용자 attractions 반영
    if (flow.attractions && flow.attractions.length > 0) {
      items = await this.applyUserAttractions(items, flow);
    }

    // _region 임시 프로퍼티 제거 (DB 저장 전)
    for (const item of items) {
      delete (item as EstimateItem & { _region?: string })._region;
    }

    // Metadata 구성
    const metadata: AiEstimateMetadata = {
      generatedAt: new Date().toISOString(),
      generationTimeMs: Date.now() - startTime,
      source: generationSource,
      ragSearch: ragSearchQuery
        ? {
          query: ragSearchQuery,
          resultsCount: ragSources.length,
          sources: ragSources,
        }
        : null,
      itemMatching: {
        totalDraftItems,
        matchedCount: matchedItems.length,
        tbdCount: tbdItems.length,
        matchedItems,
        tbdItems,
      },
      userAttractions: flow.attractions || [],
      config: {
        ragSearchLimit: config.ragSearchLimit,
        ragSimilarityMin: config.ragSimilarityMin,
        geminiTemperature: config.geminiTemperature,
      },
      pipelineLog: ragDraft?.pipelineLog,
    };

    // 신뢰도 점수 계산
    metadata.confidenceScore = this.calculateConfidenceScore(metadata);

    // Estimate 생성 + Flow 연결 (트랜잭션)
    const estimate = await this.prisma.$transaction(async (tx) => {
      const est = await this.createEstimate(
        flow,
        items,
        {
          generationSource,
          ragSources: ragDraft?.ragSources,
          aiMetadata: metadata,
        },
        tx,
        config.aiEstimateValidityDays,
      );

      await tx.chatbotFlow.update({
        where: { sessionId: flow.sessionId },
        data: { estimateId: est.id },
      });

      return est;
    });

    this.logger.log(
      `[generateFirstEstimate] 완료 - estimateId: ${estimate.id}, source: ${generationSource}`,
    );

    // 견적 임베딩 fire-and-forget
    this.emailEmbeddingService.embedEstimate(estimate.id).catch((e) => {
      this.logger.warn(
        `견적 임베딩 실패 (${estimate.id}): ${(e as Error).message}`,
      );
    });

    return {
      estimateId: estimate.id,
      shareHash: estimate.shareHash,
      items: this.formatItemsForClient(items),
      hasTbdDays: items.some((item) => item.isTbd),
    };
  }

  /**
   * EstimateItem[] → 클라이언트용 가공
   */
  private formatItemsForClient(items: EstimateItem[]): FormattedEstimateItem[] {
    return items.map((item, idx) => ({
      id: String(item.itemId || `tbd-${item.dayNumber}-${idx}`),
      category: item.category || 'place',
      itemId: item.itemId || null,
      itemName: item.itemInfo?.nameKor || item.itemInfo?.nameEng,
      name: item.itemInfo?.nameKor,
      nameEng: item.itemInfo?.nameEng,
      dayNumber: item.dayNumber || 1,
      orderIndex: item.orderIndex || 0,
      isTbd: item.isTbd || false,
      note: item.note,
      itemInfo: item.itemInfo
        ? {
          nameKor: item.itemInfo.nameKor,
          nameEng: item.itemInfo.nameEng,
          descriptionEng: item.itemInfo.descriptionEng,
          images: extractImageUrls(item.itemInfo.images),
          lat: item.itemInfo.lat,
          lng: item.itemInfo.lng,
          addressEnglish: item.itemInfo.addressEnglish,
        }
        : undefined,
    }));
  }

  /**
   * RAG 초안을 EstimateItem[]으로 변환
   * - Gemini itemId 직접 매칭 (Tier 0)
   * - PlaceMatcherService로 3-tier 매칭 (exact → partial → fuzzy)
   * - 매칭 실패 시 TBD 아이템 생성
   */
  private async convertRagDraftToItems(
    draft: DraftResult,
    flow: ChatbotFlowData,
    fuzzyThreshold = 0.3,
  ): Promise<{
    items: EstimateItem[];
    matchedItems: MatchedItemInfo[];
    tbdItems: Array<{ name: string; reason: string }>;
  }> {
    const totalPax = calculateTotalPax(flow);
    const matchedItems: MatchedItemInfo[] = [];
    const tbdItems: Array<{ name: string; reason: string }> = [];
    const resultMap = new Map<number, EstimateItem>();

    // --- Tier 0: Gemini itemId 직접 매칭 ---
    const directItemIds = draft.items
      .filter((d) => d.itemId && d.itemId > 0)
      .map((d) => d.itemId as number);

    const directItemMap = await this.placeMatcher.findItemsByIds(directItemIds);

    // Gemini 매칭 처리 + 이름 매칭 대상 분리
    const nameMatchInputs: {
      index: number;
      name: string;
      nameKor?: string;
      draftItem: (typeof draft.items)[0];
    }[] = [];

    for (let i = 0; i < draft.items.length; i++) {
      const draftItem = draft.items[i];

      if (draftItem.itemId && directItemMap.has(draftItem.itemId)) {
        const dbMatch = directItemMap.get(draftItem.itemId)!;
        resultMap.set(i, this.buildEstimateItem(draftItem, dbMatch, totalPax));
        matchedItems.push({
          name: draftItem.placeName,
          itemId: dbMatch.id,
          tier: 'geminiId',
        });
      } else {
        nameMatchInputs.push({
          index: i,
          name: draftItem.placeName,
          nameKor: draftItem.placeNameKor,
          draftItem,
        });
      }
    }

    // --- Tier 1-3: PlaceMatcherService (exact → partial → fuzzy) ---
    if (nameMatchInputs.length > 0) {
      const matchResults = await this.placeMatcher.matchPlaces(
        nameMatchInputs.map((m) => ({ name: m.name, nameKor: m.nameKor })),
        { fuzzyThreshold, fullSelect: true, region: flow.region || undefined },
      );

      for (let j = 0; j < nameMatchInputs.length; j++) {
        const { index, draftItem } = nameMatchInputs[j];
        const result = matchResults[j];

        if (result.tier !== 'unmatched' && result.item) {
          resultMap.set(
            index,
            this.buildEstimateItem(draftItem, result.item, totalPax),
          );
          matchedItems.push({
            name: draftItem.placeName,
            itemId: result.item.id,
            tier: result.tier as MatchTier,
            score: result.score,
          });
        } else {
          // TBD — 후처리에서 disabled 아이템 여부 체크 후 제외
          resultMap.set(index, {
            id: generateItemId(),
            dayNumber: draftItem.dayNumber,
            orderIndex: draftItem.orderIndex,
            category: 'place',
            itemId: undefined,
            isTbd: true,
            itemName: draftItem.placeName,
            name: draftItem.placeName,
            nameEng: draftItem.placeName,
            quantity: 1,
            unitPrice: 0,
            subtotal: 0,
            note: `${draftItem.reason} (전문가 확인 필요)`,
          });
          tbdItems.push({
            name: draftItem.placeName,
            reason: draftItem.reason || 'No DB match',
          });
        }
      }
    }

    // 원래 순서 유지하여 배열로 변환
    let items: EstimateItem[] = [];
    for (let i = 0; i < draft.items.length; i++) {
      const item = resultMap.get(i);
      if (item) items.push(item);
    }

    // 후처리 파이프라인
    this.logRegionMismatches(items, flow.region);
    items = this.deduplicateByDay(items);
    items = await this.filterDisabledTbdItems(items);
    this.reindexOrderByDay(items);

    this.logger.log(
      `[convertRagDraftToItems] ${draft.items.length} draft items → ` +
      `geminiId: ${matchedItems.filter((m) => m.tier === 'geminiId').length}, ` +
      `exact: ${matchedItems.filter((m) => m.tier === 'exact').length}, ` +
      `partial: ${matchedItems.filter((m) => m.tier === 'partial').length}, ` +
      `fuzzy: ${matchedItems.filter((m) => m.tier === 'fuzzy').length}, ` +
      `tbd: ${tbdItems.length} → 후처리 후: ${items.length}개`,
    );

    return { items, matchedItems, tbdItems };
  }

  /**
   * 후처리: 다른 지역 아이템 감지 로깅 (제거하지 않음)
   */
  private logRegionMismatches(
    items: EstimateItem[],
    region: string | null,
  ): void {
    const requestedRegion = region?.toLowerCase();
    if (!requestedRegion) return;

    const regionKor = this.REGION_MAP[requestedRegion];
    const allowedRegions = new Set(
      [requestedRegion, regionKor]
        .filter(Boolean)
        .map((r) => r.toLowerCase()),
    );
    for (const item of items) {
      if (item.isTbd || !item.itemId) continue;
      const itemRegion = (item as EstimateItem & { _region?: string })._region;
      if (!itemRegion) continue;
      if (!allowedRegions.has(itemRegion.toLowerCase())) {
        this.logger.log(
          `[postFilter:region] 다른 지역 감지 (유지됨): "${item.itemInfo?.nameKor || item.itemInfo?.nameEng}" (region=${itemRegion}, 요청=${requestedRegion})`,
        );
      }
    }
  }

  /**
   * 후처리: 같은 날짜 내 중복 itemId 제거 (다른 날짜 재방문은 허용)
   */
  private deduplicateByDay(items: EstimateItem[]): EstimateItem[] {
    const seenItemsPerDay = new Map<number, Set<number>>();
    const beforeCount = items.length;

    const filtered = items.filter((item) => {
      if (item.isTbd || !item.itemId) return true;
      const day = item.dayNumber || 1;
      if (!seenItemsPerDay.has(day)) seenItemsPerDay.set(day, new Set());
      const dailySeen = seenItemsPerDay.get(day)!;
      if (dailySeen.has(item.itemId)) {
        this.logger.log(
          `[postFilter:dedup] Day ${day} 중복 제거: "${item.itemInfo?.nameKor || item.itemInfo?.nameEng}" (itemId=${item.itemId})`,
        );
        return false;
      }
      dailySeen.add(item.itemId);
      return true;
    });

    if (beforeCount > filtered.length) {
      this.logger.log(
        `[postFilter:dedup] ${beforeCount - filtered.length}개 일자 내 중복 아이템 제거`,
      );
    }
    return filtered;
  }

  /**
   * 후처리: aiEnabled=false 아이템이 TBD로 생성된 경우 제외
   */
  private async filterDisabledTbdItems(
    items: EstimateItem[],
  ): Promise<EstimateItem[]> {
    const tbdNames = items
      .filter((i) => i.isTbd && i.name)
      .map((i) => i.name!);
    if (tbdNames.length === 0) return items;

    const disabledNames =
      await this.placeMatcher.findDisabledMatches(tbdNames);
    if (disabledNames.size === 0) return items;

    const beforeCount = items.length;
    const filtered = items.filter((item) => {
      if (!item.isTbd || !item.name) return true;
      if (disabledNames.has(item.name)) {
        this.logger.log(
          `[postFilter:aiDisabled] 제거: "${item.name}" (AI 추천 비활성화 아이템)`,
        );
        return false;
      }
      return true;
    });

    if (beforeCount > filtered.length) {
      this.logger.log(
        `[postFilter:aiDisabled] ${beforeCount - filtered.length}개 비활성화 아이템 제거`,
      );
    }
    return filtered;
  }

  /**
   * 후처리: 일자별 orderIndex 재정렬
   */
  private reindexOrderByDay(items: EstimateItem[]): void {
    const dayGroups = new Map<number, EstimateItem[]>();
    for (const item of items) {
      const day = item.dayNumber;
      if (!dayGroups.has(day)) dayGroups.set(day, []);
      dayGroups.get(day)!.push(item);
    }
    for (const dayItems of dayGroups.values()) {
      dayItems.forEach((item, idx) => {
        item.orderIndex = idx;
      });
    }
  }

  /**
   * DraftItem + DB 아이템 → EstimateItem 생성 헬퍼
   */
  private buildEstimateItem(
    draftItem: { dayNumber: number; orderIndex: number; timeOfDay?: string; expectedDurationMins?: number; reason: string },
    dbMatch: {
      id: number;
      nameKor: string;
      nameEng: string;
      descriptionEng: string | null;
      images: unknown;
      lat: unknown;
      lng: unknown;
      addressEnglish: string | null;
      price: unknown;
      region?: string | null;
    },
    totalPax: number,
  ): EstimateItem {
    const unitPrice = Number(dbMatch.price) || 0;
    const item: EstimateItem & { _region?: string } = {
      id: generateItemId(),
      dayNumber: draftItem.dayNumber,
      orderIndex: draftItem.orderIndex,
      category: 'place',
      itemId: dbMatch.id,
      isTbd: false,
      quantity: totalPax,
      unitPrice,
      subtotal: unitPrice * totalPax,
      note: `[${draftItem.timeOfDay || 'Anytime'}${draftItem.expectedDurationMins ? ` - ${draftItem.expectedDurationMins}m` : ''}] ${draftItem.reason}`,
      itemInfo: buildItemInfo(dbMatch),
    };
    // 후처리 지역 필터용 (DB 저장 시 제거됨)
    if (dbMatch.region) item._region = dbMatch.region;
    return item;
  }

  /**
   * 사용자 선택 명소 반영
   */
  private async applyUserAttractions(
    items: EstimateItem[],
    flow: ChatbotFlowData,
  ): Promise<EstimateItem[]> {
    if (!flow.attractions || flow.attractions.length === 0) {
      return items;
    }

    const totalPax = calculateTotalPax(flow);
    const existingItemIds = new Set(
      items.filter((i) => i.itemId).map((i) => i.itemId),
    );

    // attractions 이름으로 Item 조회 (요청 지역 필터 포함)
    const regionFilter = flow.region
      ? {
        region: {
          in: [
            flow.region,
            this.REGION_MAP[flow.region] || flow.region,
          ].filter(Boolean),
        },
      }
      : {};
    const attractionItems = await this.prisma.item.findMany({
      where: {
        category: 'place',
        aiEnabled: true,
        ...regionFilter,
        OR: flow.attractions.map((name) => ({
          OR: [
            { nameEng: { contains: name, mode: 'insensitive' as const } },
            { nameKor: { contains: name } },
          ],
        })),
      },
      select: {
        id: true,
        nameKor: true,
        nameEng: true,
        descriptionEng: true,
        images: true,
        lat: true,
        lng: true,
        addressEnglish: true,
        price: true,
      },
      take: flow.attractions.length * 2,
    });

    const result = [...items];
    const duration = flow.duration || 3;

    // dayCount를 한 번만 계산하고, 추가할 때마다 업데이트
    const dayCount: Record<number, number> = {};
    for (let d = 1; d <= duration; d++) dayCount[d] = 0;
    for (const i of result) {
      if (
        i.category === 'place' &&
        !i.isTbd &&
        dayCount[i.dayNumber] !== undefined
      ) {
        dayCount[i.dayNumber]++;
      }
    }

    for (const attraction of attractionItems) {
      // 이미 있으면 스킵
      if (existingItemIds.has(attraction.id)) continue;

      // 가장 장소 수가 적은 날에 추가
      const targetDay = Object.entries(dayCount).sort(
        ([, a], [, b]) => a - b,
      )[0]?.[0];
      const dayNumber = targetDay ? parseInt(targetDay) : 1;
      const maxOrder = Math.max(
        ...result
          .filter((i) => i.dayNumber === dayNumber)
          .map((i) => i.orderIndex),
        -1,
      );

      const unitPrice = Number(attraction.price) || 0;
      result.push({
        id: generateItemId(),
        dayNumber,
        orderIndex: maxOrder + 1,
        category: 'place',
        itemId: attraction.id,
        isTbd: false,
        quantity: totalPax,
        unitPrice,
        subtotal: unitPrice * totalPax,
        itemInfo: buildItemInfo(attraction),
      });

      existingItemIds.add(attraction.id);
      dayCount[dayNumber]++;
      this.logger.log(
        `[applyUserAttractions] ${attraction.nameKor} → Day ${dayNumber} 추가`,
      );
    }

    return result;
  }

  /**
   * 신뢰도 점수 계산 (0-100)
   * 매칭 tier별 가중치: geminiId/exact=1.0, partial=0.8, fuzzy=0.5
   */
  private calculateConfidenceScore(metadata: AiEstimateMetadata): number {
    const { itemMatching, ragSearch, pipelineLog } = metadata;

    const totalItems = itemMatching.totalDraftItems;
    if (totalItems === 0) return 0;

    // matchQuality: tier별 가중 매칭률 (geminiId/exact=1.0, partial=0.8, fuzzy=0.5)
    const tierWeights: Record<string, number> = {
      geminiId: 1.0,
      exact: 1.0,
      partial: 0.8,
      fuzzy: 0.5,
    };
    const weightedMatchSum = itemMatching.matchedItems.reduce(
      (sum, m) => sum + (tierWeights[m.tier] ?? 0.5),
      0,
    );
    const matchQuality = weightedMatchSum / totalItems;

    // avgRagSimilarity: 상위 3개 RAG 소스 평균 유사도
    const sources = ragSearch?.sources || [];
    const topSources = sources.slice(0, 3);
    const avgRagSimilarity =
      topSources.length > 0
        ? topSources.reduce((sum, s) => sum + s.similarity, 0) /
        topSources.length
        : 0;

    // interestCoverage: 사용자 관심사가 장소에 반영된 비율
    let interestCoverage = 0;
    if (pipelineLog?.reranking?.keywords?.length) {
      const totalKeywords = pipelineLog.reranking.keywords.length;
      const matchedKeywords = new Set<string>();
      for (const detail of pipelineLog.reranking.details.slice(
        0,
        topSources.length,
      )) {
        for (const kw of detail.matchedKeywords) {
          matchedKeywords.add(kw);
        }
      }
      interestCoverage = matchedKeywords.size / totalKeywords;
    }

    // tbdRate: TBD 아이템 / 전체 아이템
    const tbdRate = itemMatching.tbdCount / totalItems;

    const score =
      0.35 * matchQuality +
      0.25 * avgRagSimilarity +
      0.2 * interestCoverage +
      0.2 * (1 - tbdRate);

    // 0-100으로 스케일
    return Math.round(Math.min(100, Math.max(0, score * 100)));
  }

  /**
   * TBD 전용 견적 생성 (템플릿 없을 때)
   */
  private async generateTbdEstimate(
    flow: ChatbotFlowData,
    aiMetadata?: AiEstimateMetadata,
    validityDays?: number,
    includeTbdItems = true,
  ): Promise<{
    estimateId: number;
    shareHash: string;
    items: FormattedEstimateItem[];
    hasTbdDays: boolean;
  }> {
    const duration = flow.duration || 3;
    const items: EstimateItem[] = [];

    if (includeTbdItems) {
      for (let day = 1; day <= duration; day++) {
        items.push({
          id: generateItemId(),
          dayNumber: day,
          orderIndex: 0,
          category: 'place',
          itemId: undefined,
          isTbd: true,
          note: '전문가 상담 후 확정 예정',
          quantity: 1,
          unitPrice: 0,
          subtotal: 0,
        });
      }
    }

    // 사용자 attractions가 있으면 반영
    let finalItems = items;
    if (flow.attractions && flow.attractions.length > 0) {
      finalItems = await this.applyUserAttractions(items, flow);
    }

    // Estimate 생성 + Flow 연결 (트랜잭션)
    const estimate = await this.prisma.$transaction(async (tx) => {
      const est = await this.createEstimate(
        flow,
        finalItems,
        {
          aiMetadata,
        },
        tx,
        validityDays,
      );

      await tx.chatbotFlow.update({
        where: { sessionId: flow.sessionId },
        data: { estimateId: est.id },
      });

      return est;
    });

    return {
      estimateId: estimate.id,
      shareHash: estimate.shareHash,
      items: this.formatItemsForClient(finalItems),
      hasTbdDays: finalItems.some((item) => item.isTbd),
    };
  }

  /**
   * Estimate 생성
   */
  private async createEstimate(
    flow: ChatbotFlowData,
    items: EstimateItem[],
    extra?: {
      generationSource?: 'rag' | 'tbd';
      ragSources?: DraftResult['ragSources'];
      aiMetadata?: AiEstimateMetadata;
    },
    tx?: Prisma.TransactionClient,
    validityDays?: number,
  ): Promise<{ id: number; shareHash: string }> {
    const totalPax = calculateTotalPax(flow);
    const region = flow.region || 'unknown';
    const regionKor = this.REGION_MAP[region] || region;
    const duration = flow.duration || 3;

    // shareHash 생성
    const shareHash = randomUUID().replace(/-/g, '').substring(0, 16);

    // 제목 생성
    const customerName = flow.customerName || 'Guest';
    const title = `${customerName} (${region} ${duration}D)`;

    // 내부 메모 생성 (관리자용)
    const internalMemo = this.buildInternalMemo(flow, extra);

    // 고객 요청사항 (requestContent)
    const requestContent = this.buildRequestContent(flow);

    // 유효기간: config에서 읽은 일수 (기본 2일)
    const validDate = new Date();
    validDate.setDate(validDate.getDate() + (validityDays ?? 2));

    const db = tx || this.prisma;
    const estimate = await db.estimate.create({
      data: {
        title,
        items: items as unknown as Prisma.InputJsonValue,
        regions: [region, regionKor],
        interests: [...(flow.interestMain || []), ...(flow.interestSub || [])],
        travelDays: duration,
        adultsCount: flow.adultsCount || 1,
        childrenCount: flow.childrenCount || 0,
        infantsCount: flow.infantsCount || 0,
        startDate: flow.travelDate,
        endDate: flow.travelDate
          ? new Date(
            new Date(flow.travelDate).getTime() +
            (duration - 1) * 24 * 60 * 60 * 1000,
          )
          : null,
        customerName: flow.customerName,
        customerEmail: flow.customerEmail,
        customerPhone: flow.customerPhone,
        nationality: flow.nationality,
        source: EstimateSource.AI,
        statusAi: EstimateStatusAi.DRAFT,
        chatSessionId: flow.sessionId,
        shareHash,
        internalMemo,
        requestContent,
        totalAmount: items.reduce((sum, item) => sum + (item.subtotal ?? 0), 0),
        validDate,
        displayOptions: {
          place: true,
          accommodation: true,
          transportation: true,
          contents: true,
          price: false, // AI 견적은 가격 숨김
        },
        aiMetadata: extra?.aiMetadata
          ? (extra.aiMetadata as unknown as Prisma.InputJsonValue)
          : undefined,
      },
    });

    return { id: estimate.id, shareHash };
  }

  /**
   * 내부 메모 생성 (관리자용)
   */
  private buildInternalMemo(
    flow: ChatbotFlowData,
    extra?: {
      generationSource?: 'rag' | 'tbd';
      ragSources?: DraftResult['ragSources'];
    },
  ): string {
    const lines: string[] = [];

    lines.push('══════════════ AI 견적 생성 리포트 ══════════════');
    lines.push('');
    lines.push(`📅 생성 시간: ${formatDateTimeKR()}`);
    lines.push(
      `🔧 생성 소스: ${extra?.generationSource === 'rag' ? 'Email RAG' : 'TBD (수동 필요)'}`,
    );
    lines.push('');

    // RAG 참조 이메일
    if (extra?.generationSource === 'rag' && extra.ragSources?.length) {
      lines.push('━━━ 📧 Email RAG 참조 이메일 ━━━');
      for (const src of extra.ragSources) {
        lines.push(
          `   • [유사도 ${(src.similarity * 100).toFixed(1)}%] ${src.subject || 'N/A'} (thread #${src.emailThreadId})`,
        );
      }
      lines.push('');
    }

    // 고객 요청 정보
    lines.push('━━━ 👤 고객 요청 정보 ━━━');
    lines.push(`• 지역: ${flow.region || 'Not selected'}`);
    lines.push(`• 요청 일수: ${flow.duration || 3}일`);
    lines.push(
      `• 인원: 성인 ${flow.adultsCount || 1}, 아동 ${flow.childrenCount || 0}, 유아 ${flow.infantsCount || 0}`,
    );
    if (flow.interestMain?.length)
      lines.push(`• 관심사(주): ${flow.interestMain.join(', ')}`);
    if (flow.interestSub?.length)
      lines.push(`• 관심사(부): ${flow.interestSub.join(', ')}`);
    if (flow.attractions?.length)
      lines.push(`• 희망 명소: ${flow.attractions.join(', ')}`);
    if (flow.isFirstVisit !== null)
      lines.push(`• 첫 방문: ${flow.isFirstVisit ? '예' : '아니오'}`);
    if (flow.budgetRange) lines.push(`• 예산: ${flow.budgetRange}`);
    if (flow.needsPickup) lines.push('• 공항 픽업 필요');
    if (flow.additionalNotes)
      lines.push(`• 추가 요청: ${flow.additionalNotes}`);

    return lines.join('\n');
  }

  /**
   * 고객 요청사항 생성 (requestContent - 고객이 입력한 내용)
   */
  private buildRequestContent(flow: ChatbotFlowData): string {
    const lines: string[] = [];

    // 기본 여행 정보
    lines.push(`지역: ${flow.region || 'Not selected'}`);
    lines.push(`여행 일수: ${flow.duration || 3}일`);
    lines.push(
      `인원: 성인 ${flow.adultsCount || 1}명, 아동 ${flow.childrenCount || 0}명, 유아 ${flow.infantsCount || 0}명`,
    );

    if (flow.travelDate) {
      lines.push(
        `여행 날짜: ${formatDateKR(flow.travelDate)}`,
      );
    }

    if (flow.interestMain?.length) {
      lines.push(`관심사: ${flow.interestMain.join(', ')}`);
    }

    if (flow.attractions?.length) {
      lines.push(`희망 명소: ${flow.attractions.join(', ')}`);
    }

    if (flow.isFirstVisit !== null) {
      lines.push(`한국 첫 방문: ${flow.isFirstVisit ? '예' : '아니오'}`);
    }

    if (flow.budgetRange) {
      lines.push(`예산: ${flow.budgetRange}`);
    }

    if (flow.needsPickup !== null && flow.needsPickup) {
      lines.push('공항 픽업 필요');
    }

    // 고객이 직접 입력한 추가 요청사항
    if (flow.additionalNotes) {
      lines.push('');
      lines.push('--- 추가 요청사항 ---');
      lines.push(flow.additionalNotes);
    }

    return lines.join('\n');
  }

  /**
   * ChatbotFlow 조회
   */
  private async getChatbotFlow(
    sessionId: string,
  ): Promise<ChatbotFlowData | null> {
    const flow = await this.prisma.chatbotFlow.findUnique({
      where: { sessionId },
    });

    if (!flow) return null;

    return {
      sessionId: flow.sessionId,
      region: flow.region,
      duration: flow.duration,
      interestMain: flow.interestMain || [],
      interestSub: flow.interestSub || [],
      attractions: flow.attractions || [],
      tourType: flow.tourType,
      isFirstVisit: flow.isFirstVisit,
      adultsCount: flow.adultsCount,
      childrenCount: flow.childrenCount,
      infantsCount: flow.infantsCount,
      seniorsCount: flow.seniorsCount,
      ageRange: flow.ageRange,
      budgetRange: flow.budgetRange,
      needsPickup: flow.needsPickup,
      customerName: flow.customerName,
      customerEmail: flow.customerEmail,
      customerPhone: flow.customerPhone,
      nationality: flow.nationality,
      travelDate: flow.travelDate,
      additionalNotes: flow.additionalNotes,
    };
  }

  /**
   * 수정 요청 처리
   */
  async modifyEstimate(
    estimateId: number,
    request: {
      dayNumber?: number;
      replaceItemId?: number;
      action: 'replace' | 'add' | 'remove';
      preference?: string;
    },
  ): Promise<{ success: boolean; items: EstimateItem[] }> {
    const estimate = await this.prisma.estimate.findUnique({
      where: { id: estimateId },
    });

    if (!estimate) {
      throw new NotFoundException('Estimate not found.');
    }

    const currentItems = jsonCast<EstimateItem[]>(estimate.items);
    let newItems = [...currentItems];

    if (
      request.action === 'remove' &&
      request.dayNumber &&
      request.replaceItemId
    ) {
      newItems = currentItems.filter(
        (item) =>
          !(
            item.dayNumber === request.dayNumber &&
            item.itemId === request.replaceItemId
          ),
      );
      // orderIndex 재정렬
      newItems = this.reorderItems(newItems);
    }

    await this.prisma.estimate.update({
      where: { id: estimateId },
      data: { items: newItems as unknown as Prisma.InputJsonValue },
    });

    return { success: true, items: newItems };
  }

  /**
   * 아이템 순서 재정렬
   */
  private reorderItems(items: EstimateItem[]): EstimateItem[] {
    const byDay: Record<number, EstimateItem[]> = {};

    items.forEach((item) => {
      if (!byDay[item.dayNumber]) byDay[item.dayNumber] = [];
      byDay[item.dayNumber].push(item);
    });

    const result: EstimateItem[] = [];
    Object.keys(byDay)
      .map(Number)
      .sort((a, b) => a - b)
      .forEach((day) => {
        byDay[day]
          .sort((a, b) => a.orderIndex - b.orderIndex)
          .forEach((item, idx) => {
            result.push({ ...item, orderIndex: idx });
          });
      });

    return result;
  }
}
