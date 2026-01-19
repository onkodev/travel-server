import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, Estimate } from '@prisma/client';
import { randomBytes } from 'crypto';
import { convertDecimalFields, toDateTime, omit } from '../../common/utils';
import { CreateEstimateDto } from './dto/estimate-create.dto';
import { UpdateEstimateDto } from './dto/estimate-update.dto';
import { EstimateItemDto } from './dto/estimate.dto';
import { EstimateItemExtendedDto } from './dto/estimate-types.dto';

@Injectable()
export class EstimateService {
  constructor(private prisma: PrismaService) {}

  // 견적 목록 조회
  async getEstimates(params: {
    page?: number;
    limit?: number;
    source?: string;
    statusManual?: string;
    statusAi?: string;
    excludeStatusManual?: string;
    excludeStatusAi?: string;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    isPinned?: boolean;
    upcoming?: boolean; // 예정 필터 추가
  }) {
    const {
      page = 1,
      limit = 20,
      source,
      statusManual,
      statusAi,
      excludeStatusManual,
      excludeStatusAi,
      search,
      dateFrom,
      dateTo,
      isPinned,
      upcoming,
    } = params;
    const skip = (page - 1) * limit;

    const where: Prisma.EstimateWhereInput = {};

    // 소스 필터
    if (source) {
      where.source = source;
    }

    // 예정 필터 (5일 이내 시작, 완료/취소/진행중 제외)
    if (upcoming) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const fiveDaysLater = new Date(today);
      fiveDaysLater.setDate(fiveDaysLater.getDate() + 5);

      where.statusManual = {
        notIn: ['cancelled', 'archived', 'completed', 'in_progress'],
      };
      where.startDate = { gte: today, lte: fiveDaysLater };
    } else {
      // 수동 견적 상태 필터
      if (statusManual) {
        where.statusManual = statusManual;
      }

      // AI 견적 상태 필터
      if (statusAi) {
        where.statusAi = statusAi;
      }

      // 특정 상태 제외
      if (excludeStatusManual) {
        where.statusManual = { not: excludeStatusManual };
      }

      // AI 상태 제외
      if (excludeStatusAi) {
        where.statusAi = { not: excludeStatusAi };
      }
    }

    // 검색
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } },
        { customerEmail: { contains: search, mode: 'insensitive' } },
      ];
    }

    // 날짜 범위 필터
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) {
        where.createdAt.gte = new Date(dateFrom);
      }
      if (dateTo) {
        const endDate = new Date(dateTo);
        endDate.setHours(23, 59, 59, 999);
        where.createdAt.lte = endDate;
      }
    }

    // 고정 여부 필터
    if (isPinned !== undefined) {
      where.isPinned = isPinned;
    }

    const [estimates, total] = await Promise.all([
      this.prisma.estimate.findMany({
        where,
        orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
        // 목록 조회 시 큰 필드 제외 (items, requestContent, revisionHistory)
        select: {
          id: true,
          shareHash: true,
          title: true,
          source: true,
          statusManual: true,
          statusAi: true,
          customerName: true,
          customerEmail: true,
          regions: true,
          travelDays: true,
          startDate: true,
          endDate: true,
          adultsCount: true,
          childrenCount: true,
          infantsCount: true,
          totalTravelers: true,
          subtotal: true,
          totalAmount: true,
          currency: true,
          isPinned: true,
          chatSessionId: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.estimate.count({ where }),
    ]);

    return {
      data: estimates.map(convertDecimalFields),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // 견적 상세 조회
  async getEstimate(id: number) {
    const estimate = await this.prisma.estimate.findUnique({
      where: { id },
    });

    if (!estimate) {
      throw new NotFoundException('견적을 찾을 수 없습니다');
    }

    // 아이템 정보 보강 (itemInfo가 없는 경우)
    const enrichedEstimate = await this.enrichEstimateItems(estimate);
    return convertDecimalFields(enrichedEstimate);
  }

  // 아이템 정보 보강 헬퍼
  private async enrichEstimateItems(estimate: Estimate) {
    const items = estimate.items as unknown as EstimateItemExtendedDto[];
    if (!items || items.length === 0) return estimate;

    // itemInfo가 없거나 lat/lng가 없는 아이템들의 itemId 수집
    const itemsToEnrich = items.filter(
      (item) => !item.itemInfo || !item.itemInfo.images || item.itemInfo.images.length === 0 || item.itemInfo.lat == null || item.itemInfo.lng == null
    );

    if (itemsToEnrich.length === 0) return estimate;

    // 해당 아이템들의 정보 조회 (itemId가 있는 것만, null과 undefined 제외)
    const itemIds = [...new Set(
      itemsToEnrich
        .map((item) => item.itemId)
        .filter((id): id is number => id != null)
    )];
    if (itemIds.length === 0) return estimate;

    const itemRecords = await this.prisma.item.findMany({
      where: { id: { in: itemIds } },
      select: {
        id: true,
        nameKor: true,
        nameEng: true,
        descriptionEng: true,
        images: true,
        lat: true,
        lng: true,
        addressEnglish: true,
      },
    });

    // itemId -> Item 매핑
    const itemMap = new Map(itemRecords.map((item) => [item.id, item]));

    // 아이템 정보 보강
    const enrichedItems = items.map((item) => {
      if (!item.itemId) return item;
      const itemRecord = itemMap.get(item.itemId);
      if (!itemRecord) return item;

      // itemInfo가 없거나 images/lat/lng가 없는 경우 보강
      if (!item.itemInfo || !item.itemInfo.images || item.itemInfo.images.length === 0 || item.itemInfo.lat == null || item.itemInfo.lng == null) {
        return {
          ...item,
          itemInfo: {
            ...(item.itemInfo || {}),
            nameKor: item.itemInfo?.nameKor || itemRecord.nameKor,
            nameEng: item.itemInfo?.nameEng || itemRecord.nameEng,
            descriptionEng: item.itemInfo?.descriptionEng || itemRecord.descriptionEng,
            images: (item.itemInfo?.images?.length ? item.itemInfo.images : itemRecord.images) || [],
            lat: item.itemInfo?.lat ?? itemRecord.lat,
            lng: item.itemInfo?.lng ?? itemRecord.lng,
            addressEnglish: item.itemInfo?.addressEnglish || itemRecord.addressEnglish,
          },
        };
      }
      return item;
    });

    return { ...estimate, items: enrichedItems };
  }

  // 공유 해시로 견적 조회
  async getEstimateByShareHash(shareHash: string) {
    const estimate = await this.prisma.estimate.findUnique({
      where: { shareHash },
    });

    if (!estimate) {
      throw new NotFoundException('견적을 찾을 수 없습니다');
    }

    // 조회 시간 업데이트
    await this.prisma.estimate.update({
      where: { id: estimate.id },
      data: { viewedAt: new Date() },
    });

    // 아이템 정보 보강 (itemInfo가 없는 경우)
    const enrichedEstimate = await this.enrichEstimateItems(estimate);
    return convertDecimalFields(enrichedEstimate);
  }

  // 견적 생성
  async createEstimate(data: CreateEstimateDto) {
    // 클라이언트에서 보낸 불필요한 필드 제거
    const { id, createdAt, updatedAt, shareHash: _sh, items, displayOptions, timeline, revisionHistory, ...cleanData } = data;

    // 공유 해시 생성
    const shareHash = randomBytes(16).toString('hex');

    const prismaData = {
      ...cleanData,
      shareHash,
      // JSON 필드들을 Prisma InputJsonValue로 변환
      items: (items ?? []) as unknown as Prisma.InputJsonValue,
      displayOptions: displayOptions as unknown as Prisma.InputJsonValue | undefined,
      timeline: timeline as unknown as Prisma.InputJsonValue | undefined,
      revisionHistory: (revisionHistory ?? []) as unknown as Prisma.InputJsonValue,
    };

    const estimate = await this.prisma.estimate.create({
      data: prismaData,
    });
    return convertDecimalFields(estimate);
  }

  // 견적 업데이트
  async updateEstimate(id: number, data: UpdateEstimateDto) {
    // 제외할 필드 목록
    const EXCLUDE_FIELDS = [
      'id', 'createdAt', 'updatedAt', 'shareHash',  // 읽기 전용
      'totalTravelers', 'seniorsCount',              // DB에 없는 필드
      'chatSessionId', 'userId',                     // 관계 필드
      'items', 'displayOptions', 'timeline', 'revisionHistory',  // JSON 필드 (별도 처리)
      'validDate', 'startDate', 'endDate',           // 날짜 필드 (별도 처리)
    ] as const;

    const cleanData = omit(data as Record<string, unknown>, [...EXCLUDE_FIELDS]);

    const estimate = await this.prisma.estimate.update({
      where: { id },
      data: {
        ...cleanData,
        // 날짜 필드 변환
        ...(data.validDate !== undefined && { validDate: toDateTime(data.validDate) }),
        ...(data.startDate !== undefined && { startDate: toDateTime(data.startDate) }),
        ...(data.endDate !== undefined && { endDate: toDateTime(data.endDate) }),
        // JSON 필드
        ...(data.items !== undefined && { items: data.items as unknown as Prisma.InputJsonValue }),
        ...(data.displayOptions !== undefined && { displayOptions: data.displayOptions as unknown as Prisma.InputJsonValue }),
        ...(data.timeline !== undefined && { timeline: data.timeline as unknown as Prisma.InputJsonValue }),
        ...(data.revisionHistory !== undefined && { revisionHistory: data.revisionHistory as unknown as Prisma.InputJsonValue }),
      },
    });

    return convertDecimalFields(estimate);
  }

  // 견적 삭제
  async deleteEstimate(id: number) {
    return this.prisma.estimate.delete({
      where: { id },
    });
  }

  // 견적 발송 처리
  async sendEstimate(id: number) {
    // 견적 전체 조회 (chatSessionId, items 포함)
    const estimate = await this.prisma.estimate.findUnique({
      where: { id },
    });

    if (!estimate) {
      throw new NotFoundException(`견적 ID ${id}를 찾을 수 없습니다.`);
    }

    // 상태 업데이트
    const updatedEstimate = await this.prisma.estimate.update({
      where: { id },
      data: {
        statusAi: 'sent',
        sentAt: new Date(),
      },
    });

    // chatSessionId가 있으면 해당 채팅 세션에 견적 메시지 추가/업데이트
    if (estimate.chatSessionId) {
      try {
        // 기존 견적 메시지 삭제 (재발송 시 최신 데이터로 교체)
        await this.prisma.chatbotMessage.deleteMany({
          where: {
            sessionId: estimate.chatSessionId,
            messageType: 'estimate',
          },
        });

        // 견적 카드를 표시하기 위한 메시지 (messageType: 'estimate')
        await this.prisma.chatbotMessage.create({
          data: {
            sessionId: estimate.chatSessionId,
            role: 'bot',
            content: 'Your personalized quotation is ready! Please review the details below.',
            messageType: 'estimate',
            // options 필드에 견적 데이터 저장 (JSON)
            options: {
              estimateId: estimate.id,
              shareHash: estimate.shareHash,
              title: estimate.title,
              items: estimate.items,
              totalAmount: estimate.totalAmount,
              currency: estimate.currency,
              travelDays: estimate.travelDays,
              startDate: estimate.startDate,
            },
          },
        });
      } catch (error) {
        // 메시지 생성 실패해도 발송 처리는 계속 진행
        console.error('Failed to create chat message for estimate:', error);
      }
    }

    return convertDecimalFields(updatedEstimate);
  }

  // 견적 통계
  async getStats() {
    const [total, pending, sent, completed] = await Promise.all([
      this.prisma.estimate.count(),
      this.prisma.estimate.count({
        where: { OR: [{ statusAi: 'pending' }, { statusManual: 'planning' }] },
      }),
      this.prisma.estimate.count({
        where: { statusAi: 'sent' },
      }),
      this.prisma.estimate.count({
        where: {
          OR: [{ statusAi: 'completed' }, { statusManual: 'completed' }],
        },
      }),
    ]);

    return { total, pending, sent, completed };
  }

  // 수동 견적 상태별 통계 (SQL 최적화 버전)
  async getManualStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const fiveDaysLater = new Date(today);
    fiveDaysLater.setDate(fiveDaysLater.getDate() + 5);

    // SQL로 직접 집계 (전체 레코드를 가져오지 않음)
    const [statusCounts, upcomingCount, total] = await Promise.all([
      // 상태별 카운트
      this.prisma.estimate.groupBy({
        by: ['statusManual'],
        where: { source: 'manual' },
        _count: { id: true },
      }),
      // 다가오는 견적 카운트 (5일 이내 시작)
      this.prisma.estimate.count({
        where: {
          source: 'manual',
          statusManual: {
            notIn: ['cancelled', 'archived', 'completed', 'in_progress'],
          },
          startDate: { gte: today, lte: fiveDaysLater },
        },
      }),
      // 전체 카운트 (archived 제외)
      this.prisma.estimate.count({
        where: {
          source: 'manual',
          statusManual: { not: 'archived' },
        },
      }),
    ]);

    // 결과 매핑
    const stats = {
      planning: 0,
      inProgress: 0,
      completed: 0,
      cancelled: 0,
      archived: 0,
    };
    statusCounts.forEach((item) => {
      const status = item.statusManual as string;
      if (status === 'in_progress') stats.inProgress = item._count.id;
      else if (status === 'completed') stats.completed = item._count.id;
      else if (status === 'cancelled') stats.cancelled = item._count.id;
      else if (status === 'archived') stats.archived = item._count.id;
      else stats.planning += item._count.id; // planning 및 기타 상태
    });

    return {
      total,
      ...stats,
      upcoming: upcomingCount,
    };
  }

  // AI 견적 상태별 통계 (SQL 최적화 버전)
  async getAIStats() {
    // SQL groupBy로 직접 집계 (전체 레코드를 가져오지 않음)
    const [statusCounts, total] = await Promise.all([
      this.prisma.estimate.groupBy({
        by: ['statusAi'],
        where: { source: 'ai' },
        _count: { id: true },
      }),
      this.prisma.estimate.count({
        where: {
          source: 'ai',
          statusAi: { not: 'archived' },
        },
      }),
    ]);

    const stats = {
      draft: 0,
      pending: 0,
      sent: 0,
      accepted: 0,
      completed: 0,
      archived: 0,
    };
    statusCounts.forEach((item) => {
      const status = item.statusAi as keyof typeof stats;
      if (status && stats[status] !== undefined) {
        stats[status] = item._count.id;
      }
    });

    return { total, ...stats };
  }

  // 수동 견적 상태 변경
  async updateManualStatus(id: number, status: string) {
    const updates: any = { statusManual: status };
    if (status === 'completed') updates.completedAt = new Date();
    return this.prisma.estimate.update({ where: { id }, data: updates });
  }

  // AI 견적 상태 변경
  async updateAIStatus(id: number, status: string) {
    const updates: any = { statusAi: status };
    if (status === 'sent') updates.sentAt = new Date();
    if (status === 'accepted') updates.respondedAt = new Date();
    if (status === 'completed') updates.completedAt = new Date();
    return this.prisma.estimate.update({ where: { id }, data: updates });
  }

  // 고정 토글
  async togglePinned(id: number, isPinned: boolean) {
    return this.prisma.estimate.update({ where: { id }, data: { isPinned } });
  }

  // 아이템 업데이트
  async updateItems(id: number, items: EstimateItemDto[]) {
    const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity || 0), 0);
    return this.prisma.estimate.update({
      where: { id },
      data: { items: items as unknown as Prisma.InputJsonValue, subtotal },
    });
  }

  // 조정 금액 업데이트
  async updateAdjustment(id: number, amount: number, reason?: string) {
    // 트랜잭션으로 read-modify-write를 atomic하게 처리 (race condition 방지)
    return this.prisma.$transaction(async (tx) => {
      const estimate = await tx.estimate.findUnique({
        where: { id },
        select: { subtotal: true },
      });

      if (!estimate) {
        throw new NotFoundException('견적을 찾을 수 없습니다');
      }

      const totalAmount = Number(estimate.subtotal || 0) + amount;

      const updated = await tx.estimate.update({
        where: { id },
        data: { manualAdjustment: amount, adjustmentReason: reason, totalAmount },
      });

      return convertDecimalFields(updated);
    });
  }

  // 견적 복제
  async duplicate(id: number) {
    const original = await this.prisma.estimate.findUnique({ where: { id } });
    if (!original) throw new NotFoundException('견적을 찾을 수 없습니다');

    const {
      id: _id,
      createdAt: _c,
      updatedAt: _u,
      shareHash: _s,
      ...copyData
    } = original;
    return this.prisma.estimate.create({
      data: {
        ...copyData,
        title: `${original.title}_copy`,
        shareHash: randomBytes(16).toString('hex'),
        statusManual: 'planning',
        isPinned: false,
        revisionHistory: [],
        sentAt: null,
        respondedAt: null,
        viewedAt: null,
        completedAt: null,
      } as any,
    });
  }

  // 이전/다음 견적 ID 조회
  async getAdjacentIds(id: number) {
    const current = await this.prisma.estimate.findUnique({
      where: { id },
      select: { isPinned: true, createdAt: true },
    });

    if (!current || !current.createdAt) return { prevId: null, nextId: null };

    // 이전 (더 최신)
    const prev = await this.prisma.estimate.findFirst({
      where: {
        OR: [
          { isPinned: current.isPinned, createdAt: { gt: current.createdAt } },
          { isPinned: true },
        ],
      },
      orderBy: [{ isPinned: 'desc' }, { createdAt: 'asc' }],
      select: { id: true },
    });

    // 다음 (더 오래됨)
    const next = await this.prisma.estimate.findFirst({
      where: {
        OR: [
          { isPinned: current.isPinned, createdAt: { lt: current.createdAt } },
          { isPinned: false },
        ],
      },
      orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
      select: { id: true },
    });

    return { prevId: prev?.id || null, nextId: next?.id || null };
  }

  // 일괄 삭제
  async bulkDelete(ids: number[]) {
    return this.prisma.estimate.deleteMany({ where: { id: { in: ids } } });
  }

  // 일괄 상태 변경
  async bulkUpdateStatus(ids: number[], status: string) {
    return this.prisma.estimate.updateMany({
      where: { id: { in: ids } },
      data: { statusManual: status },
    });
  }
}
