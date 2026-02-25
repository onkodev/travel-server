import {
  Injectable,
  NotFoundException,
  GoneException,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { EstimateStatsService } from './estimate-stats.service';
import { DASHBOARD_EVENTS } from '../../common/events';
import { Prisma, Estimate } from '@prisma/client';
import { randomBytes } from 'crypto';
import {
  convertDecimalFields,
  toDateTime,
  omit,
  sanitizeSearch,
  extractImageUrls,
  MemoryCache,
  jsonCast,
} from '../../common/utils';
import { CreateEstimateDto } from './dto/estimate-create.dto';
import { UpdateEstimateDto } from './dto/estimate-update.dto';
import { EstimateItemDto, ESTIMATE_STATUS } from './dto/estimate.dto';
import { EstimateItemExtendedDto } from './dto/estimate-types.dto';
import {
  calculateSkip,
  createPaginatedResponse,
} from '../../common/dto/pagination.dto';
import { CACHE_TTL } from '../../common/constants/cache';

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
  // Item 정보 캐시 (enrichEstimateItems용, 30분 TTL)
  private itemCache = new MemoryCache(CACHE_TTL.AI_CONFIG);

  constructor(
    private prisma: PrismaService,
    private statsService: EstimateStatsService,
    private eventEmitter: EventEmitter2,
  ) {}

  /** 견적 통계 + 대시보드 캐시 동시 무효화 */
  private invalidateCaches() {
    this.statsService.invalidateStatsCache();
    this.eventEmitter.emit(DASHBOARD_EVENTS.INVALIDATE);
  }

  private getItemFromCache(itemId: number): ItemInfo | null {
    return this.itemCache.get<ItemInfo>(`item_${itemId}`);
  }

  private addItemsToCache(items: ItemInfo[]): void {
    for (const item of items) {
      this.itemCache.set(`item_${item.id}`, item);
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
    startDateFrom?: string;
    startDateTo?: string;
    paxMin?: number;
    paxMax?: number;
    amountMin?: number;
    amountMax?: number;
    durationMin?: number;
    durationMax?: number;
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
      startDateFrom,
      startDateTo,
      paxMin,
      paxMax,
      amountMin,
      amountMax,
      durationMin,
      durationMax,
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

    // 통합 검색 (제목, 고객명, 내부메모, 코멘트 — customerEmail 제외)
    const sanitized = sanitizeSearch(search);
    if (sanitized) {
      where.OR = [
        { title: { contains: sanitized, mode: 'insensitive' } },
        { customerName: { contains: sanitized, mode: 'insensitive' } },
        { internalMemo: { contains: sanitized, mode: 'insensitive' } },
        { comment: { contains: sanitized, mode: 'insensitive' } },
      ];
    }

    // 날짜 범위 필터
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) {
        const d = new Date(dateFrom);
        if (!isNaN(d.getTime())) where.createdAt.gte = d;
      }
      if (dateTo) {
        const endDate = new Date(dateTo);
        if (!isNaN(endDate.getTime())) {
          endDate.setHours(23, 59, 59, 999);
          where.createdAt.lte = endDate;
        }
      }
    }

    // 고정 여부 필터
    if (isPinned !== undefined) {
      where.isPinned = isPinned;
    }

    // 여행 시작일 범위 필터
    if (startDateFrom || startDateTo) {
      where.startDate = {};
      if (startDateFrom) {
        const d = new Date(startDateFrom);
        if (!isNaN(d.getTime())) where.startDate.gte = d;
      }
      if (startDateTo) {
        const endDate = new Date(startDateTo);
        if (!isNaN(endDate.getTime())) {
          endDate.setHours(23, 59, 59, 999);
          where.startDate.lte = endDate;
        }
      }
    }

    // 인원수 범위 필터
    if (paxMin !== undefined || paxMax !== undefined) {
      where.totalTravelers = {};
      if (paxMin !== undefined) where.totalTravelers.gte = paxMin;
      if (paxMax !== undefined) where.totalTravelers.lte = paxMax;
    }

    // 금액 범위 필터
    if (amountMin !== undefined || amountMax !== undefined) {
      where.totalAmount = {};
      if (amountMin !== undefined) where.totalAmount.gte = amountMin;
      if (amountMax !== undefined) where.totalAmount.lte = amountMax;
    }

    // 여행일수 범위 필터
    if (durationMin !== undefined || durationMax !== undefined) {
      where.travelDays = {};
      if (durationMin !== undefined) where.travelDays.gte = durationMin;
      if (durationMax !== undefined) where.travelDays.lte = durationMax;
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
          aiMetadata: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.estimate.count({ where }),
    ]);

    // embedding 컬럼은 Unsupported("vector")라 select 불가 → raw SQL로 보충
    const ids = estimates.map((e) => e.id);
    const embeddingRows =
      ids.length > 0
        ? await this.prisma.$queryRaw<Array<{ id: number; has: boolean }>>`
            SELECT id, (embedding IS NOT NULL) AS has FROM estimates WHERE id = ANY(${ids})
          `
        : [];
    const embeddingMap = new Map(embeddingRows.map((r) => [r.id, r.has]));

    return createPaginatedResponse(
      estimates.map((e) => ({
        ...convertDecimalFields(e),
        hasEmbedding: embeddingMap.get(e.id) ?? false,
      })),
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

  // 아이템 정보 보강 헬퍼 (캐싱 적용)
  private async enrichEstimateItems(estimate: Estimate) {
    const items = jsonCast<EstimateItemExtendedDto[]>(estimate.items);
    if (!items || items.length === 0) return estimate;

    // itemInfo가 없거나 lat/lng가 없는 아이템들의 itemId 수집
    const itemsToEnrich = items.filter(
      (item) =>
        !item.itemInfo ||
        !Array.isArray(item.itemInfo.images) ||
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
      const normalizedImages = extractImageUrls(item.itemInfo?.images);

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
      const dbImages = extractImageUrls(itemRecord.images);

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

      this.logger.debug(
        `[유효기간 체크] today=${todayKST}, validDate=${validDateKST}, expired=${todayKST > validDateKST}`,
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
    const safe = convertDecimalFields(enrichedEstimate);

    // 공개 접근 — 민감 필드 제거
    const { customerEmail, customerPhone, ...publicEstimate } = safe;
    return {
      ...publicEstimate,
      customerName: safe.customerName
        ? safe.customerName.charAt(0) + '***'
        : null,
    };
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

    // 유효기간 기본값: config의 estimateValidityDays (기본 10일)
    let validDate: Date | undefined;
    if (cleanData.validDate) {
      const parsed = new Date(cleanData.validDate);
      validDate = isNaN(parsed.getTime()) ? undefined : parsed;
    }
    if (!validDate) {
      const config = await this.prisma.aiGenerationConfig.findFirst({
        where: { id: 1 },
        select: { estimateValidityDays: true },
      });
      const days = config?.estimateValidityDays ?? 10;
      validDate = new Date();
      validDate.setDate(validDate.getDate() + days);
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
    this.invalidateCaches();
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
      'dayNotes',
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
    const DECIMAL_FIELDS = [
      'subtotal',
      'manualAdjustment',
      'totalAmount',
    ] as const;
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
        ...(data.dayNotes !== undefined && {
          dayNotes: data.dayNotes as unknown as Prisma.InputJsonValue,
        }),
        ...(data.revisionHistory !== undefined && {
          revisionHistory:
            data.revisionHistory as unknown as Prisma.InputJsonValue,
        }),
      },
    });

    this.invalidateCaches();
    return convertDecimalFields(estimate);
  }

  // 견적 삭제
  async deleteEstimate(id: number) {
    const result = await this.prisma.estimate.delete({
      where: { id },
    });
    this.invalidateCaches();
    return result;
  }

  // 수동 견적 상태 변경
  async updateManualStatus(id: number, status: string) {
    const updates: Prisma.EstimateUpdateInput = { statusManual: status };
    if (status === 'completed') updates.completedAt = new Date();
    const result = await this.prisma.estimate.update({
      where: { id },
      data: updates,
    });
    this.invalidateCaches();
    return result;
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

    this.invalidateCaches();

    return estimate;
  }

  // 고정 토글
  async togglePinned(id: number, isPinned: boolean) {
    return this.prisma.estimate.update({ where: { id }, data: { isPinned } });
  }

  // 아이템 업데이트
  async updateItems(id: number, items: EstimateItemDto[]) {
    const rawSubtotal = items.reduce(
      (sum, item) =>
        sum + ((item as any).subtotal ?? (item.price * item.quantity || 0)),
      0,
    );
    const subtotal = Number.isFinite(rawSubtotal) ? rawSubtotal : 0;
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

      const totalAmount = Number(estimate.subtotal ?? 0) + amount;

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
      dayNotes,
      revisionHistory: _rh,
      aiMetadata,
      ...copyData
    } = original;

    // JsonValue null 처리 헬퍼
    const toJsonInput = (value: Prisma.JsonValue | null) =>
      value === null ? Prisma.JsonNull : value;

    const createData: Prisma.EstimateUncheckedCreateInput = {
      ...copyData,
      items: toJsonInput(items),
      displayOptions: toJsonInput(displayOptions),
      timeline: toJsonInput(timeline),
      dayNotes: toJsonInput(dayNotes),
      aiMetadata: toJsonInput(aiMetadata),
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
      {
        isPinned: pinned,
        createdAt: { gt: current.createdAt },
        id: { not: id },
      },
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
      {
        isPinned: pinned,
        createdAt: { lt: current.createdAt },
        id: { not: id },
      },
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

  // 견적 요약 배치 조회
  async getEstimateSummaries(ids: number[]) {
    if (ids.length === 0) return [];

    const estimates = await this.prisma.estimate.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        title: true,
        statusManual: true,
        statusAi: true,
        source: true,
        customerName: true,
        customerEmail: true,
        regions: true,
        startDate: true,
        endDate: true,
        travelDays: true,
        adultsCount: true,
        childrenCount: true,
        infantsCount: true,
        totalAmount: true,
        currency: true,
        createdAt: true,
      },
    });

    return estimates.map(convertDecimalFields);
  }

  // TBD 수동 매칭 해결
  async resolveTbdItem(estimateId: number, itemIndex: number, itemId: number) {
    // 읽기 전용 조회 (트랜잭션 밖)
    const estimate = await this.prisma.estimate.findUnique({
      where: { id: estimateId },
    });
    if (!estimate) throw new NotFoundException('견적을 찾을 수 없습니다');

    // JSON items - use Record type for flexibility
    const items = jsonCast<Record<string, unknown>[]>(estimate.items);
    if (itemIndex < 0 || itemIndex >= items.length) {
      throw new NotFoundException('아이템 인덱스가 유효하지 않습니다');
    }
    if (!items[itemIndex].isTbd) {
      throw new NotFoundException('해당 아이템은 TBD가 아닙니다');
    }

    // DB에서 장소 조회
    const place = await this.prisma.item.findUnique({
      where: { id: itemId },
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
    });
    if (!place) throw new NotFoundException('장소를 찾을 수 없습니다');

    // 아이템 업데이트
    items[itemIndex] = {
      ...items[itemIndex],
      isTbd: false,
      itemId: place.id,
      itemName: place.nameKor || place.nameEng,
      name: place.nameKor,
      nameEng: place.nameEng,
      itemInfo: {
        nameKor: place.nameKor,
        nameEng: place.nameEng,
        descriptionEng: place.descriptionEng || undefined,
        images: extractImageUrls(place.images),
        lat: Number(place.lat),
        lng: Number(place.lng),
        addressEnglish: place.addressEnglish || undefined,
      },
    };

    // aiMetadata 업데이트
    const aiMetadata = (estimate.aiMetadata as Record<string, unknown>) || {};
    const itemMatching =
      (aiMetadata.itemMatching as Record<string, unknown>) || {};
    if (typeof itemMatching.tbdCount === 'number') itemMatching.tbdCount--;
    if (typeof itemMatching.matchedCount === 'number')
      itemMatching.matchedCount++;
    aiMetadata.itemMatching = itemMatching;

    // confidenceScore 재계산 (간이)
    const totalDraft = (itemMatching.totalDraftItems as number) || items.length;
    const matchedCount = (itemMatching.matchedCount as number) || 0;
    const tbdCount = (itemMatching.tbdCount as number) || 0;
    const matchRate = matchedCount / (totalDraft || 1);
    const tbdRate = tbdCount / (totalDraft || 1);
    const ragSources =
      ((aiMetadata.ragSearch as Record<string, unknown>)?.sources as Array<{
        similarity: number;
      }>) || [];
    const avgSim =
      ragSources.slice(0, 3).reduce((s, r) => s + (r.similarity || 0), 0) /
      (Math.min(ragSources.length, 3) || 1);
    aiMetadata.confidenceScore = Math.round(
      Math.min(
        100,
        Math.max(
          0,
          (0.35 * matchRate + 0.25 * avgSim + 0.2 * 0.5 + 0.2 * (1 - tbdRate)) *
            100,
        ),
      ),
    );

    await this.prisma.estimate.update({
      where: { id: estimateId },
      data: {
        items: items as unknown as Prisma.InputJsonValue,
        aiMetadata: aiMetadata as unknown as Prisma.InputJsonValue,
      },
    });

    return this.getEstimate(estimateId);
  }

  // RAG 품질 통계
  // 일괄 삭제
  async bulkDelete(ids: number[]) {
    const result = await this.prisma.estimate.deleteMany({
      where: { id: { in: ids } },
    });
    this.invalidateCaches();
    return result;
  }

  // 일괄 상태 변경
  async bulkUpdateStatus(ids: number[], status: string) {
    const result = await this.prisma.estimate.updateMany({
      where: { id: { in: ids } },
      data: { statusManual: status },
    });
    this.invalidateCaches();
    return result;
  }
}
