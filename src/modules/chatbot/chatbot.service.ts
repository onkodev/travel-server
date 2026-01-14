import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EstimateService } from '../estimate/estimate.service';
import {
  TOUR_TYPES,
  INTEREST_MAIN,
  INTEREST_SUB,
  REGIONS,
  ATTRACTIONS,
  BUDGET_RANGES,
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
  UpdateStep5Dto,
  UpdateStep6Dto,
  UpdateStep7Dto,
} from './dto/update-step.dto';

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);

  constructor(
    private prisma: PrismaService,
    private estimateService: EstimateService,
  ) {}

  // 새 플로우 시작
  async startFlow(
    dto: StartFlowDto,
    ipAddress?: string,
    userAgent?: string,
    referer?: string,
    userId?: string,
  ) {
    const flow = await this.prisma.chatbotFlow.create({
      data: {
        ipAddress,
        userAgent,
        referrerUrl: referer,
        landingPage: dto.landingPage,
        utmSource: dto.utmSource,
        utmMedium: dto.utmMedium,
        utmCampaign: dto.utmCampaign,
        utmTerm: dto.utmTerm,
        utmContent: dto.utmContent,
        pageVisits: dto.landingPage
          ? [{ path: dto.landingPage, timestamp: new Date() }]
          : [],
        userId, // 로그인한 사용자면 연결
      },
    });

    return {
      sessionId: flow.sessionId,
      currentStep: flow.currentStep,
    };
  }

  // 플로우 조회
  async getFlow(sessionId: string) {
    const flow = await this.prisma.chatbotFlow.findUnique({
      where: { sessionId },
    });

    if (!flow) {
      throw new NotFoundException('플로우를 찾을 수 없습니다.');
    }

    return flow;
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
        return this.getStep1(flow);
      case 2:
        return this.getStep2(flow);
      case 3:
        return subStep === 'sub'
          ? this.getStep3Sub(flow)
          : this.getStep3Main(flow);
      case 4:
        return this.getStep4(flow);
      case 5:
        return this.getStep5(flow);
      case 6:
        return this.getStep6(flow);
      case 7:
        return this.getStep7(flow);
      default:
        throw new NotFoundException('유효하지 않은 단계입니다.');
    }
  }

  // Step 1: 투어 타입
  private getStep1(flow: { tourType: string | null }): StepResponseDto {
    return {
      step: 1,
      title: 'What kind of tour are you looking for?',
      titleKo: '어떤 투어를 찾고 계신가요?',
      type: 'single_select',
      required: true,
      options: Object.entries(TOUR_TYPES).map(([value, data]) => ({
        value,
        label: data.label,
        labelKo: data.labelKo,
      })),
      currentValue: flow.tourType,
    };
  }

  // Step 2: 첫 방문 여부
  private getStep2(flow: { isFirstVisit: boolean | null }): StepResponseDto {
    return {
      step: 2,
      title: 'Is this your first time visiting Korea?',
      titleKo: '한국 첫 방문이신가요?',
      type: 'boolean',
      required: true,
      options: [
        { value: 'true', label: 'Yes, first time!', labelKo: '네, 처음이에요!' },
        { value: 'false', label: 'No, I\'ve been before', labelKo: '아니요, 방문한 적 있어요' },
      ],
      currentValue: flow.isFirstVisit,
    };
  }

  // Step 3: 관심사 (메인)
  private getStep3Main(flow: { interestMain: string[] }): StepResponseDto {
    return {
      step: 3,
      subStep: 'main',
      title: 'What are you interested in?',
      titleKo: '어떤 것에 관심이 있으신가요?',
      type: 'multi_select',
      required: true,
      options: Object.entries(INTEREST_MAIN).map(([value, data]) => ({
        value,
        label: data.label,
        labelKo: data.labelKo,
      })),
      currentValue: flow.interestMain,
    };
  }

  // Step 3: 관심사 (서브)
  private getStep3Sub(flow: {
    interestMain: string[];
    interestSub: string[];
  }): StepResponseDto {
    // 선택된 메인 카테고리의 서브 카테고리만 표시
    const selectedMains = flow.interestMain || [];
    const subOptions = Object.entries(INTEREST_SUB)
      .filter(([, data]) => selectedMains.includes(data.main))
      .map(([value, data]) => ({
        value,
        label: data.label,
        labelKo: data.labelKo,
        main: data.main,
      }));

    return {
      step: 3,
      subStep: 'sub',
      title: 'What specifically interests you?',
      titleKo: '구체적으로 어떤 것에 관심이 있으신가요?',
      type: 'multi_select',
      required: true,
      options: subOptions,
      currentValue: flow.interestSub,
    };
  }

  // Step 4: 지역
  private getStep4(flow: { region: string | null }): StepResponseDto {
    return {
      step: 4,
      title: 'Which region would you like to visit?',
      titleKo: '어느 지역을 방문하고 싶으신가요?',
      type: 'single_select',
      required: false,
      options: Object.entries(REGIONS).map(([value, data]) => ({
        value,
        label: data.label,
        labelKo: data.labelKo,
      })),
      currentValue: flow.region,
    };
  }

  // Step 5: 명소
  private getStep5(flow: { attractions: string[] }): StepResponseDto {
    return {
      step: 5,
      title: 'Any specific places you want to visit?',
      titleKo: '방문하고 싶은 특정 장소가 있으신가요?',
      type: 'multi_select',
      required: false,
      options: Object.entries(ATTRACTIONS).map(([value, data]) => ({
        value,
        label: data.label,
        labelKo: data.labelKo,
      })),
      currentValue: flow.attractions,
    };
  }

  // Step 6: 여행 정보
  private getStep6(flow: {
    travelDate: Date | null;
    duration: number | null;
    adultsCount: number | null;
    childrenCount: number | null;
    infantsCount: number | null;
    seniorsCount: number | null;
    budgetRange: string | null;
    needsPickup: boolean | null;
  }): StepResponseDto {
    return {
      step: 6,
      title: 'Tell us about your trip',
      titleKo: '여행 정보를 알려주세요',
      type: 'form',
      required: true,
      fields: [
        {
          name: 'travelDate',
          type: 'date',
          label: 'Travel Date',
          labelKo: '여행 시작일',
          required: true,
        },
        {
          name: 'duration',
          type: 'number',
          label: 'Duration (days)',
          labelKo: '여행 일수',
          required: true,
        },
        {
          name: 'adultsCount',
          type: 'number',
          label: 'Adults (13+)',
          labelKo: '성인 (13세 이상)',
          default: 1,
        },
        {
          name: 'childrenCount',
          type: 'number',
          label: 'Children (3-12)',
          labelKo: '어린이 (3-12세)',
          default: 0,
        },
        {
          name: 'infantsCount',
          type: 'number',
          label: 'Infants (0-2)',
          labelKo: '유아 (0-2세)',
          default: 0,
        },
        {
          name: 'seniorsCount',
          type: 'number',
          label: 'Seniors (65+)',
          labelKo: '시니어 (65세 이상)',
          default: 0,
        },
        {
          name: 'budgetRange',
          type: 'select',
          label: 'Budget per person',
          labelKo: '1인당 예산',
          options: Object.entries(BUDGET_RANGES).map(([value, data]) => ({
            value,
            label: data.label,
          })),
        },
        {
          name: 'needsPickup',
          type: 'boolean',
          label: 'Airport pickup needed?',
          labelKo: '공항 픽업 필요?',
        },
      ],
      currentValue: {
        travelDate: flow.travelDate,
        duration: flow.duration,
        adultsCount: flow.adultsCount,
        childrenCount: flow.childrenCount,
        infantsCount: flow.infantsCount,
        seniorsCount: flow.seniorsCount,
        budgetRange: flow.budgetRange,
        needsPickup: flow.needsPickup,
      },
    };
  }

  // Step 7: 연락처 (로그인 필수)
  private getStep7(flow: {
    customerName: string | null;
    customerEmail: string | null;
    customerPhone: string | null;
    nationality: string | null;
    referralSource: string | null;
    additionalNotes: string | null;
  }): StepResponseDto {
    return {
      step: 7,
      title: 'Almost done! How can we reach you?',
      titleKo: '거의 다 됐어요! 연락처를 알려주세요',
      type: 'form',
      required: true,
      fields: [
        {
          name: 'customerName',
          type: 'text',
          label: 'Your Name',
          labelKo: '이름',
          required: true,
        },
        {
          name: 'customerEmail',
          type: 'email',
          label: 'Email',
          labelKo: '이메일',
          required: true,
        },
        {
          name: 'customerPhone',
          type: 'tel',
          label: 'Phone (optional)',
          labelKo: '전화번호 (선택)',
        },
        {
          name: 'nationality',
          type: 'text',
          label: 'Nationality',
          labelKo: '국적',
        },
        {
          name: 'referralSource',
          type: 'select',
          label: 'How did you find us?',
          labelKo: '어떻게 알게 되셨나요?',
          options: Object.entries(REFERRAL_SOURCES).map(([value, data]) => ({
            value,
            label: data.label,
            labelKo: data.labelKo,
          })),
        },
        {
          name: 'additionalNotes',
          type: 'textarea',
          label: 'Any special requests?',
          labelKo: '특별 요청사항',
        },
      ],
      currentValue: {
        customerName: flow.customerName,
        customerEmail: flow.customerEmail,
        customerPhone: flow.customerPhone,
        nationality: flow.nationality,
        referralSource: flow.referralSource,
        additionalNotes: flow.additionalNotes,
      },
    };
  }

  // Step 1 업데이트
  async updateStep1(sessionId: string, dto: UpdateStep1Dto) {
    const flow = await this.getFlow(sessionId);

    return this.prisma.chatbotFlow.update({
      where: { sessionId },
      data: {
        tourType: dto.tourType,
        currentStep: Math.max(flow.currentStep, 2),
      },
    });
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
    await this.getFlow(sessionId);

    return this.prisma.chatbotFlow.update({
      where: { sessionId },
      data: {
        interestMain: dto.interestMain,
        // 메인이 변경되면 서브도 초기화
        interestSub: [],
      },
    });
  }

  // Step 3 서브 업데이트
  async updateStep3Sub(sessionId: string, dto: UpdateStep3SubDto) {
    const flow = await this.getFlow(sessionId);

    return this.prisma.chatbotFlow.update({
      where: { sessionId },
      data: {
        interestSub: dto.interestSub,
        currentStep: Math.max(flow.currentStep, 4),
      },
    });
  }

  // Step 4 업데이트
  async updateStep4(sessionId: string, dto: UpdateStep4Dto) {
    const flow = await this.getFlow(sessionId);

    return this.prisma.chatbotFlow.update({
      where: { sessionId },
      data: {
        region: dto.region || 'seoul',
        currentStep: Math.max(flow.currentStep, 5),
      },
    });
  }

  // Step 5 업데이트
  async updateStep5(sessionId: string, dto: UpdateStep5Dto) {
    const flow = await this.getFlow(sessionId);

    // 기존 명소와 병합 (첫 방문 시 추가된 경복궁 유지)
    const existingAttractions = flow.attractions || [];
    const newAttractions = dto.attractions || [];
    const mergedAttractions = [
      ...new Set([...existingAttractions, ...newAttractions]),
    ];

    return this.prisma.chatbotFlow.update({
      where: { sessionId },
      data: {
        attractions: mergedAttractions,
        currentStep: Math.max(flow.currentStep, 6),
      },
    });
  }

  // Step 6 업데이트
  async updateStep6(sessionId: string, dto: UpdateStep6Dto) {
    const flow = await this.getFlow(sessionId);

    return this.prisma.chatbotFlow.update({
      where: { sessionId },
      data: {
        travelDate: new Date(dto.travelDate),
        duration: dto.duration,
        adultsCount: dto.adultsCount ?? 1,
        childrenCount: dto.childrenCount ?? 0,
        infantsCount: dto.infantsCount ?? 0,
        seniorsCount: dto.seniorsCount ?? 0,
        budgetRange: dto.budgetRange,
        needsPickup: dto.needsPickup,
        currentStep: Math.max(flow.currentStep, 7),
      },
    });
  }

  // Step 7 업데이트 (로그인 필수)
  async updateStep7(sessionId: string, dto: UpdateStep7Dto, userId: string) {
    await this.getFlow(sessionId);

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

    const visits = (flow.pageVisits as unknown as { path: string; timestamp: Date }[]) || [];
    visits.push({ path, timestamp: new Date() });

    return this.prisma.chatbotFlow.update({
      where: { sessionId },
      data: { pageVisits: visits as unknown as object },
    });
  }

  // 카테고리 목록 조회
  getCategories() {
    return {
      tourTypes: TOUR_TYPES,
      interestMain: INTEREST_MAIN,
      interestSub: INTEREST_SUB,
      regions: REGIONS,
      attractions: ATTRACTIONS,
      budgetRanges: BUDGET_RANGES,
      referralSources: REFERRAL_SOURCES,
    };
  }

  // 견본 견적 매칭 (archived 상태에서 조건에 맞는 것 찾기)
  private async findTemplateEstimate(params: {
    region: string | null;
    interests: string[];
    duration: number | null;
  }) {
    const { region, interests, duration } = params;
    const requestedDays = duration || 1;

    // region 매핑 (chatbot의 region 값 → estimate의 regions 값)
    const regionMap: Record<string, string> = {
      seoul: 'Seoul',
      busan: 'Busan',
      jeju: 'Jeju',
      gyeongju: 'Gyeongju',
      incheon: 'Incheon',
      gangwon: 'Gangwon',
      jeonju: 'Jeonju',
    };
    const mappedRegion = region ? regionMap[region] || region : null;

    // 1단계: 정확한 일수 + 지역 매칭
    if (mappedRegion) {
      const exactMatch = await this.prisma.estimate.findFirst({
        where: {
          statusManual: 'archived',
          travelDays: requestedDays,
          regions: { has: mappedRegion },
        },
        orderBy: { id: 'asc' },
      });
      if (exactMatch) return { template: exactMatch, needsTbd: false };
    }

    // 2단계: 정확한 일수만 매칭
    const daysMatch = await this.prisma.estimate.findFirst({
      where: {
        statusManual: 'archived',
        travelDays: requestedDays,
      },
      orderBy: { id: 'asc' },
    });
    if (daysMatch) return { template: daysMatch, needsTbd: false };

    // 3단계: 가장 가까운 일수 (작은 것 우선, TBD로 채움)
    const shorterMatch = await this.prisma.estimate.findFirst({
      where: {
        statusManual: 'archived',
        travelDays: { lt: requestedDays },
        ...(mappedRegion ? { regions: { has: mappedRegion } } : {}),
      },
      orderBy: { travelDays: 'desc' }, // 가장 긴 것 (요청일수에 가까운 것)
    });
    if (shorterMatch) {
      return {
        template: shorterMatch,
        needsTbd: true,
        tbdDays: requestedDays - (shorterMatch.travelDays || 1),
      };
    }

    // 4단계: 더 긴 견적에서 일부만 사용
    const longerMatch = await this.prisma.estimate.findFirst({
      where: {
        statusManual: 'archived',
        travelDays: { gt: requestedDays },
        ...(mappedRegion ? { regions: { has: mappedRegion } } : {}),
      },
      orderBy: { travelDays: 'asc' }, // 가장 짧은 것 (요청일수에 가까운 것)
    });
    if (longerMatch) return { template: longerMatch, needsTbd: false, truncate: true };

    // 5단계: 아무거나 (기본 서울 1일)
    const fallback = await this.prisma.estimate.findFirst({
      where: { statusManual: 'archived' },
      orderBy: { id: 'asc' },
    });
    return {
      template: fallback,
      needsTbd: requestedDays > (fallback?.travelDays || 1),
      tbdDays: requestedDays - (fallback?.travelDays || 1),
    };
  }

  // 견본 아이템 복제 + TBD 처리
  private prepareItemsFromTemplate(
    templateItems: any[],
    requestedDays: number,
    templateDays: number,
  ): any[] {
    if (!templateItems || templateItems.length === 0) {
      // 템플릿에 아이템이 없으면 TBD로만 채움
      return this.createTbdItems(1, requestedDays);
    }

    // 템플릿이 더 길면 필요한 일수만 가져옴
    if (templateDays > requestedDays) {
      return templateItems
        .filter((item) => item.dayNumber <= requestedDays)
        .map((item, idx) => ({
          ...item,
          id: `ai-${idx + 1}`,
        }));
    }

    // 템플릿 아이템 복제
    const items = templateItems.map((item, idx) => ({
      ...item,
      id: `ai-${idx + 1}`,
    }));

    // 템플릿이 더 짧으면 TBD 추가
    if (templateDays < requestedDays) {
      const tbdItems = this.createTbdItems(templateDays + 1, requestedDays);
      return [...items, ...tbdItems];
    }

    return items;
  }

  // TBD 아이템 생성
  private createTbdItems(startDay: number, endDay: number): any[] {
    const items: any[] = [];
    for (let day = startDay; day <= endDay; day++) {
      items.push({
        id: `tbd-${day}`,
        type: 'tbd',
        itemId: null,
        itemName: 'To Be Determined',
        quantity: 1,
        unitPrice: 0,
        subtotal: 0,
        dayNumber: day,
        orderIndex: 0,
        isTbd: true,
        note: '전문가가 일정을 구성해드립니다',
      });
    }
    return items;
  }

  // 플로우 완료 및 견적 생성
  async completeFlow(sessionId: string, userId: string) {
    this.logger.log(`Completing flow: sessionId=${sessionId}, userId=${userId}`);

    const flow = await this.getFlow(sessionId);

    // 이미 완료된 경우
    if (flow.isCompleted && flow.estimateId) {
      this.logger.log(`Flow already completed: sessionId=${sessionId}, estimateId=${flow.estimateId}`);
      const estimate = await this.estimateService.getEstimate(flow.estimateId);
      return { flow, estimate };
    }

    // 필수 정보 검증
    if (!flow.customerName || !flow.customerEmail) {
      this.logger.warn(`Missing customer info: sessionId=${sessionId}`);
      throw new BadRequestException(
        'Step 7을 먼저 완료해주세요. 고객 정보가 필요합니다.',
      );
    }

    // 견본 견적 찾기
    const { template } = await this.findTemplateEstimate({
      region: flow.region,
      interests: flow.interestSub || [],
      duration: flow.duration,
    });

    // 아이템 준비 (템플릿 복제 + TBD 처리)
    const requestedDays = flow.duration || 1;
    const templateItems = (template?.items as any[]) || [];
    const templateDays = template?.travelDays || 1;
    const items = this.prepareItemsFromTemplate(
      templateItems,
      requestedDays,
      templateDays,
    );

    // 여행 종료일 계산
    const endDate =
      flow.travelDate && flow.duration
        ? new Date(
            flow.travelDate.getTime() + (flow.duration - 1) * 24 * 60 * 60 * 1000,
          )
        : null;

    // 견적 제목 생성
    const tourTypeLabel = flow.tourType
      ? TOUR_TYPES[flow.tourType as keyof typeof TOUR_TYPES]?.label || 'Tour'
      : 'Tour';
    const title = `${flow.customerName}'s ${flow.region || 'Korea'} ${tourTypeLabel}`;

    // 초기 견적 생성 (견본에서 복제)
    // undefined 값은 제외하고 정의된 값만 포함
    const estimateData: Record<string, unknown> = {
      title,
      source: 'ai',
      statusAi: 'draft',
      customerName: flow.customerName || '',
      customerEmail: flow.customerEmail || '',
      travelDays: flow.duration || 1,
      adultsCount: flow.adultsCount || 1,
      childrenCount: flow.childrenCount || 0,
      infantsCount: flow.infantsCount || 0,
      interests: flow.interestSub || [],
      regions: flow.region ? [flow.region] : ['seoul'],
      userId,
      items,
    };

    // 선택적 필드는 값이 있을 때만 추가
    if (flow.nationality) estimateData.nationality = flow.nationality;
    if (flow.travelDate) estimateData.startDate = flow.travelDate; // Date 객체 직접 전달
    if (endDate) estimateData.endDate = endDate; // Date 객체 직접 전달
    if (flow.tourType) estimateData.tourType = flow.tourType;
    if (flow.budgetRange) estimateData.priceRange = flow.budgetRange;
    if (flow.additionalNotes) estimateData.requestContent = flow.additionalNotes;

    // 견적 유효기간 설정 (30일)
    const validDate = new Date();
    validDate.setDate(validDate.getDate() + 30);
    estimateData.validDate = validDate;

    // 트랜잭션으로 견적 생성 + 플로우 업데이트 처리
    try {
      const estimate = await this.estimateService.createEstimate(estimateData as any);

      // Flow 업데이트
      const updatedFlow = await this.prisma.chatbotFlow.update({
        where: { sessionId },
        data: {
          isCompleted: true,
          estimateId: estimate.id,
          userId,
        },
      });

      this.logger.log(`Flow completed successfully: sessionId=${sessionId}, estimateId=${estimate.id}`);

      return {
        flow: updatedFlow,
        estimate,
        templateUsed: template?.title || null,
        hasTbdDays: items.some((item) => item.isTbd),
      };
    } catch (error) {
      this.logger.error(`Failed to complete flow: sessionId=${sessionId}`, error.stack);
      throw error;
    }
  }

  // 전문가에게 보내기
  async sendToExpert(sessionId: string) {
    const flow = await this.getFlow(sessionId);

    if (!flow.estimateId) {
      throw new BadRequestException(
        '먼저 견적을 생성해주세요. (completeFlow 호출 필요)',
      );
    }

    // 견적 상태를 검토 대기로 변경
    const estimate = await this.estimateService.updateAIStatus(
      flow.estimateId,
      'pending',
    );

    return {
      success: true,
      message: '전문가에게 전달되었습니다.',
      estimateId: flow.estimateId,
      status: estimate.statusAi,
    };
  }

  // 고객 응답 (승인/거절)
  async respondToEstimate(
    sessionId: string,
    response: 'accepted' | 'declined',
    modificationRequest?: string,
  ) {
    const flow = await this.getFlow(sessionId);

    if (!flow.estimateId) {
      throw new BadRequestException('견적이 없습니다.');
    }

    // 견적 상태 업데이트
    const estimate = await this.estimateService.updateAIStatus(
      flow.estimateId,
      response,
    );

    // 수정 요청이 있으면 견적의 requestContent에 추가
    if (modificationRequest) {
      await this.prisma.estimate.update({
        where: { id: flow.estimateId },
        data: {
          requestContent: modificationRequest,
          // 수정 요청이 있으면 다시 검토 대기로
          statusAi: 'pending',
        },
      });
    }

    return {
      success: true,
      message:
        response === 'accepted'
          ? '견적이 승인되었습니다. 곧 연락드리겠습니다.'
          : modificationRequest
          ? '수정 요청이 전달되었습니다. 전문가가 검토 후 연락드리겠습니다.'
          : '견적이 거절되었습니다.',
      status: modificationRequest ? 'pending' : estimate.statusAi,
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
  }) {
    const {
      page = 1,
      limit = 20,
      isCompleted,
      startDate,
      endDate,
      utmSource,
    } = params;
    const skip = (page - 1) * limit;

    const where: {
      isCompleted?: boolean;
      createdAt?: { gte?: Date; lte?: Date };
      utmSource?: string;
    } = {};

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
      where.utmSource = utmSource;
    }

    const [flows, total] = await Promise.all([
      this.prisma.chatbotFlow.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.chatbotFlow.count({ where }),
    ]);

    return {
      data: flows,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // 관리자용: 플로우 통계
  async getFlowStats() {
    const [
      total,
      completed,
      byTourType,
      byUtmSource,
      byStep,
    ] = await Promise.all([
      this.prisma.chatbotFlow.count(),
      this.prisma.chatbotFlow.count({ where: { isCompleted: true } }),
      this.prisma.chatbotFlow.groupBy({
        by: ['tourType'],
        _count: true,
        where: { tourType: { not: null } },
      }),
      this.prisma.chatbotFlow.groupBy({
        by: ['utmSource'],
        _count: true,
        where: { utmSource: { not: null } },
      }),
      this.prisma.chatbotFlow.groupBy({
        by: ['currentStep'],
        _count: true,
      }),
    ]);

    const conversionRate = total > 0 ? ((completed / total) * 100).toFixed(1) : '0';

    return {
      total,
      completed,
      conversionRate: `${conversionRate}%`,
      byTourType: byTourType.map((item) => ({
        tourType: item.tourType,
        count: item._count,
      })),
      byUtmSource: byUtmSource.map((item) => ({
        utmSource: item.utmSource,
        count: item._count,
      })),
      byStep: byStep.map((item) => ({
        step: item.currentStep,
        count: item._count,
      })),
    };
  }

  // ============ 메시지 관련 API ============

  // 메시지 저장
  async saveMessage(
    sessionId: string,
    data: {
      role: 'bot' | 'user';
      content: string;
      messageType?: 'text' | 'options' | 'form';
      options?: Array<{ value: string; label: string; sub?: string }>;
    },
  ) {
    // 세션 존재 확인
    await this.getFlow(sessionId);

    const message = await this.prisma.chatbotMessage.create({
      data: {
        sessionId,
        role: data.role,
        content: data.content,
        messageType: data.messageType || 'text',
        options: data.options || undefined,
      },
    });

    // 첫 번째 사용자 메시지로 세션 제목 자동 설정
    if (data.role === 'user') {
      const existingMessages = await this.prisma.chatbotMessage.count({
        where: { sessionId, role: 'user' },
      });

      if (existingMessages === 1) {
        // 첫 번째 사용자 메시지
        const title = data.content.slice(0, 50) + (data.content.length > 50 ? '...' : '');
        await this.prisma.chatbotFlow.update({
          where: { sessionId },
          data: { title },
        });
      }
    }

    return message;
  }

  // 메시지 목록 조회
  async getMessages(sessionId: string) {
    // 세션 존재 확인
    await this.getFlow(sessionId);

    return this.prisma.chatbotMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
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

    // 견적 ID가 있는 세션들의 견적 상태 조회
    const estimateIds = flows
      .filter((f) => f.estimateId)
      .map((f) => f.estimateId as number);

    const estimates =
      estimateIds.length > 0
        ? await this.prisma.estimate.findMany({
            where: { id: { in: estimateIds } },
            select: { id: true, statusAi: true },
          })
        : [];

    const estimateStatusMap = new Map(
      estimates.map((e) => [e.id, e.statusAi]),
    );

    const sessions = flows.map((flow) => ({
      sessionId: flow.sessionId,
      title: flow.title,
      currentStep: flow.currentStep,
      isCompleted: flow.isCompleted,
      estimateStatus: flow.estimateId
        ? estimateStatusMap.get(flow.estimateId) || null
        : null,
      createdAt: flow.createdAt,
      updatedAt: flow.updatedAt,
    }));

    return { sessions };
  }

  // 세션 제목 업데이트
  async updateSessionTitle(sessionId: string, title: string, userId?: string) {
    const flow = await this.getFlow(sessionId);

    // 사용자 권한 확인 (userId가 제공된 경우)
    if (userId && flow.userId && flow.userId !== userId) {
      throw new ForbiddenException('이 세션을 수정할 권한이 없습니다.');
    }

    return this.prisma.chatbotFlow.update({
      where: { sessionId },
      data: { title },
    });
  }

  // 세션 삭제
  async deleteSession(sessionId: string, userId?: string) {
    const flow = await this.getFlow(sessionId);

    // 사용자 권한 확인 (userId가 제공된 경우)
    if (userId && flow.userId && flow.userId !== userId) {
      throw new ForbiddenException('이 세션을 삭제할 권한이 없습니다.');
    }

    // ChatbotMessage는 onDelete: Cascade로 자동 삭제됨
    await this.prisma.chatbotFlow.delete({
      where: { sessionId },
    });

    return { success: true };
  }
}
