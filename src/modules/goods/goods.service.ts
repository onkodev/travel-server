import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { convertDecimalFields } from '../../common/utils/decimal.util';
import {
  calculateSkip,
  createPaginatedResponse,
} from '../../common/dto/pagination.dto';
import {
  GoodsCategory,
  GoodsStatus,
  CreateGoodsDto,
  UpdateGoodsDto,
} from './dto';

@Injectable()
export class GoodsService {
  constructor(private prisma: PrismaService) {}

  // 굿즈 목록 조회 (공개)
  async getPublicGoods(params: {
    page?: number;
    limit?: number;
    category?: GoodsCategory;
    featured?: boolean;
    search?: string;
  }) {
    const { page = 1, limit = 20, category, featured, search } = params;
    const skip = calculateSkip(page, limit);

    const where: Prisma.GoodsWhereInput = {
      status: 'active',
    };

    if (category) {
      where.category = category;
    }

    if (featured !== undefined) {
      where.isFeatured = featured;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { nameKor: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [goods, total] = await Promise.all([
      this.prisma.goods.findMany({
        where,
        orderBy: [{ isFeatured: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.goods.count({ where }),
    ]);

    return createPaginatedResponse(
      goods.map(convertDecimalFields),
      total,
      page,
      limit,
    );
  }

  // 굿즈 목록 조회 (관리자)
  async getGoods(params: {
    page?: number;
    limit?: number;
    category?: GoodsCategory;
    status?: GoodsStatus;
    featured?: boolean;
    search?: string;
  }) {
    const { page = 1, limit = 20, category, status, featured, search } = params;
    const skip = calculateSkip(page, limit);

    const where: Prisma.GoodsWhereInput = {};

    if (category) {
      where.category = category;
    }

    if (status) {
      where.status = status;
    }

    if (featured !== undefined) {
      where.isFeatured = featured;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { nameKor: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [goods, total] = await Promise.all([
      this.prisma.goods.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.goods.count({ where }),
    ]);

    return createPaginatedResponse(
      goods.map(convertDecimalFields),
      total,
      page,
      limit,
    );
  }

  // 굿즈 상세 조회
  async getGoodsById(id: number, incrementView = false) {
    const goods = await this.prisma.goods.findUnique({
      where: { id },
    });

    if (!goods) {
      throw new NotFoundException('굿즈를 찾을 수 없습니다');
    }

    // 조회수 증가 (공개 조회 시)
    if (incrementView && goods.status === 'active') {
      await this.prisma.goods.update({
        where: { id },
        data: { viewCount: { increment: 1 } },
      });
    }

    return convertDecimalFields(goods);
  }

  // 굿즈 생성
  async createGoods(data: CreateGoodsDto) {
    const goods = await this.prisma.goods.create({
      data: {
        name: data.name,
        nameKor: data.nameKor,
        description: data.description,
        category: data.category,
        thumbnailUrl: data.thumbnailUrl,
        imageUrls: data.imageUrls || [],
        price: data.price,
        currency: data.currency || 'USD',
        stock: data.stock || 0,
        options: data.options as Prisma.InputJsonValue,
        tags: data.tags || [],
        status: data.status || 'draft',
        isFeatured: data.isFeatured || false,
      },
    });
    return convertDecimalFields(goods);
  }

  // 굿즈 업데이트
  async updateGoods(id: number, data: UpdateGoodsDto) {
    const updateData: Prisma.GoodsUpdateInput = {};

    if (data.name !== undefined) updateData.name = data.name;
    if (data.nameKor !== undefined) updateData.nameKor = data.nameKor;
    if (data.description !== undefined)
      updateData.description = data.description;
    if (data.category !== undefined) updateData.category = data.category;
    if (data.thumbnailUrl !== undefined)
      updateData.thumbnailUrl = data.thumbnailUrl;
    if (data.imageUrls !== undefined) updateData.imageUrls = data.imageUrls;
    if (data.price !== undefined) updateData.price = data.price;
    if (data.currency !== undefined) updateData.currency = data.currency;
    if (data.stock !== undefined) updateData.stock = data.stock;
    if (data.options !== undefined)
      updateData.options = data.options as Prisma.InputJsonValue;
    if (data.tags !== undefined) updateData.tags = data.tags;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.isFeatured !== undefined) updateData.isFeatured = data.isFeatured;

    const goods = await this.prisma.goods.update({
      where: { id },
      data: updateData,
    });
    return convertDecimalFields(goods);
  }

  // 굿즈 복제
  async duplicateGoods(id: number) {
    const original = await this.prisma.goods.findUnique({
      where: { id },
    });

    if (!original) {
      throw new NotFoundException('굿즈를 찾을 수 없습니다');
    }

    const newGoods = await this.prisma.goods.create({
      data: {
        name: `${original.name} (Copy)`,
        nameKor: original.nameKor ? `${original.nameKor} (복사본)` : null,
        description: original.description,
        category: original.category,
        thumbnailUrl: original.thumbnailUrl,
        imageUrls: original.imageUrls,
        price: original.price,
        currency: original.currency,
        stock: 0,
        options: original.options || undefined,
        tags: original.tags,
        status: 'draft',
        isFeatured: false,
      },
    });

    return convertDecimalFields(newGoods);
  }

  // 굿즈 삭제
  async deleteGoods(id: number) {
    const goods = await this.prisma.goods.findUnique({
      where: { id },
    });

    if (!goods) {
      throw new NotFoundException('굿즈를 찾을 수 없습니다');
    }

    await this.prisma.goods.delete({
      where: { id },
    });

    return { success: true, message: '삭제되었습니다' };
  }

  // 추천 상품 목록 (공개)
  async getFeaturedGoods(limit = 4) {
    const goods = await this.prisma.goods.findMany({
      where: {
        status: 'active',
        isFeatured: true,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return { data: goods.map(convertDecimalFields) };
  }

  // 카테고리별 굿즈 (공개)
  async getGoodsByCategory(category: GoodsCategory) {
    const goods = await this.prisma.goods.findMany({
      where: {
        status: 'active',
        category,
      },
      orderBy: [{ isFeatured: 'desc' }, { createdAt: 'desc' }],
    });

    return { data: goods.map(convertDecimalFields) };
  }
}
