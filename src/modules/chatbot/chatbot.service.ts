import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { isValidUUID, jsonCast } from '../../common/utils';
import { PrismaService } from '../../prisma/prisma.service';
import { SupabaseService } from '../../supabase/supabase.service';
import { EstimateService } from '../estimate/estimate.service';
import { ESTIMATE_STATUS } from '../estimate/dto';
import { AiEstimateService } from './ai-estimate.service';
import { ChatbotSseService } from './chatbot-sse.service';
import { ChatbotStepResponseService } from './chatbot-step-response.service';
import { NotificationService } from '../notification/notification.service';
import { EmailService } from '../email/email.service';
import {
  chatbotInquiryAdminTemplate,
  modificationRequestTemplate,
} from '../email/email-templates';
import { EstimateItem } from '../../common/types';
import { ESTIMATE_EVENTS, CHATBOT_EVENTS } from '../../common/events';
import type {
  EstimateSentEvent,
  ChatbotNewMessageEvent,
} from '../../common/events';
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
  UpdateStep7Dto,
} from './dto/update-step.dto';

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);

  constructor(
    private prisma: PrismaService,
    private supabaseService: SupabaseService,
    private estimateService: EstimateService,
    private aiEstimateService: AiEstimateService,
    private sseService: ChatbotSseService,
    private stepResponseService: ChatbotStepResponseService,
    private notificationService: NotificationService,
    private emailService: EmailService,
    private configService: ConfigService,
    private eventEmitter: EventEmitter2,
  ) {}

  private getAdminEmail(): string {
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
  async getFlow(sessionId: string, includeVisitorHistory = false) {
    // UUID 형식 검증 (local- 등 임시 ID 거부)
    if (!isValidUUID(sessionId)) {
      throw new NotFoundException('Flow not found.');
    }

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

    // Flatten visitor fields onto flow for backward compatibility
    const { visitor, ...flowData } = flowWithVisitor;
    const flow = {
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
    if (includeVisitorHistory && flow.visitorId) {
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
    };
  }

  // 세션 존재 확인만 (데이터 반환 X)
  private async validateSessionExists(sessionId: string): Promise<void> {
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
    const flow = await this.prisma.chatbotFlow.findFirst({
      where: { estimateId },
    });

    if (!flow) {
      return null;
    }

    return flow;
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
    // interestMain이 있는 경우에만 검증 (클라이언트 플로우에서는 interestMain 없이 바로 sub 선택 가능)
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

  // Step 7 업데이트 (로그인 필수)
  async updateStep7(sessionId: string, dto: UpdateStep7Dto, userId: string) {
    await this.validateSessionExists(sessionId);
    return this.prisma.chatbotFlow.update({
      where: { sessionId },
      data: {
        userId,
        customerName: dto.customerName,
        customerEmail: dto.customerEmail,
        customerPhone: dto.customerPhone,
        nationality: dto.nationality,
        referralSource: dto.referralSource,
        additionalNotes: dto.additionalNotes,
      },
    });
  }

  // 페이지 방문 기록
  async trackPageVisit(sessionId: string, path: string) {
    const flow = await this.getFlow(sessionId);

    const visits =
      jsonCast<{ path: string; timestamp: Date }[]>(flow.pageVisits) || [];
    visits.push({ path, timestamp: new Date() });

    return this.prisma.chatbotFlow.update({
      where: { sessionId },
      data: { pageVisits: visits as unknown as object },
    });
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
  private resolveLabels(flow: {
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

  // 플로우 완료 및 견적 생성 (AI 기반)
  async completeFlow(sessionId: string, userId?: string) {
    this.logger.log(
      `Completing flow: sessionId=${sessionId}, userId=${userId || 'anonymous'}`,
    );

    const flow = await this.getFlow(sessionId);

    // 이미 완료된 경우 (멱등성)
    if (flow.isCompleted) {
      this.logger.log(
        `Flow already completed: sessionId=${sessionId}, estimateId=${flow.estimateId ?? 'none'}`,
      );
      if (flow.estimateId) {
        const estimate = await this.estimateService.getEstimate(flow.estimateId);
        const items = (
          Array.isArray(estimate.items) ? estimate.items : []
        ) as EstimateItem[];
        return {
          flow,
          estimate,
          templateUsed: null,
          hasTbdDays: items.some((item) => item.isTbd),
        };
      }
      // hasPlan 또는 AI 비활성 경로: 견적 없이 완료된 경우
      return {
        flow,
        estimate: null,
        templateUsed: null,
        hasTbdDays: false,
      };
    }

    // 필수 정보 검증
    if (!flow.customerName || !flow.customerEmail) {
      this.logger.warn(`Missing customer info: sessionId=${sessionId}`);
      throw new BadRequestException(
        'Please complete Step 6 first. Customer information is required.',
      );
    }

    try {
      // Atomic check: isCompleted=false인 경우에만 업데이트 (race condition 방지)
      const lockResult = await this.prisma.chatbotFlow.updateMany({
        where: { sessionId, isCompleted: false },
        data: { isCompleted: true },
      });
      if (lockResult.count === 0) {
        // 다른 요청이 먼저 완료함 — 최신 상태 반환
        return this.completeFlow(sessionId, userId);
      }

      const aiEstimateEnabled =
        this.configService.get('ENABLE_AI_ESTIMATE') === 'true';

      if (!aiEstimateEnabled || flow.hasPlan) {
        // AI 비활성화 또는 계획이 있는 경우: 견적 생성 없이 플로우만 완료
        if (userId) {
          await this.prisma.chatbotFlow.update({
            where: { sessionId },
            data: { userId },
          });
        }
        const updatedFlow = await this.getFlow(sessionId);
        this.logger.log(
          `Flow completed (${flow.hasPlan ? 'has plan' : 'AI disabled'}): sessionId=${sessionId}`,
        );

        // 알림/이메일 발송 (실패해도 core 동작 유지)
        try {
          await this.notifyExpertSubmission(sessionId, updatedFlow);
        } catch (error) {
          this.logger.error(
            `Notification failed for completeFlow (hasPlan/AI disabled): sessionId=${sessionId}`,
            error.stack,
          );
        }

        return {
          flow: updatedFlow,
          estimate: null,
          templateUsed: null,
          hasTbdDays: false,
        };
      }

      // AiEstimateService를 사용하여 AI 기반 견적 생성
      const { estimateId } =
        await this.aiEstimateService.generateFirstEstimate(sessionId);

      // 업데이트된 플로우 조회
      const updatedFlow = await this.getFlow(sessionId);

      // Flow + Estimate에 userId 연결
      if (userId) {
        const updates: Promise<unknown>[] = [];
        if (!updatedFlow.userId) {
          updates.push(
            this.prisma.chatbotFlow.update({
              where: { sessionId },
              data: { userId },
            }),
          );
        }
        updates.push(
          this.prisma.estimate.update({
            where: { id: estimateId },
            data: { userId },
          }),
        );
        await Promise.all(updates);
      }

      // 견적 아이템 정보 보강
      const enrichedEstimate =
        await this.estimateService.getEstimate(estimateId);
      const items = (
        Array.isArray(enrichedEstimate.items) ? enrichedEstimate.items : []
      ) as EstimateItem[];

      this.logger.log(
        `Flow completed successfully: sessionId=${sessionId}, estimateId=${estimateId}`,
      );

      return {
        flow: updatedFlow,
        estimate: enrichedEstimate,
        templateUsed: null,
        hasTbdDays: items.some((item) => item.isTbd),
      };
    } catch (error) {
      this.logger.error(
        `Failed to complete flow: sessionId=${sessionId}`,
        error.stack,
      );

      // AI 견적 생성 실패 시 isCompleted 롤백 (재시도 가능하도록)
      try {
        await this.prisma.chatbotFlow.update({
          where: { sessionId },
          data: { isCompleted: false },
        });
        this.logger.log(
          `Rolled back isCompleted for sessionId=${sessionId}`,
        );
      } catch (rollbackError) {
        this.logger.error(
          `Failed to rollback isCompleted for sessionId=${sessionId}`,
          rollbackError.stack,
        );
      }

      throw new InternalServerErrorException(
        '견적 생성 처리 중 오류가 발생했습니다',
      );
    }
  }

  /**
   * 알림/이메일 발송 전용 private 메서드
   * DB 변경 없이 알림만 담당 (푸시 알림, 관리자 이메일, 고객 확인 이메일)
   */
  private async notifyExpertSubmission(
    sessionId: string,
    flow: Awaited<ReturnType<ChatbotService['getFlow']>>,
  ) {
    const notificationResults = {
      pushNotification: { sent: false, error: null as string | null },
      adminEmail: { sent: false, error: null as string | null },
      customerEmail: {
        sent: false,
        error: null as string | null,
        skipped: false,
      },
    };

    // 관리자에게 푸시 알림 전송
    try {
      await this.notificationService.notifyNewEstimateRequest({
        estimateId: flow.estimateId ?? undefined,
        sessionId: sessionId,
        customerName: flow.customerName ?? undefined,
        tourType: flow.tourType ?? undefined,
      });
      notificationResults.pushNotification.sent = true;
      this.logger.log(`Notification sent for session: ${sessionId}`);
    } catch (error) {
      notificationResults.pushNotification.error = error.message;
      this.logger.error(`Failed to send notification: ${error.message}`);
    }

    // 방문자 브라우징 기록 조회 (이메일 내용용)
    let visitedProducts: string[] = [];
    if (flow.visitorId) {
      try {
        const visitorSession = await this.prisma.visitorSession.findUnique({
          where: { id: flow.visitorId },
          include: {
            pageViews: {
              orderBy: { createdAt: 'asc' },
              select: { path: true, title: true },
            },
          },
        });
        if (visitorSession?.pageViews) {
          visitedProducts = visitorSession.pageViews
            .filter((pv) => pv.title && pv.path?.startsWith('/tour'))
            .map((pv) => pv.title!);
        }
      } catch (err) {
        this.logger.warn(
          `Failed to fetch visitor browsing history: ${err.message}`,
        );
      }
    }

    // 관리자 + 고객 이메일 병렬 발송
    const adminEmail = this.getAdminEmail();

    const travelDateStr = flow.travelDate
      ? new Date(flow.travelDate).toLocaleDateString('en-US', {
          month: '2-digit',
          day: '2-digit',
          year: 'numeric',
        })
      : '';

    const labels = this.resolveLabels(flow);
    const adminUrl =
      this.configService.get<string>('CLIENT_URL') || 'http://localhost:3000';

    const emailPromises: Promise<void>[] = [];

    // 관리자 이메일
    emailPromises.push(
      this.emailService.sendEmail({
        to: adminEmail,
        subject: `[New Inquiry] ${flow.customerName || 'Customer'} - ${flow.tourType || 'Tour'} Request`,
        html: chatbotInquiryAdminTemplate({
          customerName: flow.customerName ?? '-',
          customerEmail: flow.customerEmail ?? '-',
          customerPhone: flow.customerPhone ?? '-',
          nationality: flow.nationality ?? '-',
          ipAddress: flow.ipAddress ?? '-',
          countryName: flow.countryName ?? '',
          country: flow.country ?? '',
          tourType: flow.tourType ?? '',
          needsPickup: flow.needsPickup ?? false,
          isFirstVisit: flow.isFirstVisit ?? false,
          travelDate: travelDateStr,
          duration: flow.duration ?? 0,
          budgetRange: flow.budgetRange ?? '',
          adultsCount: flow.adultsCount ?? 0,
          childrenCount: flow.childrenCount ?? 0,
          infantsCount: flow.infantsCount ?? 0,
          seniorsCount: flow.seniorsCount ?? 0,
          ageRange: flow.ageRange ?? '',
          interestLabels: labels.interestLabels,
          attractionLabels: labels.attractionLabels,
          region: flow.region ?? '',
          regionLabel: labels.regionLabel,
          tourTypeLabel: labels.tourTypeLabel,
          budgetLabel: labels.budgetLabel,
          additionalNotes: flow.additionalNotes ?? '',
          needsGuide: flow.needsGuide ?? false,
          hasPlan: flow.hasPlan ?? null,
          planDetails: flow.planDetails ?? '',
          visitedProducts,
          sessionId,
          adminUrl,
        }),
      }).then(() => {
        notificationResults.adminEmail.sent = true;
        this.logger.log(`Admin email sent for session: ${sessionId}`);
      }).catch((error) => {
        notificationResults.adminEmail.error = error.message;
        this.logger.error(`Failed to send admin email: ${error.message}`);
      }),
    );

    // 고객 확인 이메일
    if (flow.customerEmail) {
      const surveySummary = this.stepResponseService.buildSurveySummary(
        flow as Parameters<
          ChatbotStepResponseService['buildSurveySummary']
        >[0],
      );
      emailPromises.push(
        this.emailService.sendContactConfirmation({
          to: flow.customerEmail,
          customerName: flow.customerName || 'Customer',
          message: surveySummary,
        }).then(() => {
          notificationResults.customerEmail.sent = true;
          this.logger.log(
            `Confirmation email sent to customer: ${flow.customerEmail}`,
          );
        }).catch((error) => {
          notificationResults.customerEmail.error = error.message;
          this.logger.error(`Failed to send customer email: ${error.message}`);
        }),
      );
    } else {
      notificationResults.customerEmail.skipped = true;
    }

    await Promise.all(emailPromises);

    return notificationResults;
  }

  /**
   * 전문가 알림 발송 public 래퍼 (컨트롤러에서 finalize 후 체이닝용)
   */
  async triggerExpertNotification(sessionId: string) {
    const flow = await this.getFlow(sessionId);
    try {
      await this.notifyExpertSubmission(sessionId, flow);
    } catch (error) {
      this.logger.error(
        `triggerExpertNotification failed for session ${sessionId}: ${error.message}`,
      );
    }
  }

  // 전문가에게 보내기 (견적 없이도 상담 요청 전송 가능)
  async sendToExpert(sessionId: string, userId?: string) {
    const flow = await this.getFlow(sessionId);

    // 소유자 검증 (userId가 주어지고 flow에도 userId가 있으면 일치해야 함)
    if (userId && flow.userId && flow.userId !== userId) {
      throw new ForbiddenException(
        'You do not have permission to submit this session.',
      );
    }

    // Atomic 멱등성 가드: isCompleted=false → true (TOCTOU 레이스 방지)
    const lockResult = await this.prisma.chatbotFlow.updateMany({
      where: { sessionId, isCompleted: false },
      data: { isCompleted: true },
    });
    if (lockResult.count === 0) {
      // 이미 완료됨 — 이메일 재발송 방지
      return {
        success: true,
        alreadySent: true,
        message: flow.estimateId
          ? 'Already sent to expert for review.'
          : 'Inquiry already submitted.',
        estimateId: flow.estimateId ?? null,
        status: ESTIMATE_STATUS.PENDING,
      };
    }

    // 알림/이메일 발송
    const notificationResults = await this.notifyExpertSubmission(sessionId, flow);

    // 견적이 있으면 상태 업데이트
    let estimateStatus: string | null = ESTIMATE_STATUS.PENDING;
    if (flow.estimateId) {
      const estimate = await this.estimateService.updateAIStatus(
        flow.estimateId,
        ESTIMATE_STATUS.PENDING,
      );
      estimateStatus = estimate.statusAi || ESTIMATE_STATUS.PENDING;
    }

    // 알림 실패 여부 체크
    const hasNotificationFailure =
      !notificationResults.pushNotification.sent ||
      !notificationResults.adminEmail.sent ||
      (!notificationResults.customerEmail.sent &&
        !notificationResults.customerEmail.skipped);

    // 응답 생성
    const response = {
      success: true, // 핵심 작업(플로우 완료)은 성공
      message: flow.estimateId
        ? 'Sent to expert for review.'
        : 'Inquiry submitted. Our expert will contact you soon.',
      estimateId: flow.estimateId ?? null,
      status: estimateStatus,
      notifications: notificationResults,
      ...(hasNotificationFailure && {
        warning:
          'Some notifications could not be sent. Our team has been notified.',
      }),
    };

    // 알림 실패 시 관리자에게 경고 로그 (모니터링용)
    if (hasNotificationFailure) {
      this.logger.warn(
        `Partial notification failure for session ${sessionId}:`,
        notificationResults,
      );
    }

    return response;
  }

  // 고객 응답 (승인/수정요청)
  async respondToEstimate(
    sessionId: string,
    response: 'approved' | 'declined', // approved: 결제 대기, declined: 거절
    modificationRequest?: string,
    revisionDetails?: {
      items?: Array<{ itemIndex: number; action: 'keep' | 'remove' | 'replace'; preference?: string }>;
      dateChange?: string;
      durationChange?: number;
      groupChange?: { adults?: number; children?: number; infants?: number };
      budgetChange?: string;
      note?: string;
    },
    userId?: string,
  ) {
    const flow = await this.getFlow(sessionId);

    if (!flow.estimateId) {
      throw new BadRequestException('Estimate not found.');
    }

    // 소유자 검증
    if (userId && flow.userId && flow.userId !== userId) {
      throw new ForbiddenException(
        'You do not have permission to respond to this estimate.',
      );
    }

    // 상태 전이 검증 — sent 또는 pending 상태에서만 응답 가능
    const currentEstimate = await this.prisma.estimate.findUnique({
      where: { id: flow.estimateId },
      select: { statusAi: true, requestContent: true, customerName: true, revisionHistory: true },
    });
    const respondableStates: string[] = [ESTIMATE_STATUS.SENT, ESTIMATE_STATUS.PENDING];
    if (!respondableStates.includes(currentEstimate?.statusAi || '')) {
      throw new BadRequestException(
        `Cannot respond in current state: ${currentEstimate?.statusAi}`,
      );
    }

    // 수정 요청이 있으면 revisionRequested 플래그 활성화 및 상태를 pending으로 변경
    if (modificationRequest || revisionDetails) {
      const existingContent = currentEstimate?.requestContent || '';
      const freeText = modificationRequest || revisionDetails?.note || '';
      const updatedContent = existingContent
        ? `${existingContent}\n\n--- Modification Request ---\n${freeText}`
        : freeText;

      // Build revision history entry
      const existingHistory = Array.isArray(currentEstimate?.revisionHistory)
        ? (currentEstimate.revisionHistory as Array<Record<string, unknown>>)
        : [];
      const newEntry = {
        revisionNumber: existingHistory.length + 1,
        requestedAt: new Date().toISOString(),
        details: revisionDetails || null,
        freeTextNote: modificationRequest || null,
        status: 'pending',
      };

      await this.prisma.estimate.update({
        where: { id: flow.estimateId },
        data: {
          requestContent: updatedContent,
          revisionRequested: true,
          revisionNote: freeText,
          revisedAt: new Date(),
          revisionHistory: [...existingHistory, newEntry] as unknown as import('@prisma/client').Prisma.InputJsonValue,
          statusAi: ESTIMATE_STATUS.PENDING,
        },
      });

      // 관리자에게 수정 요청 알림 전송 (DB 알림 + 이메일)
      try {
        await this.notificationService.notifyModificationRequest({
          estimateId: flow.estimateId,
          sessionId: sessionId,
          customerName:
            currentEstimate?.customerName || flow.customerName || undefined,
          requestContent: freeText,
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Failed to send modification request notification: ${errorMessage}`,
        );
      }

      // 관리자 이메일 발송
      try {
        const adminEmail = this.getAdminEmail();
        const adminUrl =
          this.configService.get<string>('CLIENT_URL') ||
          'http://localhost:3000';

        await this.emailService.sendEmail({
          to: adminEmail,
          subject: `[수정 요청] ${currentEstimate?.customerName || flow.customerName || '고객'}님 - 견적 #${flow.estimateId}`,
          html: modificationRequestTemplate({
            customerName:
              currentEstimate?.customerName || flow.customerName || '고객',
            customerEmail: flow.customerEmail || '-',
            estimateId: flow.estimateId,
            requestContent: freeText,
            sessionId: sessionId,
            adminUrl,
          }),
        });
        this.logger.log(
          `Modification request email sent for estimate #${flow.estimateId}`,
        );
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Failed to send modification request email: ${errorMessage}`,
        );
      }

      return {
        success: true,
        message:
          'Modification request submitted. Our expert will review and contact you.',
        status: ESTIMATE_STATUS.PENDING, // 상태를 pending으로 반환
      };
    }

    // 거절인 경우 cancelled로
    if (response === 'declined') {
      const estimate = await this.estimateService.updateAIStatus(
        flow.estimateId,
        ESTIMATE_STATUS.CANCELLED,
      );
      return {
        success: true,
        message: 'Estimate declined.',
        status: estimate.statusAi,
      };
    }

    // 승인인 경우 approved로 (결제 대기)
    const estimate = await this.estimateService.updateAIStatus(
      flow.estimateId,
      ESTIMATE_STATUS.APPROVED,
    );

    return {
      success: true,
      message: 'Estimate approved. Please proceed to payment.',
      status: estimate.statusAi,
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
      // 서브쿼리 대신 raw SQL로 최적화 (전체 estimate 스캔 방지)
      const matchingEstimates = await this.prisma.estimate.findMany({
        where: { statusAi: estimateStatus },
        select: { id: true },
        take: 1000, // 무한 스캔 방지
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
        // 목록 조회 시 큰 필드 제외 (pageVisits)
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
          // 정보 불일치
          infoMismatch: true,
          guestName: true,
          guestEmail: true,
          // 태그/메모
          adminTags: true,
          adminMemo: true,
          createdAt: true,
          // visitor 관계 (geo/tracking 정보)
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
      // visitor 관계를 최상위로 펼침 (API 응답 호환)
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

  // ============================================================================
  // 이벤트 핸들러
  // ============================================================================

  /**
   * 견적 발송 이벤트 핸들러
   * EstimateService에서 견적 발송 시 호출됨
   */
  @OnEvent(ESTIMATE_EVENTS.SENT)
  async handleEstimateSent(event: EstimateSentEvent) {
    try {
      await this.saveMessage(event.chatSessionId, {
        role: 'bot',
        content: `🎉 Your personalized travel quotation is ready!\n\nPlease review the details and let us know if you'd like any modifications. You can click "Request Modification" to make changes, or "Accept" to confirm your booking.`,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to save chat message for estimate ${event.estimateId}: ${errorMessage}`,
      );
    }
  }

  // ============ 메시지 관련 API ============

  /**
   * 메시지 저장 후 공통 처리:
   * - 첫 사용자 메시지 → 세션 제목 자동 설정
   * - user 메시지 & 견적 sent 상태 → 관리자 알림
   * - SSE 이벤트 발행
   */
  private async processAfterMessageSave(
    sessionId: string,
    savedMessages: Array<{ id: number; role: string; content: string; createdAt: Date }>,
    flow: { estimateId: number | null; customerName: string | null },
  ) {
    const firstUserMsg = savedMessages.find((m) => m.role === 'user');

    // 첫 번째 사용자 메시지로 세션 제목 자동 설정
    if (firstUserMsg) {
      const existingUserMsgCount = await this.prisma.chatbotMessage.count({
        where: { sessionId, role: 'user' },
      });
      const userMsgsInBatch = savedMessages.filter((m) => m.role === 'user').length;

      if (existingUserMsgCount === userMsgsInBatch) {
        const title =
          firstUserMsg.content.slice(0, 50) +
          (firstUserMsg.content.length > 50 ? '...' : '');
        await this.prisma.chatbotFlow.update({
          where: { sessionId },
          data: { title },
        });
      }

      // 고객이 메시지를 보냈고, 견적이 전송된 상태라면 관리자에게 알림
      if (flow.estimateId) {
        const estimate = await this.prisma.estimate.findUnique({
          where: { id: flow.estimateId },
          select: { statusAi: true, customerName: true },
        });

        if (estimate?.statusAi === 'sent') {
          try {
            await this.notificationService.notifyCustomerMessage({
              sessionId,
              customerName:
                estimate.customerName || flow.customerName || undefined,
              messagePreview: firstUserMsg.content,
            });
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            this.logger.error(
              `Failed to send customer message notification: ${errorMessage}`,
            );
          }
        }
      }
    }

    // SSE 이벤트 발행 (마지막 메시지 기준)
    const lastMsg = savedMessages[savedMessages.length - 1];
    if (lastMsg) {
      const sseEvent: ChatbotNewMessageEvent = {
        sessionId,
        message: {
          id: lastMsg.id,
          role: lastMsg.role as 'bot' | 'user' | 'admin',
          content: lastMsg.content,
          createdAt: lastMsg.createdAt,
        },
      };
      this.eventEmitter.emit(CHATBOT_EVENTS.NEW_MESSAGE, sseEvent);
    }
  }

  // 메시지 저장
  async saveMessage(
    sessionId: string,
    data: {
      role: 'bot' | 'user' | 'admin';
      content: string;
      messageType?: 'text' | 'options' | 'form';
      options?: Array<{ value: string; label: string; sub?: string }>;
    },
  ) {
    const flow = await this.getFlow(sessionId);

    const message = await this.prisma.chatbotMessage.create({
      data: {
        sessionId,
        role: data.role,
        content: data.content,
        messageType: data.messageType || 'text',
        options: data.options || undefined,
      },
    });

    await this.processAfterMessageSave(sessionId, [message], flow);

    return message;
  }

  // 메시지 배치 저장
  async saveMessagesBatch(
    sessionId: string,
    messages: Array<{
      role: 'bot' | 'user' | 'admin';
      content: string;
      messageType?: 'text' | 'options' | 'form';
      options?: Array<{ value: string; label: string; sub?: string }>;
    }>,
  ) {
    const flow = await this.getFlow(sessionId);

    if (!messages || messages.length === 0) {
      return { count: 0, messages: [] };
    }

    const createdMessages = await this.prisma.$transaction(
      messages.map((msg) =>
        this.prisma.chatbotMessage.create({
          data: {
            sessionId,
            role: msg.role,
            content: msg.content,
            messageType: msg.messageType || 'text',
            options: msg.options || undefined,
          },
        }),
      ),
    );

    await this.processAfterMessageSave(sessionId, createdMessages, flow);

    return { count: createdMessages.length, messages: createdMessages };
  }

  // 메시지 목록 조회 (최근 500건)
  async getMessages(sessionId: string) {
    await this.validateSessionExists(sessionId);

    return this.prisma.chatbotMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
  }

  // 사용자의 세션 목록 조회
  async getUserSessions(userId: string) {
    const flows = await this.prisma.chatbotFlow.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: {
        sessionId: true,
        title: true,
        currentStep: true,
        isCompleted: true,
        estimateId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // 견적 ID가 있는 세션들의 견적 정보 조회 (상태 + shareHash)
    const estimateIds = flows
      .filter((f) => f.estimateId)
      .map((f) => f.estimateId as number);

    const estimates =
      estimateIds.length > 0
        ? await this.prisma.estimate.findMany({
            where: { id: { in: estimateIds } },
            select: { id: true, statusAi: true, shareHash: true },
          })
        : [];

    const estimateMap = new Map(
      estimates.map((e) => [
        e.id,
        { statusAi: e.statusAi, shareHash: e.shareHash },
      ]),
    );

    const sessions = flows.map((flow) => {
      const estimateInfo = flow.estimateId
        ? estimateMap.get(flow.estimateId)
        : null;
      // 견적 없이 완료된 세션은 pending (전문가 검토 대기)
      const estimateStatus = estimateInfo?.statusAi
        || (flow.isCompleted && !flow.estimateId ? ESTIMATE_STATUS.PENDING : null);
      return {
        sessionId: flow.sessionId,
        title: flow.title,
        currentStep: flow.currentStep,
        isCompleted: flow.isCompleted,
        estimateId: flow.estimateId,
        estimateStatus,
        estimateShareHash: estimateInfo?.shareHash || null,
        createdAt: flow.createdAt,
        updatedAt: flow.updatedAt,
      };
    });

    return { sessions };
  }

  // 세션을 사용자에게 연결
  async linkSessionToUser(sessionId: string, userId: string) {
    const flow = await this.getFlow(sessionId);

    // 이미 다른 사용자에게 연결된 세션인지 확인
    if (flow.userId && flow.userId !== userId) {
      this.logger.warn(`Session ${sessionId} already linked to another user`);
      // 이미 다른 사용자 세션이면 조용히 성공 반환 (보안상 에러 노출 안함)
      return { success: true, linked: false };
    }

    // 이미 같은 사용자에게 연결되어 있으면 스킵
    if (flow.userId === userId) {
      return { success: true, linked: false, message: 'Already linked' };
    }

    // 원자적 업데이트 — TOCTOU 레이스 방지 (userId가 null이거나 같은 사용자일 때만 연결)
    const atomicCheck = await this.prisma.chatbotFlow.updateMany({
      where: { sessionId, OR: [{ userId: null }, { userId }] },
      data: { userId },
    });
    if (atomicCheck.count === 0) {
      this.logger.warn(`Session ${sessionId} was linked to another user between read and write`);
      return { success: true, linked: false };
    }

    // 사용자 프로필 조회
    const userProfile = await this.supabaseService.getUserProfile(userId);

    // 비회원 정보와 로그인한 사용자 정보 비교
    const guestName = flow.customerName;
    const guestEmail = flow.customerEmail;
    const loggedInName = userProfile?.name || userProfile?.full_name;
    const loggedInEmail = userProfile?.email;

    const nameMismatch =
      guestName &&
      loggedInName &&
      guestName.toLowerCase() !== loggedInName.toLowerCase();
    const emailMismatch =
      guestEmail &&
      loggedInEmail &&
      guestEmail.toLowerCase() !== loggedInEmail.toLowerCase();
    const hasInfoMismatch = !!(nameMismatch || emailMismatch);

    // 세션을 사용자에게 연결 + 정보 불일치 기록
    await this.prisma.chatbotFlow.update({
      where: { sessionId },
      data: {
        userId,
        infoMismatch: hasInfoMismatch,
        // 불일치 시 게스트 원본 정보 보존 (나중에 어드민이 확인용)
        ...(hasInfoMismatch && guestName && { guestName }),
        ...(hasInfoMismatch && guestEmail && { guestEmail }),
        // 로그인 정보로 고객 정보 업데이트
        ...(loggedInName && { customerName: loggedInName }),
        ...(loggedInEmail && { customerEmail: loggedInEmail }),
      },
    });

    this.logger.log(
      `Session ${sessionId} linked to user ${userId}${hasInfoMismatch ? ' (info mismatch detected)' : ''}`,
    );

    // Estimate도 로그인 정보로 업데이트
    if (flow.estimateId && (loggedInName || loggedInEmail)) {
      await this.prisma.estimate.update({
        where: { id: flow.estimateId },
        data: {
          ...(loggedInName && { customerName: loggedInName }),
          ...(loggedInEmail && { customerEmail: loggedInEmail }),
        },
      });
      this.logger.log(
        `Estimate ${flow.estimateId} updated with logged-in user info`,
      );
    }

    if (nameMismatch || emailMismatch) {
      // 채팅 메시지로 시스템 알림 저장 (어드민이 볼 수 있도록)
      const mismatchDetails: string[] = [];
      if (nameMismatch) {
        mismatchDetails.push(`Name: "${guestName}" → "${loggedInName}"`);
      }
      if (emailMismatch) {
        mismatchDetails.push(`Email: "${guestEmail}" → "${loggedInEmail}"`);
      }

      const systemMessage = `🔔 User logged in with different info:\n${mismatchDetails.join('\n')}\n\nGuest info was provided during the initial inquiry. Please verify with the customer.`;

      // 시스템 메시지 저장 (봇 메시지로)
      await this.saveMessage(sessionId, {
        role: 'bot',
        content: systemMessage,
        messageType: 'text',
      });

      // 어드민에게 알림 생성
      try {
        await this.notificationService.notifyAdmins({
          type: 'user_info_mismatch',
          title: '사용자 정보 불일치',
          message: `${guestName || '고객'}님이 다른 정보로 로그인했습니다. ${mismatchDetails.join(', ')}`,
          relatedSessionId: sessionId,
          relatedEstimateId: flow.estimateId || undefined,
          metadata: {
            guestName,
            guestEmail,
            loggedInName,
            loggedInEmail,
          },
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Failed to send user mismatch notification: ${errorMessage}`,
        );
      }
    }

    return {
      success: true,
      linked: true,
      infoMismatch: nameMismatch || emailMismatch,
    };
  }

  // 세션 제목 업데이트
  async updateSessionTitle(
    sessionId: string,
    title: string,
    userId: string,
    userRole?: string,
  ) {
    const flow = await this.getFlow(sessionId);

    // 관리자가 아니면 소유자만 수정 가능
    const isAdmin = userRole === 'admin';
    if (!isAdmin && flow.userId && flow.userId !== userId) {
      throw new ForbiddenException(
        'You do not have permission to modify this session.',
      );
    }

    return this.prisma.chatbotFlow.update({
      where: { sessionId },
      data: { title },
    });
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

    // SSE 리소스 정리
    this.sseService.cleanupSession(sessionId);

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

    // SSE 리소스 정리
    for (const sid of sessionIds) {
      this.sseService.cleanupSession(sid);
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

  // ============ 관리자용: 견적 생성 ============

  // 챗봇 플로우에서 견적 생성 (관리자)
  async createEstimateFromFlow(sessionId: string, title?: string) {
    const flow = await this.getFlow(sessionId);

    // 이미 견적이 연결되어 있으면 에러
    if (flow.estimateId) {
      throw new BadRequestException(
        '이 세션에는 이미 견적이 연결되어 있습니다.',
      );
    }

    // 견적 제목 생성
    const estimateTitle =
      title ||
      (flow.customerName
        ? `${flow.customerName}님 견적`
        : `상담 #${flow.id} 견적`);

    // 여행 날짜 계산
    let startDate: Date | null = null;
    let endDate: Date | null = null;
    if (flow.travelDate) {
      startDate = new Date(flow.travelDate);
      if (flow.duration && flow.duration > 1) {
        endDate = new Date(flow.travelDate);
        endDate.setDate(endDate.getDate() + flow.duration - 1);
      } else {
        endDate = startDate;
      }
    }

    // 관심사 배열 병합
    const interests = [
      ...(flow.interestMain || []),
      ...(flow.interestSub || []),
    ];

    // 질문 응답 내역 전체를 requestContent로 구성
    const requestContentParts: string[] = [];

    // Step 1: 투어 타입
    if (flow.tourType) {
      const tourTypeLabels: Record<string, string> = {
        private: '프라이빗 투어',
        car_only: '차량만',
        group: '그룹 투어',
        custom: '커스텀 투어',
      };
      requestContentParts.push(
        `[투어 타입] ${tourTypeLabels[flow.tourType] || flow.tourType}`,
      );
    }

    // Step 2: 첫 방문 여부
    if (flow.isFirstVisit !== null) {
      requestContentParts.push(
        `[한국 첫 방문] ${flow.isFirstVisit ? '예' : '아니오'}`,
      );
    }

    // Step 3: 계획 유무
    if (flow.hasPlan !== null) {
      requestContentParts.push(
        `[계획 유무] ${flow.hasPlan ? '계획 있음' : '계획 없음'}`,
      );
      if (flow.hasPlan && flow.isFlexible !== null) {
        requestContentParts.push(
          `[계획 수정 가능] ${flow.isFlexible ? '수정 가능' : '수정 불가'}`,
        );
      }
      if (flow.hasPlan && flow.planDetails) {
        requestContentParts.push(`[계획 상세]\n${flow.planDetails}`);
      }
    }

    // Step 4: 관심사
    if (flow.interestMain?.length || flow.interestSub?.length) {
      const allInterests = [
        ...(flow.interestMain || []),
        ...(flow.interestSub || []),
      ];
      requestContentParts.push(`[관심사] ${allInterests.join(', ')}`);
    }

    // Step 5: 지역
    if (flow.region) {
      requestContentParts.push(`[지역] ${flow.region}`);
    }

    // Step 6: 폼 입력 정보
    requestContentParts.push(`\n--- 여행 정보 ---`);
    if (flow.travelDate) {
      requestContentParts.push(
        `[여행일] ${new Date(flow.travelDate).toLocaleDateString('ko-KR')}`,
      );
    }
    if (flow.duration) {
      requestContentParts.push(`[기간] ${flow.duration}일`);
    }

    const totalPax =
      (flow.adultsCount || 0) +
      (flow.childrenCount || 0) +
      (flow.infantsCount || 0) +
      (flow.seniorsCount || 0);
    requestContentParts.push(
      `[인원] 총 ${totalPax}명 (성인 ${flow.adultsCount || 0}, 아동 ${flow.childrenCount || 0}, 유아 ${flow.infantsCount || 0}, 시니어 ${flow.seniorsCount || 0})`,
    );

    if (flow.budgetRange) {
      requestContentParts.push(`[예산] ${flow.budgetRange}`);
    }
    if (flow.needsPickup !== null) {
      requestContentParts.push(
        `[공항 픽업] ${flow.needsPickup ? '필요' : '불필요'}`,
      );
    }

    // 추가 요청사항
    if (flow.additionalNotes) {
      requestContentParts.push(`\n[추가 요청사항]\n${flow.additionalNotes}`);
    }

    const requestContent = requestContentParts.join('\n');

    // 견적 생성
    const estimate = await this.estimateService.createEstimate({
      title: estimateTitle,
      source: 'ai',
      statusAi: 'draft',
      customerName: flow.customerName ?? undefined,
      customerEmail: flow.customerEmail ?? undefined,
      customerPhone: flow.customerPhone ?? undefined,
      nationality: flow.nationality ?? undefined,
      startDate: startDate?.toISOString() ?? undefined,
      endDate: endDate?.toISOString() ?? undefined,
      travelDays: flow.duration || 1,
      adultsCount: flow.adultsCount || 1,
      childrenCount: flow.childrenCount || 0,
      infantsCount: flow.infantsCount || 0,
      regions: flow.region ? [flow.region] : [],
      interests,
      items: [],
      subtotal: 0,
      totalAmount: 0,
      currency: 'USD',
      chatSessionId: sessionId,
      requestContent,
    });

    // 챗봇 플로우에 견적 ID 연결
    await this.prisma.chatbotFlow.update({
      where: { sessionId },
      data: { estimateId: estimate.id },
    });

    return {
      estimateId: estimate.id,
      shareHash: estimate.shareHash,
    };
  }
}
