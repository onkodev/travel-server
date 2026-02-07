import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import {
  calculateSkip,
  createPaginatedResponse,
} from '../../common/dto/pagination.dto';

@Injectable()
export class ItineraryTemplateService {
  constructor(private prisma: PrismaService) {}

  // 템플릿 목록 조회 (전체 공개 + 사용자별)
  async getTemplates(params: {
    userId?: string;
    page?: number;
    limit?: number;
  }) {
    const { userId, page = 1, limit = 20 } = params;
    const skip = calculateSkip(page, limit);

    const where: Prisma.ItineraryTemplateWhereInput = {};

    // userId가 null인 템플릿(공개)과 현재 사용자 템플릿 모두 조회
    if (userId) {
      where.OR = [{ userId: null }, { userId: userId }];
    }

    const [templates, total] = await Promise.all([
      this.prisma.itineraryTemplate.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.itineraryTemplate.count({ where }),
    ]);

    return createPaginatedResponse(templates, total, page, limit);
  }

  // 템플릿 상세 조회
  async getTemplate(id: number) {
    const template = await this.prisma.itineraryTemplate.findUnique({
      where: { id },
    });

    if (!template) {
      throw new NotFoundException('템플릿을 찾을 수 없습니다');
    }

    return template;
  }

  // 템플릿 생성
  async createTemplate(data: {
    name: string;
    items: Prisma.JsonValue;
    userId?: string;
  }) {
    return this.prisma.itineraryTemplate.create({
      data: {
        name: data.name,
        items: data.items || [],
        userId: data.userId,
      },
    });
  }

  // 템플릿 업데이트
  async updateTemplate(
    id: number,
    data: { name?: string; items?: Prisma.JsonValue },
  ) {
    const template = await this.prisma.itineraryTemplate.findUnique({
      where: { id },
    });

    if (!template) {
      throw new NotFoundException('템플릿을 찾을 수 없습니다');
    }

    return this.prisma.itineraryTemplate.update({
      where: { id },
      data: {
        ...data,
        items: data.items as unknown as Prisma.InputJsonValue | undefined,
      },
    });
  }

  // 템플릿 삭제
  async deleteTemplate(id: number) {
    const template = await this.prisma.itineraryTemplate.findUnique({
      where: { id },
    });

    if (!template) {
      throw new NotFoundException('템플릿을 찾을 수 없습니다');
    }

    return this.prisma.itineraryTemplate.delete({
      where: { id },
    });
  }

  // 템플릿 복제
  async duplicateTemplate(id: number, userId?: string) {
    const template = await this.prisma.itineraryTemplate.findUnique({
      where: { id },
    });

    if (!template) {
      throw new NotFoundException('템플릿을 찾을 수 없습니다');
    }

    return this.prisma.itineraryTemplate.create({
      data: {
        name: `${template.name} (복사본)`,
        items: template.items as unknown as Prisma.InputJsonValue,
        userId: userId || template.userId,
      },
    });
  }
}
