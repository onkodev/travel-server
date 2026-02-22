import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { convertDecimalFields } from '../../common/utils/decimal.util';
import {
  calculateSkip,
  createPaginatedResponse,
} from '../../common/dto/pagination.dto';
import { CreateOdkTourListDto, UpdateOdkTourListDto } from './dto';

@Injectable()
export class OdkTourListService {
  constructor(private prisma: PrismaService) {}

  // 목록 조회
  async getList(params: {
    page?: number;
    limit?: number;
    search?: string;
    region?: string;
    isActive?: boolean;
  }) {
    const { page = 1, limit = 20, search, region, isActive } = params;
    const skip = calculateSkip(page, limit);

    const where: Prisma.OdkTourListWhereInput = {};

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    if (region) {
      where.region = { contains: region, mode: 'insensitive' };
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { nameKor: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.odkTourList.findMany({
        where,
        orderBy: [{ sortOrder: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.odkTourList.count({ where }),
    ]);

    return createPaginatedResponse(
      items.map(convertDecimalFields),
      total,
      page,
      limit,
    );
  }

  // 상세 조회
  async getById(id: number) {
    const item = await this.prisma.odkTourList.findUnique({
      where: { id },
    });

    if (!item) {
      throw new NotFoundException('투어를 찾을 수 없습니다');
    }

    return convertDecimalFields(item);
  }

  // 수정
  async update(id: number, data: UpdateOdkTourListDto) {
    await this.getById(id);

    const updateData: Prisma.OdkTourListUpdateInput = {};

    if (data.name !== undefined) updateData.name = data.name;
    if (data.nameKor !== undefined) updateData.nameKor = data.nameKor;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.thumbnailUrl !== undefined) updateData.thumbnailUrl = data.thumbnailUrl;
    if (data.websiteUrl !== undefined) updateData.websiteUrl = data.websiteUrl;
    if (data.price !== undefined) updateData.price = data.price;
    if (data.region !== undefined) updateData.region = data.region;
    if (data.duration !== undefined) updateData.duration = data.duration;
    if (data.tags !== undefined) updateData.tags = data.tags;
    if (data.sortOrder !== undefined) updateData.sortOrder = data.sortOrder;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;

    const item = await this.prisma.odkTourList.update({
      where: { id },
      data: updateData,
    });

    return convertDecimalFields(item);
  }

  // 생성
  async create(data: CreateOdkTourListDto) {
    const item = await this.prisma.odkTourList.create({
      data: {
        name: data.name,
        nameKor: data.nameKor,
        slug: data.slug,
        description: data.description,
        thumbnailUrl: data.thumbnailUrl,
        websiteUrl: data.websiteUrl,
        price: data.price,
        region: data.region,
        duration: data.duration,
        tags: data.tags || [],
        sortOrder: data.sortOrder ?? 0,
        isActive: data.isActive ?? true,
      },
    });

    return convertDecimalFields(item);
  }

  // 삭제
  async delete(id: number) {
    await this.getById(id);

    await this.prisma.odkTourList.delete({
      where: { id },
    });

    return { success: true, message: '삭제되었습니다' };
  }

  // 활성/비활성 토글
  async toggleActive(id: number) {
    const item = await this.getById(id);

    const updated = await this.prisma.odkTourList.update({
      where: { id },
      data: { isActive: !item.isActive },
    });

    return convertDecimalFields(updated);
  }

  // 통계
  async getStats() {
    const [total, active, inactive, withEmbedding] = await Promise.all([
      this.prisma.odkTourList.count(),
      this.prisma.odkTourList.count({ where: { isActive: true } }),
      this.prisma.odkTourList.count({ where: { isActive: false } }),
      this.prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*)::bigint as count FROM odk_tours WHERE embedding IS NOT NULL`,
      ),
    ]);

    return {
      total,
      active,
      inactive,
      withEmbedding: Number(withEmbedding[0]?.count ?? 0),
    };
  }
}
