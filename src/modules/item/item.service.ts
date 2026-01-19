import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { convertDecimalFields } from '../../common/utils/decimal.util';
import {
  calculateSkip,
  createPaginatedResponse,
} from '../../common/dto/pagination.dto';

// 간단한 인메모리 캐시 (TTL 지원)
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

@Injectable()
export class ItemService {
  private cache = new Map<string, CacheEntry<any>>();
  private readonly CACHE_TTL = 60 * 60 * 1000; // 1시간

  constructor(private prisma: PrismaService) {}

  // 캐시에서 가져오기 (만료되면 null 반환)
  private getFromCache<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.data as T;
  }

  // 캐시에 저장
  private setCache<T>(key: string, data: T): void {
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + this.CACHE_TTL,
    });
  }

  // 캐시 무효화 (아이템 생성/수정/삭제 시 호출)
  private invalidateCache(): void {
    this.cache.clear();
  }

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

    if (search) {
      where.OR = [
        { nameKor: { contains: search, mode: 'insensitive' } },
        { nameEng: { contains: search, mode: 'insensitive' } },
        { keyword: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.item.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.item.count({ where }),
    ]);

    return createPaginatedResponse(items.map(convertDecimalFields), total, page, limit);
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

  // 아이템 생성
  async createItem(data: Prisma.ItemCreateInput) {
    const item = await this.prisma.item.create({ data });
    this.invalidateCache();
    return item;
  }

  // 아이템 업데이트
  async updateItem(id: number, data: Prisma.ItemUpdateInput) {
    const item = await this.prisma.item.update({
      where: { id },
      data,
    });
    this.invalidateCache();
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

    this.invalidateCache();
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

    this.invalidateCache();
    return { success: true, message: '삭제되었습니다' };
  }

  // 타입별 아이템 조회 (캐싱 적용)
  async getItemsByType(type: string) {
    const cacheKey = `items_type_${type}`;
    const cached = this.getFromCache<{ data: any[] }>(cacheKey);
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
      },
    });
    const result = { data: items.map(convertDecimalFields) };
    this.setCache(cacheKey, result);
    return result;
  }

  // 지역별 아이템 조회 (캐싱 적용)
  async getItemsByRegion(region: string) {
    const cacheKey = `items_region_${region}`;
    const cached = this.getFromCache<{ data: any[] }>(cacheKey);
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
      },
    });
    const result = { data: items.map(convertDecimalFields) };
    this.setCache(cacheKey, result);
    return result;
  }
}
