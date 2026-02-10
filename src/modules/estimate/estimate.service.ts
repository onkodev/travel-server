import {
  Injectable,
  NotFoundException,
  GoneException,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { NotificationService } from '../notification/notification.service';
import { Prisma, Estimate } from '@prisma/client';
import { randomBytes } from 'crypto';
import {
  convertDecimalFields,
  toDateTime,
  omit,
  sanitizeSearch,
} from '../../common/utils';
import { CreateEstimateDto } from './dto/estimate-create.dto';
import { UpdateEstimateDto } from './dto/estimate-update.dto';
import { EstimateItemDto, ESTIMATE_STATUS } from './dto/estimate.dto';
import { EstimateItemExtendedDto } from './dto/estimate-types.dto';
import {
  calculateSkip,
  createPaginatedResponse,
} from '../../common/dto/pagination.dto';
import {
  ESTIMATE_EVENTS,
  CHATBOT_EVENTS,
  EstimateSentEvent,
  ChatbotEstimateStatusEvent,
} from '../../common/events';

// Item 캐시 타입 (Prisma 타입과 호환)
interface ItemCacheEntry {
  data: Map<number, ItemInfo>;
  expiresAt: number;
}

interface ItemInfo {
  id: number;
  nameKor: string | null;
  nameEng: string | null;
  descriptionEng: string | null;
  images: Prisma.JsonValue;
  lat: Prisma.Decimal | null;
  lng: Prisma.Decimal | null;
  addressEnglish: string | null;
}

@Injectable()
export class EstimateService {
  private readonly logger = new Logger(EstimateService.name);
  // Item 정보 캐시 (enrichEstimateItems용)
  private itemCache: ItemCacheEntry | null = null;
  private readonly ITEM_CACHE_TTL = 30 * 60 * 1000; // 30분

  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
    private notificationService: NotificationService,
    private eventEmitter: EventEmitter2,
  ) {}

  // Item 캐시에서 가져오기 (만료되면 null)
  private getItemFromCache(itemId: number): ItemInfo | null {
    if (!this.itemCache || Date.now() > this.itemCache.expiresAt) {
      this.itemCache = null;
      return null;
    }
    return this.itemCache.data.get(itemId) || null;
  }

  // Item 캐시에 추가
  private addItemsToCache(items: ItemInfo[]): void {
    if (!this.itemCache || Date.now() > this.itemCache.expiresAt) {
      this.itemCache = {
        data: new Map(),
        expiresAt: Date.now() + this.ITEM_CACHE_TTL,
      };
    }
    for (const item of items) {
      this.itemCache.data.set(item.id, item);
    }
  }

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
    const skip = calculateSkip(page, limit);

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
    const sanitized = sanitizeSearch(search);
    if (sanitized) {
      where.OR = [
        { title: { contains: sanitized, mode: 'insensitive' } },
        { customerName: { contains: sanitized, mode: 'insensitive' } },
        { customerEmail: { contains: sanitized, mode: 'insensitive' } },
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

    return createPaginatedResponse(
      estimates.map(convertDecimalFields),
      total,
      page,
      limit,
    );
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

  // 이미지 배열에서 URL 문자열 배열로 변환하는 헬퍼
  private extractImageUrls(images: unknown): string[] {
    if (!images || !Array.isArray(images)) return [];
    return images
      .map((img) => {
        if (typeof img === 'string') return img;
        if (typeof img === 'object' && img !== null && 'url' in img) {
          return (img as { url: string }).url;
        }
        return null;
      })
      .filter((url): url is string => Boolean(url));
  }

  // 아이템 정보 보강 헬퍼 (캐싱 적용)
  private async enrichEstimateItems(estimate: Estimate) {
    const items = estimate.items as unknown as EstimateItemExtendedDto[];
    if (!items || items.length === 0) return estimate;

    // itemInfo가 없거나 lat/lng가 없는 아이템들의 itemId 수집
    const itemsToEnrich = items.filter(
      (item) =>
        !item.itemInfo ||
        !item.itemInfo.images ||
        item.itemInfo.images.length === 0 ||
        item.itemInfo.lat == null ||
        item.itemInfo.lng == null,
    );

    if (itemsToEnrich.length === 0) return estimate;

    // 해당 아이템들의 정보 조회 (itemId가 있는 것만, null과 undefined 제외)
    const itemIds = [
      ...new Set(
        itemsToEnrich
          .map((item) => item.itemId)
          .filter((id): id is number => id != null),
      ),
    ];
    if (itemIds.length === 0) return estimate;

    // 캐시에서 먼저 찾기
    const itemMap = new Map<number, ItemInfo>();
    const uncachedIds: number[] = [];

    for (const id of itemIds) {
      const cached = this.getItemFromCache(id);
      if (cached) {
        itemMap.set(id, cached);
      } else {
        uncachedIds.push(id);
      }
    }

    // 캐시에 없는 것만 DB 조회
    if (uncachedIds.length > 0) {
      const itemRecords = await this.prisma.item.findMany({
        where: { id: { in: uncachedIds } },
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

      // 캐시에 추가하고 맵에도 추가
      this.addItemsToCache(itemRecords);
      for (const item of itemRecords) {
        itemMap.set(item.id, item);
      }
    }

    // 아이템 정보 보강 + 이미지 포맷 정규화
    const enrichedItems = items.map((item) => {
      // 이미지 포맷 정규화 (항상 수행 - 객체 형식 → 문자열 배열 변환)
      const normalizedImages = this.extractImageUrls(item.itemInfo?.images);

      // itemId가 없으면 이미지만 정규화하고 반환
      if (!item.itemId) {
        if (item.itemInfo?.images && normalizedImages.length > 0) {
          return {
            ...item,
            itemInfo: {
              ...item.itemInfo,
              images: normalizedImages,
            },
          };
        }
        return item;
      }

      const itemRecord = itemMap.get(item.itemId);

      // DB에 아이템이 없으면 이미지만 정규화하고 반환
      if (!itemRecord) {
        if (item.itemInfo?.images && normalizedImages.length > 0) {
          return {
            ...item,
            itemInfo: {
              ...item.itemInfo,
              images: normalizedImages,
            },
          };
        }
        return item;
      }

      // DB 이미지 추출
      const dbImages = this.extractImageUrls(itemRecord.images);

      // itemInfo가 없거나 정보가 부족한 경우 전체 보강
      if (
        !item.itemInfo ||
        !item.itemInfo.images ||
        item.itemInfo.images.length === 0 ||
        item.itemInfo.lat == null ||
        item.itemInfo.lng == null
      ) {
        return {
          ...item,
          itemInfo: {
            ...(item.itemInfo || {}),
            nameKor: item.itemInfo?.nameKor || itemRecord.nameKor,
            nameEng: item.itemInfo?.nameEng || itemRecord.nameEng,
            descriptionEng:
              item.itemInfo?.descriptionEng || itemRecord.descriptionEng,
            images: normalizedImages.length > 0 ? normalizedImages : dbImages,
            lat: item.itemInfo?.lat ?? itemRecord.lat,
            lng: item.itemInfo?.lng ?? itemRecord.lng,
            addressEnglish:
              item.itemInfo?.addressEnglish || itemRecord.addressEnglish,
          },
        };
      }

      // 정보는 있지만 이미지 포맷만 정규화 필요한 경우
      return {
        ...item,
        itemInfo: {
          ...item.itemInfo,
          images: normalizedImages.length > 0 ? normalizedImages : dbImages,
        },
      };
    });

    return { ...estimate, items: enrichedItems };
  }

  // 공유 해시로 견적 조회 (유효기간 체크 포함)
  async getEstimateByShareHash(shareHash: string) {
    // 먼저 조회하여 유효기간 확인
    const estimate = await this.prisma.estimate.findUnique({
      where: { shareHash },
    });

    if (!estimate) {
      throw new NotFoundException('견적을 찾을 수 없습니다');
    }

    // 유효기간 체크 — KST 기준 날짜만 비교 (타임존/시간 이슈 방지)
    if (estimate.validDate) {
      const toDateStr = (d: Date) =>
        d.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }); // "YYYY-MM-DD"

      const todayKST = toDateStr(new Date());
      const validDateKST = toDateStr(new Date(estimate.validDate));

      this.logger.log(
        `[유효기간 체크] today=${todayKST}, validDate=${validDateKST}, raw=${estimate.validDate}, expired=${todayKST > validDateKST}`,
      );

      if (todayKST > validDateKST) {
        throw new GoneException({
          message: '견적 유효기간이 만료되었습니다',
          validDate: validDateKST,
        });
      }
    }

    // 유효한 경우에만 viewedAt 업데이트
    const updated = await this.prisma.estimate.update({
      where: { shareHash },
      data: { viewedAt: new Date() },
    });

    // 아이템 정보 보강 (itemInfo가 없는 경우)
    const enrichedEstimate = await this.enrichEstimateItems(updated);
    return convertDecimalFields(enrichedEstimate);
  }

  // 견적 생성
  async createEstimate(data: CreateEstimateDto) {
    // 클라이언트에서 보낸 불필요한 필드 제거
    const {
      id,
      createdAt,
      updatedAt,
      shareHash: _sh,
      items,
      displayOptions,
      timeline,
      revisionHistory,
      totalTravelers: _tt,
      paidAt: _pa,
      paidAmount: _pam,
      revisedAt: _ra,
      viewedAt: _va,
      sentAt: _sa,
      respondedAt: _rsa,
      completedAt: _ca,
      ...cleanData
    } = data;

    // 공유 해시 생성
    const shareHash = randomBytes(16).toString('hex');

    // 유효기간 기본값: 오늘 + 10일 (명시적으로 제공되지 않은 경우)
    let validDate: Date | undefined;
    if (cleanData.validDate) {
      validDate = new Date(cleanData.validDate);
    } else {
      validDate = new Date();
      validDate.setDate(validDate.getDate() + 10);
    }

    const prismaData = {
      ...cleanData,
      shareHash,
      validDate,
      // JSON 필드들을 Prisma InputJsonValue로 변환
      items: (items ?? []) as unknown as Prisma.InputJsonValue,
      displayOptions: displayOptions as unknown as
        | Prisma.InputJsonValue
        | undefined,
      timeline: timeline as unknown as Prisma.InputJsonValue | undefined,
      revisionHistory: (revisionHistory ??
        []) as unknown as Prisma.InputJsonValue,
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
      'id',
      'createdAt',
      'updatedAt',
      'shareHash', // 읽기 전용
      'totalTravelers',
      'seniorsCount', // DB에 없는 필드
      'paidAt',
      'paidAmount', // DB에 없는 필드
      'chatSessionId',
      'userId', // 관계 필드
      'items',
      'displayOptions',
      'timeline',
      'revisionHistory', // JSON 필드 (별도 처리)
      'validDate',
      'startDate',
      'endDate', // 날짜 필드 (별도 처리)
      // DateTime 필드 (문자열 → Date 변환 필요)
      'revisedAt',
      'viewedAt',
      'sentAt',
      'respondedAt',
      'completedAt',
    ] as const;

    const cleanData = omit(data as Record<string, unknown>, [
      ...EXCLUDE_FIELDS,
    ]);

    // Decimal 필드 NaN/Infinity 방어 (PrismaClientValidationError 방지)
    const DECIMAL_FIELDS = ['subtotal', 'manualAdjustment', 'totalAmount'] as const;
    for (const field of DECIMAL_FIELDS) {
      if (field in cleanData) {
        const v = Number(cleanData[field]);
        cleanData[field] = Number.isFinite(v) ? v : 0;
      }
    }

    const estimate = await this.prisma.estimate.update({
      where: { id },
      data: {
        ...cleanData,
        // 날짜 필드 변환
        ...(data.validDate !== undefined && {
          validDate: toDateTime(data.validDate),
        }),
        ...(data.startDate !== undefined && {
          startDate: toDateTime(data.startDate),
        }),
        ...(data.endDate !== undefined && {
          endDate: toDateTime(data.endDate),
        }),
        // DateTime 필드 변환 (문자열 → Date)
        ...(data.revisedAt !== undefined && {
          revisedAt: toDateTime(data.revisedAt),
        }),
        ...(data.viewedAt !== undefined && {
          viewedAt: toDateTime(data.viewedAt),
        }),
        ...(data.sentAt !== undefined && {
          sentAt: toDateTime(data.sentAt),
        }),
        ...(data.respondedAt !== undefined && {
          respondedAt: toDateTime(data.respondedAt),
        }),
        ...(data.completedAt !== undefined && {
          completedAt: toDateTime(data.completedAt),
        }),
        // JSON 필드
        ...(data.items !== undefined && {
          items: data.items as unknown as Prisma.InputJsonValue,
        }),
        ...(data.displayOptions !== undefined && {
          displayOptions:
            data.displayOptions as unknown as Prisma.InputJsonValue,
        }),
        ...(data.timeline !== undefined && {
          timeline: data.timeline as unknown as Prisma.InputJsonValue,
        }),
        ...(data.revisionHistory !== undefined && {
          revisionHistory:
            data.revisionHistory as unknown as Prisma.InputJsonValue,
        }),
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
    // 조회 + 상태 업데이트를 트랜잭션으로 래핑
    const { estimate, updatedEstimate } = await this.prisma.$transaction(
      async (tx) => {
        const est = await tx.estimate.findUnique({ where: { id } });
        if (!est) {
          throw new NotFoundException(`견적 ID ${id}를 찾을 수 없습니다.`);
        }
        const updated = await tx.estimate.update({
          where: { id },
          data: {
            statusAi: ESTIMATE_STATUS.SENT,
            sentAt: new Date(),
          },
        });
        return { estimate: est, updatedEstimate: updated };
      },
    );

    // 고객 이메일이 있으면 이메일 발송
    if (estimate.customerEmail) {
      const items =
        (estimate.items as unknown as Array<{
          name: string;
          type?: string;
          price: number;
          quantity: number;
          date?: string;
        }>) || [];

      this.emailService
        .sendEstimate({
          to: estimate.customerEmail,
          customerName: estimate.customerName || 'Valued Customer',
          estimateTitle: estimate.title || 'Your Travel Quotation',
          shareHash: estimate.shareHash || '',
          items,
          totalAmount: Number(estimate.totalAmount) || 0,
          currency: estimate.currency || 'USD',
          travelDays: estimate.travelDays || undefined,
          startDate: estimate.startDate,
          endDate: estimate.endDate,
          adultsCount: estimate.adultsCount || undefined,
          childrenCount: estimate.childrenCount || undefined,
        })
        .catch((error) => {
          this.logger.error(
            `Failed to send estimate email to ${estimate.customerEmail}:`,
            error,
          );
        });
    }

    // 관리자에게 견적 발송 완료 알림
    this.notificationService
      .notifyEstimateSent({
        estimateId: estimate.id,
        customerName: estimate.customerName || undefined,
        customerEmail: estimate.customerEmail || undefined,
      })
      .catch((error) => {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Failed to send estimate notification: ${errorMessage}`,
        );
      });

    // 채팅 세션이 있으면 이벤트 발송 (ChatbotService가 수신하여 메시지 저장)
    if (estimate.chatSessionId) {
      const event: EstimateSentEvent = {
        chatSessionId: estimate.chatSessionId,
        estimateId: estimate.id,
      };
      this.eventEmitter.emit(ESTIMATE_EVENTS.SENT, event);

      // SSE로 상태 변경 알림 (클라이언트 UI 즉시 업데이트용)
      const sseEvent: ChatbotEstimateStatusEvent = {
        sessionId: estimate.chatSessionId,
        estimateId: estimate.id,
        status: ESTIMATE_STATUS.SENT,
      };
      this.eventEmitter.emit(CHATBOT_EVENTS.ESTIMATE_STATUS_CHANGED, sseEvent);
    }

    return convertDecimalFields(updatedEstimate);
  }

  // 견적 통계
  async getStats() {
    const [total, pending, sent, completed] = await Promise.all([
      this.prisma.estimate.count(),
      this.prisma.estimate.count({
        where: {
          OR: [
            { statusAi: ESTIMATE_STATUS.PENDING },
            { statusManual: 'planning' },
          ],
        },
      }),
      this.prisma.estimate.count({
        where: { statusAi: ESTIMATE_STATUS.SENT },
      }),
      this.prisma.estimate.count({
        where: {
          OR: [
            { statusAi: ESTIMATE_STATUS.COMPLETED },
            { statusManual: 'completed' },
          ],
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
          statusAi: { not: ESTIMATE_STATUS.CANCELLED },
        },
      }),
    ]);

    // 6개 상태: draft, pending, sent, approved, completed, cancelled
    const stats = {
      draft: 0,
      pending: 0,
      sent: 0,
      approved: 0,
      completed: 0,
      cancelled: 0,
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
    const updates: Prisma.EstimateUpdateInput = { statusManual: status };
    if (status === 'completed') updates.completedAt = new Date();
    return this.prisma.estimate.update({ where: { id }, data: updates });
  }

  // AI 견적 상태 변경
  async updateAIStatus(id: number, status: string) {
    const updates: Prisma.EstimateUpdateInput = { statusAi: status };
    if (status === ESTIMATE_STATUS.SENT) updates.sentAt = new Date();
    if (status === ESTIMATE_STATUS.APPROVED) updates.respondedAt = new Date();
    if (status === ESTIMATE_STATUS.COMPLETED) updates.completedAt = new Date();

    const estimate = await this.prisma.estimate.update({
      where: { id },
      data: updates,
    });

    // SSE 이벤트 발행 (채팅 세션이 연결된 경우)
    if (estimate.chatSessionId) {
      const sseEvent: ChatbotEstimateStatusEvent = {
        sessionId: estimate.chatSessionId,
        estimateId: id,
        status,
      };
      this.eventEmitter.emit(CHATBOT_EVENTS.ESTIMATE_STATUS_CHANGED, sseEvent);
    }

    return estimate;
  }

  // 고정 토글
  async togglePinned(id: number, isPinned: boolean) {
    return this.prisma.estimate.update({ where: { id }, data: { isPinned } });
  }

  // 아이템 업데이트
  async updateItems(id: number, items: EstimateItemDto[]) {
    const subtotal = items.reduce(
      (sum, item) => sum + (item.price * item.quantity || 0),
      0,
    );
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
        data: {
          manualAdjustment: amount,
          adjustmentReason: reason,
          totalAmount,
        },
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
      totalTravelers: _t, // DB generated column - 제외 필요
      items,
      displayOptions,
      timeline,
      revisionHistory: _rh,
      ...copyData
    } = original;

    // JsonValue null 처리 헬퍼
    const toJsonInput = (value: Prisma.JsonValue) =>
      value === null ? Prisma.JsonNull : value;

    const createData: Prisma.EstimateUncheckedCreateInput = {
      ...copyData,
      items: toJsonInput(items),
      displayOptions: toJsonInput(displayOptions),
      timeline: toJsonInput(timeline),
      title: `${original.title}_copy`,
      shareHash: randomBytes(16).toString('hex'),
      statusManual: 'planning',
      isPinned: false,
      revisionHistory: [],
      sentAt: null,
      respondedAt: null,
      viewedAt: null,
      completedAt: null,
    };
    return this.prisma.estimate.create({ data: createData });
  }

  // 이전/다음 견적 ID 조회
  async getAdjacentIds(id: number) {
    const current = await this.prisma.estimate.findUnique({
      where: { id },
      select: { isPinned: true, createdAt: true },
    });

    if (!current || !current.createdAt) return { prevId: null, nextId: null };

    const pinned = current.isPinned ?? false;

    // 이전 (더 최신) — 같은 핀 상태에서 더 최신이거나, 핀 고정된 항목(현재가 비핀일 때)
    const prevConditions = [
      { isPinned: pinned, createdAt: { gt: current.createdAt }, id: { not: id } },
    ];
    if (!pinned) {
      prevConditions.push({ isPinned: true } as never);
    }

    const prev = await this.prisma.estimate.findFirst({
      where: { OR: prevConditions },
      orderBy: [{ isPinned: 'desc' }, { createdAt: 'asc' }],
      select: { id: true },
    });

    // 다음 (더 오래됨) — 같은 핀 상태에서 더 오래되었거나, 비핀 항목(현재가 핀일 때)
    const nextConditions = [
      { isPinned: pinned, createdAt: { lt: current.createdAt }, id: { not: id } },
    ];
    if (pinned) {
      nextConditions.push({ isPinned: false } as never);
    }

    const next = await this.prisma.estimate.findFirst({
      where: { OR: nextConditions },
      orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
      select: { id: true },
    });

    return { prevId: prev?.id ?? null, nextId: next?.id ?? null };
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
