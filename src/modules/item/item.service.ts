import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { convertDecimalFields } from '../../common/utils/decimal.util';
import { MemoryCache, sanitizeSearch } from '../../common/utils';
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
  private cache = new MemoryCache(60 * 60 * 1000); // 1시간

  constructor(private prisma: PrismaService) {}

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
          keyword: true,
          price: true,
          weekdayPrice: true,
          weekendPrice: true,
          region: true,
          area: true,
          images: true,
          createdAt: true,
          updatedAt: true,
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
    });
    return items.map(convertDecimalFields);
  }

  // 아이템 생성
  async createItem(data: Prisma.ItemCreateInput) {
    const item = await this.prisma.item.create({ data });
    this.cache.clear();
    return item;
  }

  // 아이템 업데이트
  async updateItem(id: number, data: Prisma.ItemUpdateInput) {
    const item = await this.prisma.item.update({
      where: { id },
      data,
    });
    this.cache.clear();
    return item;
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

    this.cache.clear();
    return convertDecimalFields(newItem);
  }

  // 아이템 삭제
  async deleteItem(id: number) {
    // 존재 여부 확인
    const item = await this.prisma.item.findUnique({
      where: { id },
    });

    if (!item) {
      throw new NotFoundException('아이템을 찾을 수 없습니다');
    }

    await this.prisma.item.delete({
      where: { id },
    });

    this.cache.clear();
    return { success: true, message: '삭제되었습니다' };
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
      ...(excludeIds.length > 0 && { id: { notIn: excludeIds } }),
    };
    // 지역 조건은 별도로 관리 (나중에 AND로 조합)
    const regionFilter = regionCondition;

    // 1차 시도: 쿼리 텍스트로 이름 검색 (정확도 우선)
    if (query) {
      // 먼저 이름/키워드로만 검색 (더 정확함)
      const nameQueryWhere: Prisma.ItemWhereInput = {
        AND: [
          baseWhere,
          ...(regionFilter ? [regionFilter] : []),
          {
            OR: [
              { nameEng: { contains: query, mode: 'insensitive' } },
              { nameKor: { contains: query, mode: 'insensitive' } },
              { keyword: { contains: query, mode: 'insensitive' } },
            ],
          },
        ],
      };

      const nameResults = await this.prisma.item.findMany({
        where: nameQueryWhere,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
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
        },
      });

      if (nameResults.length > 0) {
        return nameResults.map(convertDecimalFields);
      }

      // 이름에서 못 찾으면 설명에서 검색 (fallback)
      const descQueryWhere: Prisma.ItemWhereInput = {
        AND: [
          baseWhere,
          ...(regionFilter ? [regionFilter] : []),
          {
            OR: [
              { description: { contains: query, mode: 'insensitive' } },
              { descriptionEng: { contains: query, mode: 'insensitive' } },
            ],
          },
        ],
      };

      const descResults = await this.prisma.item.findMany({
        where: descQueryWhere,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
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
        },
      });

      if (descResults.length > 0) {
        return descResults.map(convertDecimalFields);
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
      select: {
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
      },
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
      select: {
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
      },
    });

    return fallbackResults.map(convertDecimalFields);
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
