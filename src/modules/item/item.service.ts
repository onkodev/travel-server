import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { convertDecimalFields } from '../../common/utils/decimal.util';
import {
  calculateSkip,
  createPaginatedResponse,
} from '../../common/dto/pagination.dto';

@Injectable()
export class ItemService {
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
    return this.prisma.item.create({ data });
  }

  // 아이템 업데이트
  async updateItem(id: number, data: Prisma.ItemUpdateInput) {
    return this.prisma.item.update({
      where: { id },
      data,
    });
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

    return { success: true, message: '삭제되었습니다' };
  }

  // 타입별 아이템 조회
  async getItemsByType(type: string) {
    const items = await this.prisma.item.findMany({
      where: { type },
      orderBy: { nameKor: 'asc' },
    });
    return { data: items.map(convertDecimalFields) };
  }

  // 지역별 아이템 조회
  async getItemsByRegion(region: string) {
    const items = await this.prisma.item.findMany({
      where: { region },
      orderBy: { nameKor: 'asc' },
    });
    return { data: items.map(convertDecimalFields) };
  }
}
