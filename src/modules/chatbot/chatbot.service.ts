import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { isValidUUID } from '../../common/utils';
import { PrismaService } from '../../prisma/prisma.service';
import { ESTIMATE_STATUS } from '../estimate/dto';
import { ChatbotStepResponseService } from './chatbot-step-response.service';
import {
  calculateSkip,
  createPaginatedResponse,
} from '../../common/dto/pagination.dto';
import {
  TOUR_TYPES,
  INTEREST_MAIN,
  INTEREST_SUB,
  REGIONS,
  ATTRACTIONS,
  BUDGET_RANGES,
  AGE_RANGES,
  REFERRAL_SOURCES,
} from './constants/categories';
import { StepResponseDto } from './dto/step-response.dto';
import { StartFlowDto } from './dto/start-flow.dto';
import {
  UpdateStep1Dto,
  UpdateStep2Dto,
  UpdateStep3MainDto,
  UpdateStep3SubDto,
  UpdateStep4Dto,
  UpdatePlanDto,
  UpdateStep5Dto,
  UpdateStep6Dto,
} from './dto/update-step.dto';

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);

  constructor(
    private prisma: PrismaService,
    private stepResponseService: ChatbotStepResponseService,
    private configService: ConfigService,
  ) {}

  getAdminEmail(): string {
    return (
      this.configService.get<string>('CHATBOT_NOTIFICATION_EMAIL') ||
      this.configService.get<string>('ADMIN_EMAIL') ||
      'admin@tumakr.com'
    );
  }

  // 새 플로우 시작
  async startFlow(
    dto: StartFlowDto,
    userId?: string,
  ) {
    // tourType이 제공되면 Step 1 완료 상태로 생성 (currentStep = 2)
    const hasTourType = !!dto.tourType;

    const flow = await this.prisma.chatbotFlow.create({
      data: {
        pageVisits: dto.landingPage
          ? [{ path: dto.landingPage, timestamp: new Date() }]
          : [],
        userId, // 로그인한 사용자면 연결
        // visitorId 연결 (클라이언트에서 제공하는 경우)
        visitorId: dto.visitorId,
        // 세션 제목 (선택사항)
        title: dto.title || null,
        ...(hasTourType && {
          tourType: dto.tourType,
          currentStep: 2,
        }),
      },
    });

    return {
      sessionId: flow.sessionId,
      currentStep: flow.currentStep,
    };
  }

  // 플로우 조회
  async getFlow(sessionId: string, includeVisitor = false): Promise<any> {
    // UUID 형식 검증 (local- 등 임시 ID 거부)
    if (!isValidUUID(sessionId)) {
      throw new NotFoundException('Flow not found.');
    }

    let flow: Record<string, any>;

    if (includeVisitor) {
      // visitor JOIN 포함 경로 (admin, 알림 등)
      const flowWithVisitor = await this.prisma.chatbotFlow.findUnique({
        where: { sessionId },
        include: {
          visitor: {
            select: {
              ipAddress: true,
              country: true,
              countryName: true,
              city: true,
              timezone: true,
              utmSource: true,
              utmMedium: true,
              utmCampaign: true,
              utmTerm: true,
              utmContent: true,
              referrerUrl: true,
              landingPage: true,
              userAgent: true,
            },
          },
        },
      });
      if (!flowWithVisitor) {
        throw new NotFoundException('Flow not found.');
      }
      const { visitor, ...flowData } = flowWithVisitor;
      flow = {
        ...flowData,
        ipAddress: visitor?.ipAddress ?? null,
        userAgent: visitor?.userAgent ?? null,
        country: visitor?.country ?? null,
        countryName: visitor?.countryName ?? null,
        city: visitor?.city ?? null,
        timezone: visitor?.timezone ?? null,
        utmSource: visitor?.utmSource ?? null,
        utmMedium: visitor?.utmMedium ?? null,
        utmCampaign: visitor?.utmCampaign ?? null,
        utmTerm: visitor?.utmTerm ?? null,
        utmContent: visitor?.utmContent ?? null,
        referrerUrl: visitor?.referrerUrl ?? null,
        landingPage: visitor?.landingPage ?? null,
      };
    } else {
      // 빠른 경로: visitor JOIN 생략
      const flowData = await this.prisma.chatbotFlow.findUnique({
        where: { sessionId },
      });
      if (!flowData) {
        throw new NotFoundException('Flow not found.');
      }
      flow = {
        ...flowData,
        ipAddress: null,
        userAgent: null,
        country: null,
        countryName: null,
        city: null,
        timezone: null,
        utmSource: null,
        utmMedium: null,
        utmCampaign: null,
        utmTerm: null,
        utmContent: null,
        referrerUrl: null,
        landingPage: null,
      };
    }

    // estimateId가 있으면 견적 정보 조회
    let shareHash: string | null = null;
    let estimateStatus: string | null = null;
    if (flow.estimateId) {
      const estimate = await this.prisma.estimate.findUnique({
        where: { id: flow.estimateId },
        select: { shareHash: true, statusAi: true },
      });
      shareHash = estimate?.shareHash || null;
      estimateStatus = estimate?.statusAi || null;
    } else if (flow.isCompleted) {
      // 견적 없이 전문가에게 제출된 세션
      estimateStatus = ESTIMATE_STATUS.PENDING;
    }

    // 방문자 브라우징 기록 포함 옵션
    if (includeVisitor && flow.visitorId) {
      const visitorSession = await this.prisma.visitorSession.findUnique({
        where: { id: flow.visitorId },
        include: {
          pageViews: {
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              path: true,
              title: true,
              duration: true,
              scrollDepth: true,
              createdAt: true,
            },
          },
        },
      });

      return {
        ...flow,
        shareHash,
        estimateStatus,
        visitorBrowsingHistory: visitorSession?.pageViews || [],
      };
    }

    return {
      ...flow,
      shareHash,
      estimateStatus,
      visitorBrowsingHistory: [],
    };
  }

  // 세션 존재 확인만 (데이터 반환 X)
  async validateSessionExists(sessionId: string): Promise<void> {
    // UUID 형식 검증
    if (!isValidUUID(sessionId)) {
      throw new NotFoundException('Flow not found.');
    }

    const exists = await this.prisma.chatbotFlow.findUnique({
      where: { sessionId },
      select: { sessionId: true },
    });
    if (!exists) {
      throw new NotFoundException('Flow not found.');
    }
  }

  // Step 업데이트 공통 헬퍼
  private async updateFlowStep(
    sessionId: string,
    nextStep: number,
    data: Record<string, unknown>,
  ) {
    const flow = await this.getFlow(sessionId);
    return this.prisma.chatbotFlow.update({
      where: { sessionId },
      data: {
        ...data,
        currentStep: Math.max(flow.currentStep, nextStep),
      },
    });
  }

  // estimateId로 플로우 조회
  async getFlowByEstimateId(estimateId: number) {
    return this.prisma.chatbotFlow.findFirst({
      where: { estimateId },
    });
  }

  // 단계별 질문 조회
  async getStep(
    sessionId: string,
    step: number,
    subStep?: string,
  ): Promise<StepResponseDto> {
    const flow = await this.getFlow(sessionId);

    switch (step) {
      case 1:
        return this.stepResponseService.getStep1(flow);
      case 2:
        return this.stepResponseService.getStep2(flow);
      case 3:
        return subStep === 'sub'
          ? this.stepResponseService.getStep3Sub(flow)
          : this.stepResponseService.getStep3Main(flow);
      case 4:
        return this.stepResponseService.getStep4(flow);
      case 5:
        return this.stepResponseService.getStep5(flow);
      case 6:
        return this.stepResponseService.getStep6(flow);
      case 7:
        return this.stepResponseService.getStep7(flow);
      default:
        throw new NotFoundException('Invalid step.');
    }
  }

  // Step 1 업데이트
  async updateStep1(sessionId: string, dto: UpdateStep1Dto) {
    return this.updateFlowStep(sessionId, 2, { tourType: dto.tourType });
  }

  // Step 2 업데이트
  async updateStep2(sessionId: string, dto: UpdateStep2Dto) {
    const flow = await this.getFlow(sessionId);

    // 첫 방문인 경우 경복궁 자동 추가
    const attractions = dto.isFirstVisit
      ? ['gyeongbokgung']
      : flow.attractions || [];

    return this.prisma.chatbotFlow.update({
      where: { sessionId },
      data: {
        isFirstVisit: dto.isFirstVisit,
        attractions,
        currentStep: Math.max(flow.currentStep, 3),
      },
    });
  }

  // Step 3 메인 업데이트
  async updateStep3Main(sessionId: string, dto: UpdateStep3MainDto) {
    const flow = await this.getFlow(sessionId);
    return this.prisma.chatbotFlow.update({
      where: { sessionId },
      data: {
        interestMain: dto.interestMain,
        interestSub: [], // 메인이 변경되면 서브도 초기화
        currentStep: Math.max(flow.currentStep, 3),
      },
    });
  }

  // Step 3 서브 업데이트
  async updateStep3Sub(sessionId: string, dto: UpdateStep3SubDto) {
    const flow = await this.getFlow(sessionId);

    // 서브 관심사가 선택된 메인 관심사에 속하는지 검증
    const selectedMains = flow.interestMain || [];
    if (selectedMains.length > 0) {
      const invalidSubs = dto.interestSub.filter((sub) => {
        const subData = INTEREST_SUB[sub as keyof typeof INTEREST_SUB];
        return !subData || !selectedMains.includes(subData.main);
      });

      if (invalidSubs.length > 0) {
        throw new BadRequestException(
          `Invalid sub-interests for selected main categories: ${invalidSubs.join(', ')}`,
        );
      }
    }

    // 기존 interestMain 유지 + interestSub에서 추가 추론
    const inferredMains = new Set<string>(selectedMains);
    dto.interestSub.forEach((sub) => {
      const subData = INTEREST_SUB[sub as keyof typeof INTEREST_SUB];
      if (subData) {
        inferredMains.add(subData.main);
      }
    });

    return this.updateFlowStep(sessionId, 4, {
      interestSub: dto.interestSub,
      interestMain: [...inferredMains],
    });
  }

  // Step 4 업데이트
  async updateStep4(sessionId: string, dto: UpdateStep4Dto) {
    return this.updateFlowStep(sessionId, 5, { region: dto.region });
  }

  // Plan 업데이트 (계획유무 - 클라이언트 Step 3)
  async updatePlan(sessionId: string, dto: UpdatePlanDto) {
    return this.prisma.$transaction(async (tx) => {
      const flow = await tx.chatbotFlow.findUnique({ where: { sessionId } });
      if (!flow) {
        throw new NotFoundException('세션을 찾을 수 없습니다');
      }
      return tx.chatbotFlow.update({
        where: { sessionId },
        data: {
          hasPlan: dto.hasPlan,
          planDetails: dto.planDetails || null,
          isFlexible: dto.isFlexible,
        },
      });
    });
  }

  // Step 5 업데이트
  async updateStep5(sessionId: string, dto: UpdateStep5Dto) {
    const flow = await this.getFlow(sessionId);

    // 사용자가 선택한 명소로 덮어쓰기 (선택 취소 가능)
    const attractions = dto.attractions || [];

    return this.prisma.chatbotFlow.update({
      where: { sessionId },
      data: {
        attractions,
        currentStep: Math.max(flow.currentStep, 6),
      },
    });
  }

  // Step 6 업데이트 (인적사항 + 여행정보 통합)
  async updateStep6(sessionId: string, dto: UpdateStep6Dto, userId?: string) {
    await this.validateSessionExists(sessionId);

    // 여행 날짜가 오늘 이후인지 검증 (YYYY-MM-DD 문자열 비교로 타임존 이슈 방지)
    const todayStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    if (dto.travelDate < todayStr) {
      throw new BadRequestException(
        'Travel date must be today or in the future.',
      );
    }
    const travelDate = new Date(dto.travelDate + 'T00:00:00'); // 로컬 시간으로 파싱

    return this.prisma.chatbotFlow.update({
      where: { sessionId },
      data: {
        // 인적사항
        customerName: dto.customerName,
        customerEmail: dto.customerEmail,
        customerPhone: dto.customerPhone,
        nationality: dto.nationality,
        // 여행 정보
        travelDate,
        duration: dto.duration,
        // 인원 정보
        adultsCount: dto.adultsCount ?? 1,
        childrenCount: dto.childrenCount ?? 0,
        infantsCount: dto.infantsCount ?? 0,
        seniorsCount: dto.seniorsCount ?? 0,
        ageRange: dto.ageRange,
        // 예산 및 기타
        budgetRange: dto.budgetRange,
        needsPickup: dto.needsPickup,
        needsGuide: dto.needsGuide,
        // 추가 요청사항
        additionalNotes: dto.additionalNotes,
        // 유저 연결 (로그인 시)
        ...(userId && { userId }),
        // Step 6이 마지막 설문이므로 7로 설정 (견적 생성 준비)
        currentStep: 7,
      },
    });
  }

  // 페이지 방문 기록
  async trackPageVisit(sessionId: string, path: string) {
    await this.validateSessionExists(sessionId);

    // Atomic JSON append — no read-modify-write race condition
    await this.prisma.$executeRaw`
      UPDATE "chatbot_flows"
      SET "page_visits" = COALESCE("page_visits", '[]'::jsonb) || ${JSON.stringify([{ path, timestamp: new Date() }])}::jsonb
      WHERE "session_id" = ${sessionId}::uuid
    `;
  }

  // 카테고리 목록 조회
  async getCategories() {
    // 기존 ATTRACTIONS의 장소 이름들로 DB에서 검색
    const attractionNames = Object.values(ATTRACTIONS).map((a) => a.label);

    const placeItems = await this.prisma.item.findMany({
      where: {
        type: 'place',
        nameEng: { in: attractionNames },
      },
      select: {
        id: true,
        nameKor: true,
        nameEng: true,
        descriptionEng: true,
        images: true,
        region: true,
        categories: true,
      },
    });

    // nameEng으로 빠른 조회를 위한 맵 생성
    const itemMap = new Map(placeItems.map((item) => [item.nameEng, item]));

    // ATTRACTIONS 순서 유지하면서 DB 정보로 보강
    const attractionsWithDbInfo = Object.entries(ATTRACTIONS).map(
      ([key, attr]) => {
        const dbItem = itemMap.get(attr.label);
        const images = dbItem?.images as Array<
          string | { url: string; type?: string }
        > | null;

        // images 배열에서 첫 번째 이미지 URL 추출
        let firstImageUrl: string | null = null;
        if (images && images.length > 0) {
          const firstImage = images[0];
          if (typeof firstImage === 'string') {
            firstImageUrl = firstImage;
          } else if (
            firstImage &&
            typeof firstImage === 'object' &&
            'url' in firstImage
          ) {
            firstImageUrl = firstImage.url;
          }
        }

        return {
          value: key, // 기존 키 유지 (gyeongbokgung 등)
          label: attr.label,
          labelKo: attr.labelKo,
          region: attr.region,
          category: attr.category,
          description: dbItem?.descriptionEng || attr.description || '',
          imageUrl: firstImageUrl || attr.imageUrl || null, // DB 우선, 없으면 하드코딩 fallback
        };
      },
    );

    // 객체를 배열로 변환하는 헬퍼
    const toArray = <T extends Record<string, unknown>>(
      obj: T,
    ): Array<{ value: string } & T[keyof T]> =>
      Object.entries(obj).map(([key, val]) => ({
        value: key,
        ...(val as object),
      })) as Array<{ value: string } & T[keyof T]>;

    return {
      aiEnabled: this.configService.get('ENABLE_AI_ESTIMATE') === 'true',
      tourTypes: toArray(TOUR_TYPES),
      interestMain: toArray(INTEREST_MAIN),
      interestSub: toArray(INTEREST_SUB),
      regions: toArray(REGIONS),
      attractions: attractionsWithDbInfo,
      budgetRanges: toArray(BUDGET_RANGES),
      ageRanges: toArray(AGE_RANGES),
      referralSources: toArray(REFERRAL_SOURCES),
    };
  }

  // 라벨 변환 헬퍼 (이메일 템플릿용)
  resolveLabels(flow: {
    tourType: string | null;
    region: string | null;
    interestMain: string[];
    interestSub: string[];
    attractions: string[];
    budgetRange: string | null;
    ageRange: string | null;
  }) {
    const tourTypeLabel = flow.tourType
      ? TOUR_TYPES[flow.tourType as keyof typeof TOUR_TYPES]?.label ||
        flow.tourType
      : '-';
    const regionLabel = flow.region
      ? REGIONS[flow.region as keyof typeof REGIONS]?.label || flow.region
      : '-';
    const interestMainLabels = (flow.interestMain || []).map(
      (v) => INTEREST_MAIN[v as keyof typeof INTEREST_MAIN]?.label || v,
    );
    const interestSubLabels = (flow.interestSub || []).map(
      (v) => INTEREST_SUB[v as keyof typeof INTEREST_SUB]?.label || v,
    );
    const attractionLabels = (flow.attractions || []).map(
      (v) => ATTRACTIONS[v as keyof typeof ATTRACTIONS]?.label || v,
    );
    const budgetLabel = flow.budgetRange
      ? BUDGET_RANGES[flow.budgetRange as keyof typeof BUDGET_RANGES]?.label ||
        flow.budgetRange
      : '-';

    return {
      tourTypeLabel,
      regionLabel,
      interestLabels: [...interestMainLabels, ...interestSubLabels],
      attractionLabels,
      budgetLabel,
    };
  }

  // 관리자용: 모든 플로우 조회
  async getFlows(params: {
    page?: number;
    limit?: number;
    isCompleted?: boolean;
    startDate?: string;
    endDate?: string;
    utmSource?: string;
    sortColumn?: string;
    sortDirection?: string;
    estimateStatus?: string;
    hasEstimate?: boolean;
  }) {
    const {
      page = 1,
      limit = 20,
      isCompleted,
      startDate,
      endDate,
      utmSource,
      sortColumn,
      sortDirection,
      estimateStatus,
      hasEstimate,
    } = params;
    const skip = calculateSkip(page, limit);

    const where: Prisma.ChatbotFlowWhereInput = {};

    if (isCompleted !== undefined) {
      where.isCompleted = isCompleted;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    if (utmSource) {
      where.visitor = { utmSource };
    }

    // 견적 필터: estimateStatus 우선, 없으면 hasEstimate 적용
    if (estimateStatus) {
      const matchingEstimates = await this.prisma.estimate.findMany({
        where: { statusAi: estimateStatus },
        select: { id: true },
        take: 1000,
      });
      const matchingIds = matchingEstimates.map((e) => e.id);
      if (matchingIds.length === 0) {
        return createPaginatedResponse([], 0, page, limit);
      }
      where.estimateId = { in: matchingIds };
    } else if (hasEstimate === true) {
      where.estimateId = { not: null };
    } else if (hasEstimate === false) {
      where.estimateId = null;
    }

    // 정렬 로직
    const SORT_WHITELIST = [
      'createdAt',
      'customerName',
      'currentStep',
    ];
    let orderBy: Record<string, 'asc' | 'desc'> = { createdAt: 'desc' };
    if (sortColumn && SORT_WHITELIST.includes(sortColumn)) {
      const dir = sortDirection === 'asc' ? 'asc' : 'desc';
      orderBy = { [sortColumn]: dir };
    }

    const [flows, total] = await Promise.all([
      this.prisma.chatbotFlow.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        select: {
          id: true,
          sessionId: true,
          userId: true,
          currentStep: true,
          tourType: true,
          region: true,
          travelDate: true,
          customerName: true,
          customerEmail: true,
          isCompleted: true,
          estimateId: true,
          infoMismatch: true,
          guestName: true,
          guestEmail: true,
          adminTags: true,
          adminMemo: true,
          createdAt: true,
          visitor: {
            select: {
              ipAddress: true,
              country: true,
              countryName: true,
              city: true,
              utmSource: true,
              referrerUrl: true,
              landingPage: true,
            },
          },
        },
      }),
      this.prisma.chatbotFlow.count({ where }),
    ]);

    // estimateId가 있는 플로우들의 견적 상태를 배치 조회 (N+1 방지)
    const estimateIds = flows
      .filter((f) => f.estimateId)
      .map((f) => f.estimateId!);

    const estimateStatusMap =
      estimateIds.length > 0
        ? new Map(
            (
              await this.prisma.estimate.findMany({
                where: { id: { in: estimateIds } },
                select: { id: true, statusAi: true },
              })
            ).map((e) => [e.id, e.statusAi]),
          )
        : new Map<number, string | null>();

    // 플로우에 estimateStatus 추가 + visitor 필드 flatten
    const flowsWithStatus = flows.map(({ visitor, ...flow }) => ({
      ...flow,
      ipAddress: visitor?.ipAddress ?? null,
      country: visitor?.country ?? null,
      countryName: visitor?.countryName ?? null,
      city: visitor?.city ?? null,
      utmSource: visitor?.utmSource ?? null,
      referrerUrl: visitor?.referrerUrl ?? null,
      landingPage: visitor?.landingPage ?? null,
      estimateStatus: flow.estimateId
        ? estimateStatusMap.get(flow.estimateId) || null
        : null,
    }));

    return createPaginatedResponse(flowsWithStatus, total, page, limit);
  }

  // 세션 삭제
  async deleteSession(sessionId: string, userId?: string, userRole?: string) {
    const flow = await this.getFlow(sessionId);

    // 사용자 권한 확인 (admin은 모든 세션 삭제 가능)
    const isAdmin = userRole === 'admin';
    if (!isAdmin && userId && flow.userId && flow.userId !== userId) {
      throw new ForbiddenException(
        'You do not have permission to delete this session.',
      );
    }

    // ChatbotMessage는 onDelete: Cascade로 자동 삭제됨
    await this.prisma.chatbotFlow.delete({
      where: { sessionId },
    });

    return { success: true };
  }

  // ============ 관리자용: 일괄 삭제 ============

  async bulkDelete(sessionIds: string[]) {
    if (!sessionIds || sessionIds.length === 0) {
      throw new BadRequestException('삭제할 세션 ID가 없습니다.');
    }
    if (sessionIds.length > 100) {
      throw new BadRequestException('Maximum 100 sessions per request.');
    }

    // ChatbotMessage는 onDelete: Cascade로 자동 삭제됨
    const result = await this.prisma.chatbotFlow.deleteMany({
      where: { sessionId: { in: sessionIds } },
    });

    return { deletedCount: result.count };
  }

  // ============ 관리자용: 태그/메모 업데이트 ============

  async updateFlowMeta(
    sessionId: string,
    data: { adminTags?: string[]; adminMemo?: string },
  ) {
    if (!isValidUUID(sessionId)) {
      throw new BadRequestException('Invalid session ID format');
    }

    const flow = await this.prisma.chatbotFlow.findUnique({
      where: { sessionId },
    });

    if (!flow) {
      throw new NotFoundException('Flow not found');
    }

    const updateData: { adminTags?: string[]; adminMemo?: string } = {};
    if (data.adminTags !== undefined) {
      updateData.adminTags = data.adminTags;
    }
    if (data.adminMemo !== undefined) {
      updateData.adminMemo = data.adminMemo;
    }

    return this.prisma.chatbotFlow.update({
      where: { sessionId },
      data: updateData,
      select: {
        sessionId: true,
        adminTags: true,
        adminMemo: true,
      },
    });
  }
}
