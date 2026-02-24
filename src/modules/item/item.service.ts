import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { convertDecimalFields } from '../../common/utils/decimal.util';
import { MemoryCache, sanitizeSearch } from '../../common/utils';
import { CACHE_TTL } from '../../common/constants/cache';
import { DASHBOARD_EVENTS } from '../../common/events';
import {
  calculateSkip,
  createPaginatedResponse,
} from '../../common/dto/pagination.dto';

// 아이템 목록 조회용 타입
export interface ItemListItem {
  id: number;
  type: string;
  nameKor: string | null;
  nameEng: string | null;
  keyword: string | null;
  price: number;
  weekdayPrice: number | null;
  weekendPrice: number | null;
  region: string | null;
  area: string | null;
}

@Injectable()
export class ItemService {
  private readonly logger = new Logger(ItemService.name);
  private cache = new MemoryCache(CACHE_TTL.ITEM);

  constructor(
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
  ) {}

  // 아이템 목록 조회
  async getItems(params: {
    page?: number;
    limit?: number;
    type?: string;
    region?: string;
    search?: string;
  }) {
    const { page = 1, limit = 20, type, region, search } = params;
    const skip = calculateSkip(page, limit);

    const where: Prisma.ItemWhereInput = {};

    if (type) {
      where.type = type;
    }

    if (region) {
      where.region = region;
    }

    const sanitized = sanitizeSearch(search);
    if (sanitized) {
      where.OR = [
        { nameKor: { contains: sanitized, mode: 'insensitive' } },
        { nameEng: { contains: sanitized, mode: 'insensitive' } },
        { keyword: { contains: sanitized, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.item.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          type: true,
          nameKor: true,
          nameEng: true,
          description: true,
          descriptionEng: true,
          keyword: true,
          price: true,
          weekdayPrice: true,
          weekendPrice: true,
          address: true,
          addressEnglish: true,
          lat: true,
          lng: true,
          region: true,
          area: true,
          categories: true,
          images: true,
          createdAt: true,
          updatedAt: true,
          aiEnabled: true,
        },
      }),
      this.prisma.item.count({ where }),
    ]);

    return createPaginatedResponse(
      items.map(convertDecimalFields),
      total,
      page,
      limit,
    );
  }

  // 아이템 상세 조회
  async getItem(id: number) {
    const item = await this.prisma.item.findUnique({
      where: { id },
    });

    if (!item) {
      throw new NotFoundException('아이템을 찾을 수 없습니다');
    }

    return convertDecimalFields(item);
  }

  // 여러 아이템 한번에 조회
  async getItemsByIds(ids: number[]) {
    const items = await this.prisma.item.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        type: true,
        nameKor: true,
        nameEng: true,
        description: true,
        descriptionEng: true,
        keyword: true,
        price: true,
        weekdayPrice: true,
        weekendPrice: true,
        address: true,
        addressEnglish: true,
        lat: true,
        lng: true,
        region: true,
        area: true,
        categories: true,
        images: true,
        createdAt: true,
        updatedAt: true,
        aiEnabled: true,
      },
    });
    return items.map(convertDecimalFields);
  }

  // 아이템 생성
  async createItem(data: Prisma.ItemCreateInput) {
    const item = await this.prisma.item.create({ data });
    this.invalidateItemCache(item.type);
    return convertDecimalFields(item);
  }

  // 아이템 업데이트
  async updateItem(id: number, data: Prisma.ItemUpdateInput) {
    try {
      const item = await this.prisma.item.update({
        where: { id },
        data,
      });
      this.invalidateItemCache(item.type);
      return convertDecimalFields(item);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('아이템을 찾을 수 없습니다');
      }
      throw error;
    }
  }

  // 아이템 복제
  async duplicateItem(id: number) {
    const original = await this.prisma.item.findUnique({
      where: { id },
    });

    if (!original) {
      throw new NotFoundException('아이템을 찾을 수 없습니다');
    }

    const newItem = await this.prisma.item.create({
      data: {
        type: original.type,
        nameKor: `${original.nameKor} (복사본)`,
        nameEng: `${original.nameEng} (Copy)`,
        description: original.description,
        descriptionEng: original.descriptionEng,
        keyword: original.keyword,
        price: original.price,
        weekdayPrice: original.weekdayPrice,
        weekendPrice: original.weekendPrice,
        address: original.address,
        addressEnglish: original.addressEnglish,
        lat: original.lat,
        lng: original.lng,
        websiteLink: original.websiteLink,
        images: original.images || [],
        region: original.region,
        area: original.area,
        categories: original.categories,
        metadata: original.metadata || undefined,
        // tourApiContentId는 복제하지 않음
      },
    });

    this.invalidateItemCache(newItem.type);
    return convertDecimalFields(newItem);
  }

  // 아이템 삭제
  async deleteItem(id: number) {
    try {
      const item = await this.prisma.item.delete({
        where: { id },
      });
      this.invalidateItemCache(item.type);
      return { success: true, message: '삭제되었습니다' };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('아이템을 찾을 수 없습니다');
      }
      throw error;
    }
  }

  // AI 추천 토글
  async toggleAiEnabled(id: number) {
    const item = await this.prisma.item.findUnique({
      where: { id },
      select: { aiEnabled: true, type: true },
    });
    if (!item) {
      throw new NotFoundException('아이템을 찾을 수 없습니다');
    }
    const updated = await this.prisma.item.update({
      where: { id },
      data: { aiEnabled: !item.aiEnabled },
    });
    this.invalidateItemCache(updated.type);
    return convertDecimalFields(updated);
  }

  // 타입별 아이템 조회 (캐싱 적용)
  async getItemsByType(type: string) {
    const cacheKey = `items_type_${type}`;
    const cached = this.cache.get<{ data: ItemListItem[] }>(cacheKey);
    if (cached) return cached;

    const items = await this.prisma.item.findMany({
      where: { type },
      orderBy: { nameKor: 'asc' },
      select: {
        id: true,
        type: true,
        nameKor: true,
        nameEng: true,
        keyword: true,
        price: true,
        weekdayPrice: true,
        weekendPrice: true,
        region: true,
        area: true,
        lat: true,
        lng: true,
      },
    });
    const result = { data: items.map(convertDecimalFields) };
    this.cache.set(cacheKey, result);
    return result;
  }

  // 지역별 아이템 조회 (캐싱 적용)
  async getItemsByRegion(region: string) {
    const cacheKey = `items_region_${region}`;
    const cached = this.cache.get<{ data: ItemListItem[] }>(cacheKey);
    if (cached) return cached;

    const items = await this.prisma.item.findMany({
      where: { region },
      orderBy: { nameKor: 'asc' },
      select: {
        id: true,
        type: true,
        nameKor: true,
        nameEng: true,
        keyword: true,
        price: true,
        weekdayPrice: true,
        weekendPrice: true,
        region: true,
        area: true,
        lat: true,
        lng: true,
      },
    });
    const result = { data: items.map(convertDecimalFields) };
    this.cache.set(cacheKey, result);
    return result;
  }

  // 선택적 캐시 무효화: 해당 타입과 지역 캐시만 삭제
  private invalidateItemCache(type?: string) {
    if (type) {
      this.cache.delete(`items_type_${type}`);
    }
    this.cache.deleteByPrefix('items_region_');
    this.eventEmitter.emit(DASHBOARD_EVENTS.INVALIDATE);
  }

  // interests → DB categories 매핑
  private readonly interestToCategoryMap: Record<string, string[]> = {
    // 테마
    culture: ['Theme:History', 'Theme:Art'],
    history: ['Theme:History'],
    art: ['Theme:Art'],
    museums: ['Theme:History', 'Theme:Art'],
    architecture: ['Theme:History', 'Theme:Art'],
    food: ['Theme:Foodie'],
    foodie: ['Theme:Foodie'],
    shopping: ['Theme:Shopping'],
    nature: ['Theme:Nature'],
    adventure: ['Theme:Adventure'],
    luxury: ['Theme:Luxury'],
    nightlife: ['Theme:Nightlife'],
    wellness: ['Theme:Wellness'],
    // 타겟
    'first-time': ['Target:First-Timer'],
    'off-beaten': ['Target:Off-Beaten'],
    'local-vibe': ['Target:Local-Vibe'],
    photogenic: ['Target:Photogenic'],
    // 인원
    family: ['Demographic:Family'],
    couple: ['Demographic:Couple'],
    solo: ['Demographic:Solo'],
    group: ['Demographic:Group'],
    kids: ['Demographic:Kids-Friendly'],
  };

  private mapInterestsToCategories(interests: string[]): string[] {
    const mapped = new Set<string>();
    for (const interest of interests) {
      const lower = interest.toLowerCase().replace(/[_\s]/g, '-');
      const categories = this.interestToCategoryMap[lower];
      if (categories) {
        categories.forEach((c) => mapped.add(c));
      }
    }
    return Array.from(mapped);
  }

  /**
   * 유사 아이템 검색 (AI 일정 수정용)
   * - 카테고리, 키워드, 지역 기반 매칭
   * - 이미 일정에 있는 아이템 제외
   * - 쿼리가 있으면 먼저 검색, 결과 없으면 카테고리/관심사로 폴백
   */
  async findSimilarItems(params: {
    query?: string;
    interests?: string[];
    categories?: string[];
    region?: string;
    type?: string;
    excludeIds?: number[];
    limit?: number;
  }) {
    const {
      query,
      interests = [],
      categories = [],
      region,
      type = 'place',
      excludeIds = [],
      limit = 20,
    } = params;

    // region 매핑 (영어 → 한글)
    const regionMap: Record<string, string[]> = {
      seoul: ['서울', 'seoul', 'Seoul'],
      busan: ['부산', 'busan', 'Busan'],
      jeju: ['제주', 'jeju', 'Jeju'],
      gyeonggi: ['경기', 'gyeonggi', 'Gyeonggi'],
      incheon: ['인천', 'incheon', 'Incheon'],
      daegu: ['대구', 'daegu', 'Daegu'],
      daejeon: ['대전', 'daejeon', 'Daejeon'],
      gwangju: ['광주', 'gwangju', 'Gwangju'],
      gangwon: ['강원', 'gangwon', 'Gangwon'],
    };

    // 지역 검색 조건 생성 (여러 변형 포함)
    const getRegionCondition = (
      regionInput?: string,
    ): Prisma.ItemWhereInput | undefined => {
      if (!regionInput) return undefined;
      const lowerRegion = regionInput.toLowerCase();
      const variants = regionMap[lowerRegion] || [regionInput];
      return {
        OR: variants.map((v) => ({
          region: { contains: v, mode: 'insensitive' as const },
        })),
      };
    };

    const regionCondition = getRegionCondition(region);
    // baseWhere에서 OR을 분리하여 AND로 조합할 수 있도록 함
    const baseWhere: Prisma.ItemWhereInput = {
      type,
      aiEnabled: true,
      ...(excludeIds.length > 0 && { id: { notIn: excludeIds } }),
    };
    // 지역 조건은 별도로 관리 (나중에 AND로 조합)
    const regionFilter = regionCondition;

    // 아이템 select 필드 (공통)
    const itemSelect = {
      id: true,
      type: true,
      nameKor: true,
      nameEng: true,
      keyword: true,
      categories: true,
      description: true,
      descriptionEng: true,
      price: true,
      region: true,
      area: true,
      images: true,
    } as const;

    // 1차 시도: 쿼리 텍스트로 이름 + 설명 통합 검색 (ILIKE)
    if (query) {
      const queryWhere: Prisma.ItemWhereInput = {
        AND: [
          baseWhere,
          ...(regionFilter ? [regionFilter] : []),
          {
            OR: [
              { nameEng: { contains: query, mode: 'insensitive' } },
              { nameKor: { contains: query, mode: 'insensitive' } },
              { keyword: { contains: query, mode: 'insensitive' } },
              { description: { contains: query, mode: 'insensitive' } },
              { descriptionEng: { contains: query, mode: 'insensitive' } },
            ],
          },
        ],
      };

      const results = await this.prisma.item.findMany({
        where: queryWhere,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: itemSelect,
      });

      if (results.length > 0) {
        return results.map(convertDecimalFields);
      }

      // 1-1. 공백 제거 후 재시도 (e.g. "노량진 수산시장" → "노량진수산시장")
      const queryNoSpace = query.replace(/\s+/g, '');
      if (queryNoSpace !== query) {
        const noSpaceResults = await this.prisma.item.findMany({
          where: {
            AND: [
              baseWhere,
              ...(regionFilter ? [regionFilter] : []),
              {
                OR: [
                  { nameEng: { contains: queryNoSpace, mode: 'insensitive' } },
                  { nameKor: { contains: queryNoSpace, mode: 'insensitive' } },
                  { keyword: { contains: queryNoSpace, mode: 'insensitive' } },
                ],
              },
            ],
          },
          take: limit,
          orderBy: { createdAt: 'desc' },
          select: itemSelect,
        });

        if (noSpaceResults.length > 0) {
          return noSpaceResults.map(convertDecimalFields);
        }
      }

      // 1-2. pg_trgm 유사도 검색 (fuzzy matching)
      const trigramResults = await this.findByTrigramSimilarity(
        query,
        type,
        excludeIds,
        limit,
      );
      if (trigramResults.length > 0) {
        return trigramResults;
      }
    }

    // 2차 시도: 카테고리/관심사 기반 검색
    // interests를 DB 카테고리 형식으로 매핑
    const mappedCategories = this.mapInterestsToCategories(interests);
    const allCategories = [...new Set([...categories, ...mappedCategories])];
    const categoryConditions: Prisma.ItemWhereInput[] = [baseWhere];
    if (regionFilter) categoryConditions.push(regionFilter);

    if (allCategories.length > 0 || interests.length > 0) {
      const orConditions: Prisma.ItemWhereInput[] = [];

      // 매핑된 카테고리로 검색
      if (allCategories.length > 0) {
        orConditions.push({ categories: { hasSome: allCategories } });
      }

      // 원본 interests로 keyword/description 검색 (영문)
      interests.forEach((interest) => {
        orConditions.push({
          keyword: { contains: interest, mode: 'insensitive' as const },
        });
        orConditions.push({
          description: { contains: interest, mode: 'insensitive' as const },
        });
      });

      if (orConditions.length > 0) {
        categoryConditions.push({ OR: orConditions });
      }
    }

    const categoryResults = await this.prisma.item.findMany({
      where: { AND: categoryConditions },
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: itemSelect,
    });

    if (categoryResults.length > 0) {
      return categoryResults.map(convertDecimalFields);
    }

    // 3차 시도: 지역/타입만으로 검색 (폴백)
    const fallbackConditions: Prisma.ItemWhereInput[] = [baseWhere];
    if (regionFilter) fallbackConditions.push(regionFilter);

    const fallbackResults = await this.prisma.item.findMany({
      where: { AND: fallbackConditions },
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: itemSelect,
    });

    return fallbackResults.map(convertDecimalFields);
  }

  /**
   * pg_trgm 유사도 기반 fuzzy 검색
   * - "Namsan Tower" → "N Seoul Tower" 등 다른 이름이지만 유사한 장소 매칭
   * - GIN trigram 인덱스 활용 (idx_items_name_eng_trgm, idx_items_name_kor_trgm)
   */
  private async findByTrigramSimilarity(
    query: string,
    type: string,
    excludeIds: number[],
    limit: number,
  ) {
    try {
      const excludeClause =
        excludeIds.length > 0
          ? Prisma.sql`AND id NOT IN (${Prisma.join(excludeIds)})`
          : Prisma.empty;

      const results = await this.prisma.$queryRaw<
        Array<{
          id: number;
          type: string;
          nameKor: string;
          nameEng: string;
          keyword: string | null;
          categories: string[];
          description: string;
          descriptionEng: string | null;
          price: number;
          region: string | null;
          area: string | null;
          images: unknown;
        }>
      >`
        SELECT
          id, type,
          name_kor AS "nameKor",
          name_eng AS "nameEng",
          keyword, categories, description,
          description_eng AS "descriptionEng",
          price::float8 AS price,
          region, area, images
        FROM items
        WHERE type = ${type}
          AND ai_enabled = true
          ${excludeClause}
          AND (
            similarity(name_eng, ${query}) > 0.2
            OR similarity(name_kor, ${query}) > 0.2
            OR similarity(COALESCE(keyword, ''), ${query}) > 0.3
          )
        ORDER BY GREATEST(
          similarity(name_eng, ${query}),
          similarity(name_kor, ${query}),
          similarity(COALESCE(keyword, ''), ${query})
        ) DESC
        LIMIT ${limit}
      `;

      if (results.length > 0) {
        this.logger.log(
          `Trigram search for "${query}": found ${results.length} items (top: ${results[0].nameEng})`,
        );
      }

      return results as any;
    } catch (e) {
      // pg_trgm 확장 스키마 이슈 등 — 조용히 빈 배열 반환
      this.logger.warn(`Trigram similarity search failed: ${e.message}`);
      return [];
    }
  }

  /**
   * 카테고리/키워드로 아이템 추천 (AI 선택용 후보 목록)
   */
  async getRecommendationCandidates(params: {
    category?: string;
    interests?: string[];
    region?: string;
    excludeIds?: number[];
    limit?: number;
  }) {
    const {
      category,
      interests = [],
      region,
      excludeIds = [],
      limit = 15,
    } = params;

    const searchTerms: string[] = [];
    if (category) searchTerms.push(category);
    searchTerms.push(...interests);

    const where: Prisma.ItemWhereInput = {
      type: 'place',
      aiEnabled: true,
      ...(excludeIds.length > 0 && { id: { notIn: excludeIds } }),
      ...(region && { region: { contains: region, mode: 'insensitive' } }),
    };

    if (searchTerms.length > 0) {
      where.OR = [
        { categories: { hasSome: searchTerms } },
        ...searchTerms.map((term) => ({
          keyword: { contains: term, mode: 'insensitive' as const },
        })),
        ...searchTerms.map((term) => ({
          descriptionEng: { contains: term, mode: 'insensitive' as const },
        })),
      ];
    }

    const items = await this.prisma.item.findMany({
      where,
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        nameKor: true,
        nameEng: true,
        keyword: true,
        categories: true,
        descriptionEng: true,
        region: true,
        area: true,
        images: true,
      },
    });

    return items.map(convertDecimalFields);
  }
}
