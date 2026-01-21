import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';

// UUID 형식 검증 헬퍼
const isValidUUID = (str: string): boolean => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
};
import { PrismaService } from '../../prisma/prisma.service';
import { EstimateService } from '../estimate/estimate.service';
import { GeoIpService } from '../visitor/geoip.service';
import { AiEstimateService } from './ai-estimate.service';
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
    private estimateService: EstimateService,
    @Inject(forwardRef(() => GeoIpService))
    private geoIpService: GeoIpService,
    @Inject(forwardRef(() => AiEstimateService))
    private aiEstimateService: AiEstimateService,
  ) {}

  // 새 플로우 시작
  async startFlow(
    dto: StartFlowDto,
    ipAddress?: string,
    userAgent?: string,
    referer?: string,
    userId?: string,
  ) {
    // tourType이 제공되면 Step 1 완료 상태로 생성 (currentStep = 2)
    const hasTourType = !!dto.tourType;

    // IP 기반 지리 정보 조회
    let geoData: { country: string | null; countryName: string | null; city: string | null; timezone: string | null } = {
      country: null,
      countryName: null,
      city: null,
      timezone: null,
    };

    if (ipAddress) {
      try {
        geoData = await this.geoIpService.lookup(ipAddress);
      } catch (error) {
        this.logger.warn(`GeoIP lookup failed for ${ipAddress}: ${error.message}`);
      }
    }

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
        // IP 지리 정보
        country: geoData.country,
        countryName: geoData.countryName,
        city: geoData.city,
        timezone: geoData.timezone,
        // visitorId 연결 (클라이언트에서 제공하는 경우)
        visitorId: dto.visitorId,
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

    const flow = await this.prisma.chatbotFlow.findUnique({
      where: { sessionId },
    });

    if (!flow) {
      throw new NotFoundException('Flow not found.');
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
        return this.getStep5(flow); // flow에 region 포함
      case 6:
        return this.getStep6(flow); // 인적사항 + 여행정보 통합
      case 7:
        return this.getStep7(flow); // 레거시 지원 (필요시)
      default:
        throw new NotFoundException('Invalid step.');
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
        description: data.description,
        descriptionKo: data.descriptionKo,
        status: data.status, // 'available' | 'coming_soon'
        redirectUrl: data.redirectUrl, // 외부 링크 or null (챗봇 계속)
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
      required: true,
      options: Object.entries(REGIONS).map(([value, data]) => ({
        value,
        label: data.label,
        labelKo: data.labelKo,
        status: data.status, // 'available' | 'coming_soon'
      })),
      currentValue: flow.region,
    };
  }

  // Step 5: Attractions (filtered by selected region)
  private getStep5(flow: { region: string | null; attractions: string[] }): StepResponseDto {
    const selectedRegion = flow.region;
    const filteredAttractions = Object.entries(ATTRACTIONS).filter(([, data]) => {
      // No region selected: show all attractions
      if (!selectedRegion) {
        return true;
      }
      // Seoul: include Seoul + day trip destinations (Gyeonggi, Gangwon)
      if (selectedRegion === 'seoul') {
        return data.region === 'seoul' || data.category === 'day_trip';
      }
      return data.region === selectedRegion;
    });

    return {
      step: 5,
      title: 'Any specific places you want to visit?',
      titleKo: '방문하고 싶은 특정 장소가 있으신가요?',
      type: 'multi_select',
      required: false,
      options: filteredAttractions.map(([value, data]) => ({
        value,
        label: data.label,
        labelKo: data.labelKo,
        category: data.category, // palace, traditional, landmark, shopping, trendy, day_trip, market, nature
        region: data.region,
      })),
      currentValue: flow.attractions,
    };
  }

  // Step 6: 인적사항 + 여행 정보 (통합)
  private getStep6(flow: {
    // 인적사항
    customerName: string | null;
    customerEmail: string | null;
    customerPhone: string | null;
    nationality: string | null;
    // 여행 정보
    travelDate: Date | null;
    duration: number | null;
    adultsCount: number | null;
    childrenCount: number | null;
    infantsCount: number | null;
    seniorsCount: number | null;
    ageRange: string | null;
    budgetRange: string | null;
    needsPickup: boolean | null;
    additionalNotes: string | null;
  }): StepResponseDto {
    return {
      step: 6,
      title: 'Tell us about yourself and your trip',
      titleKo: '고객님과 여행 정보를 알려주세요',
      type: 'form',
      required: true,
      fields: [
        // 인적사항 섹션
        {
          name: 'customerName',
          type: 'text',
          label: 'Your Name',
          labelKo: '이름',
          required: true,
          section: 'personal',
        },
        {
          name: 'customerEmail',
          type: 'email',
          label: 'Email',
          labelKo: '이메일',
          required: true,
          section: 'personal',
        },
        {
          name: 'customerPhone',
          type: 'tel',
          label: 'Phone',
          labelKo: '전화번호',
          section: 'personal',
        },
        {
          name: 'nationality',
          type: 'text',
          label: 'Nationality',
          labelKo: '국적',
          section: 'personal',
        },
        // 여행 정보 섹션
        {
          name: 'travelDate',
          type: 'date',
          label: 'Travel Date',
          labelKo: '여행 시작일',
          required: true,
          section: 'travel',
        },
        {
          name: 'duration',
          type: 'number',
          label: 'Duration (days)',
          labelKo: '여행 일수',
          required: true,
          section: 'travel',
        },
        // 인원 정보 섹션
        {
          name: 'adultsCount',
          type: 'number',
          label: 'Adults (13-64)',
          labelKo: '성인 (13-64세)',
          default: 1,
          section: 'group',
        },
        {
          name: 'childrenCount',
          type: 'number',
          label: 'Children (3-12)',
          labelKo: '어린이 (3-12세)',
          default: 0,
          section: 'group',
        },
        {
          name: 'infantsCount',
          type: 'number',
          label: 'Infants (0-2)',
          labelKo: '유아 (0-2세)',
          default: 0,
          section: 'group',
        },
        {
          name: 'seniorsCount',
          type: 'number',
          label: 'Seniors (65+)',
          labelKo: '시니어 (65세 이상)',
          default: 0,
          section: 'group',
        },
        {
          name: 'ageRange',
          type: 'select',
          label: 'Primary Age Group',
          labelKo: '주요 연령대',
          section: 'group',
          options: Object.entries(AGE_RANGES).map(([value, data]) => ({
            value,
            label: data.label,
            labelKo: data.labelKo,
          })),
        },
        // 예산 및 기타 섹션
        {
          name: 'budgetRange',
          type: 'select',
          label: 'Budget per person',
          labelKo: '1인당 예산',
          section: 'budget',
          options: Object.entries(BUDGET_RANGES).map(([value, data]) => ({
            value,
            label: data.label,
            labelKo: data.labelKo,
          })),
        },
        {
          name: 'needsPickup',
          type: 'boolean',
          label: 'Airport pickup needed?',
          labelKo: '공항 픽업 필요?',
          section: 'budget',
        },
        // 추가 요청사항
        {
          name: 'additionalNotes',
          type: 'textarea',
          label: 'Any special requests? (e.g., wheelchair, allergies)',
          labelKo: '추가 요청사항 (예: 휠체어, 알레르기)',
          section: 'notes',
        },
      ],
      currentValue: {
        customerName: flow.customerName,
        customerEmail: flow.customerEmail,
        customerPhone: flow.customerPhone,
        nationality: flow.nationality,
        travelDate: flow.travelDate,
        duration: flow.duration,
        adultsCount: flow.adultsCount,
        childrenCount: flow.childrenCount,
        infantsCount: flow.infantsCount,
        seniorsCount: flow.seniorsCount,
        ageRange: flow.ageRange,
        budgetRange: flow.budgetRange,
        needsPickup: flow.needsPickup,
        additionalNotes: flow.additionalNotes,
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
    const invalidSubs = dto.interestSub.filter((sub) => {
      const subData = INTEREST_SUB[sub as keyof typeof INTEREST_SUB];
      return !subData || !selectedMains.includes(subData.main);
    });

    if (invalidSubs.length > 0) {
      throw new BadRequestException(
        `Invalid sub-interests for selected main categories: ${invalidSubs.join(', ')}`,
      );
    }

    return this.updateFlowStep(sessionId, 4, { interestSub: dto.interestSub });
  }

  // Step 4 업데이트
  async updateStep4(sessionId: string, dto: UpdateStep4Dto) {
    return this.updateFlowStep(sessionId, 5, { region: dto.region });
  }

  // Plan 업데이트 (계획유무 - 클라이언트 Step 3)
  async updatePlan(sessionId: string, dto: UpdatePlanDto) {
    await this.validateSessionExists(sessionId);
    return this.prisma.chatbotFlow.update({
      where: { sessionId },
      data: {
        hasPlan: dto.hasPlan,
        planDetails: dto.planDetails || null,
        isFlexible: dto.isFlexible,
        // currentStep은 변경하지 않음 - 클라이언트가 flow 데이터로 step 계산
      },
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

    // 여행 날짜가 오늘 이후인지 검증
    const travelDate = new Date(dto.travelDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (travelDate < today) {
      throw new BadRequestException('Travel date must be today or in the future.');
    }

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

    const visits = (flow.pageVisits as unknown as { path: string; timestamp: Date }[]) || [];
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
        const images = dbItem?.images as
          | Array<string | { url: string; type?: string }>
          | null;

        // images 배열에서 첫 번째 이미지 URL 추출
        let firstImageUrl: string | null = null;
        if (images && images.length > 0) {
          const firstImage = images[0];
          if (typeof firstImage === 'string') {
            firstImageUrl = firstImage;
          } else if (firstImage && typeof firstImage === 'object' && 'url' in firstImage) {
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

  // 챗봇 설문 응답 요약 생성
  private buildSurveySummary(flow: {
    tourType: string | null;
    isFirstVisit: boolean | null;
    interestMain: string[];
    interestSub: string[];
    region: string | null;
    attractions: string[];
    travelDate: Date | null;
    duration: number | null;
    adultsCount: number | null;
    childrenCount: number | null;
    infantsCount: number | null;
    seniorsCount: number | null;
    budgetRange: string | null;
    needsPickup: boolean | null;
    nationality: string | null;
    additionalNotes: string | null;
  }): string {
    const lines: string[] = ['[Chatbot Survey Summary]', ''];

    // Tour Type
    if (flow.tourType) {
      const tourTypeLabel = TOUR_TYPES[flow.tourType as keyof typeof TOUR_TYPES]?.label || flow.tourType;
      lines.push(`• Tour Type: ${tourTypeLabel}`);
    }

    // First Visit
    if (flow.isFirstVisit !== null) {
      lines.push(`• First Visit to Korea: ${flow.isFirstVisit ? 'Yes' : 'No'}`);
    }

    // Interests
    if (flow.interestMain.length > 0) {
      const mainLabels = flow.interestMain.map(
        (val) => INTEREST_MAIN[val as keyof typeof INTEREST_MAIN]?.label || val,
      );
      lines.push(`• Main Interests: ${mainLabels.join(', ')}`);
    }

    if (flow.interestSub.length > 0) {
      const subLabels = flow.interestSub.map(
        (val) => INTEREST_SUB[val as keyof typeof INTEREST_SUB]?.label || val,
      );
      lines.push(`• Specific Interests: ${subLabels.join(', ')}`);
    }

    // Region
    if (flow.region) {
      const regionLabel = REGIONS[flow.region as keyof typeof REGIONS]?.label || flow.region;
      lines.push(`• Region: ${regionLabel}`);
    }

    // Attractions
    if (flow.attractions.length > 0) {
      const attractionLabels = flow.attractions.map(
        (val) => ATTRACTIONS[val as keyof typeof ATTRACTIONS]?.label || val,
      );
      lines.push(`• Must-see Places: ${attractionLabels.join(', ')}`);
    }

    // Travel Details
    lines.push('');
    lines.push('[Travel Details]');

    if (flow.travelDate) {
      lines.push(`• Travel Date: ${flow.travelDate.toISOString().split('T')[0]}`);
    }

    if (flow.duration) {
      lines.push(`• Duration: ${flow.duration} day(s)`);
    }

    // Group Size
    const travelers: string[] = [];
    if (flow.adultsCount) travelers.push(`${flow.adultsCount} Adult(s)`);
    if (flow.childrenCount) travelers.push(`${flow.childrenCount} Child(ren)`);
    if (flow.infantsCount) travelers.push(`${flow.infantsCount} Infant(s)`);
    if (flow.seniorsCount) travelers.push(`${flow.seniorsCount} Senior(s)`);
    if (travelers.length > 0) {
      lines.push(`• Group: ${travelers.join(', ')}`);
    }

    // Budget
    if (flow.budgetRange) {
      const budgetLabel = BUDGET_RANGES[flow.budgetRange as keyof typeof BUDGET_RANGES]?.label || flow.budgetRange;
      lines.push(`• Budget: ${budgetLabel}`);
    }

    // Pickup
    if (flow.needsPickup !== null) {
      lines.push(`• Airport Pickup: ${flow.needsPickup ? 'Yes' : 'No'}`);
    }

    // Nationality
    if (flow.nationality) {
      lines.push(`• Nationality: ${flow.nationality}`);
    }

    // Additional Notes
    if (flow.additionalNotes) {
      lines.push('');
      lines.push('[Additional Notes]');
      lines.push(flow.additionalNotes);
    }

    return lines.join('\n');
  }

  // 플로우 완료 및 견적 생성 (AI 기반)
  async completeFlow(sessionId: string, userId: string) {
    this.logger.log(`Completing flow: sessionId=${sessionId}, userId=${userId}`);

    const flow = await this.getFlow(sessionId);

    // 이미 완료된 경우
    if (flow.isCompleted && flow.estimateId) {
      this.logger.log(`Flow already completed: sessionId=${sessionId}, estimateId=${flow.estimateId}`);
      const estimate = await this.estimateService.getEstimate(flow.estimateId);
      const items = Array.isArray(estimate.items) ? estimate.items : [];
      return {
        flow,
        estimate,
        templateUsed: null,
        hasTbdDays: items.some((item: any) => item.isTbd),
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
      // AiEstimateService를 사용하여 AI 기반 견적 생성
      const { estimateId } = await this.aiEstimateService.generateFirstEstimate(sessionId);

      // 업데이트된 플로우 조회
      const updatedFlow = await this.getFlow(sessionId);

      // Flow에 userId 연결 (아직 없는 경우)
      if (!updatedFlow.userId) {
        await this.prisma.chatbotFlow.update({
          where: { sessionId },
          data: { userId },
        });
      }

      // 견적 아이템 정보 보강
      const enrichedEstimate = await this.estimateService.getEstimate(estimateId);
      const items = Array.isArray(enrichedEstimate.items) ? enrichedEstimate.items : [];

      this.logger.log(`Flow completed successfully: sessionId=${sessionId}, estimateId=${estimateId}`);

      return {
        flow: updatedFlow,
        estimate: enrichedEstimate,
        templateUsed: null,
        hasTbdDays: items.some((item: any) => item.isTbd),
      };
    } catch (error) {
      this.logger.error(`Failed to complete flow: sessionId=${sessionId}`, error.stack);
      throw error;
    }
  }

  // 전문가에게 보내기 (견적 없이도 상담 요청 전송 가능)
  async sendToExpert(sessionId: string) {
    const flow = await this.getFlow(sessionId);

    // 플로우를 완료 상태로 변경 (견적 유무와 관계없이)
    await this.prisma.chatbotFlow.update({
      where: { sessionId },
      data: { isCompleted: true },
    });

    // 견적이 있으면 상태 업데이트
    if (flow.estimateId) {
      const estimate = await this.estimateService.updateAIStatus(
        flow.estimateId,
        'pending',
      );
      return {
        success: true,
        message: 'Sent to expert for review.',
        estimateId: flow.estimateId,
        status: estimate.statusAi,
      };
    }

    // 견적 없이 상담 요청만 전송
    return {
      success: true,
      message: 'Inquiry submitted. Our expert will contact you soon.',
      estimateId: null,
      status: 'pending',
    };
  }

  // 고객 응답 (승인/수정요청)
  async respondToEstimate(
    sessionId: string,
    response: 'accepted' | 'declined', // 클라이언트 호환성을 위해 유지
    modificationRequest?: string,
  ) {
    const flow = await this.getFlow(sessionId);

    if (!flow.estimateId) {
      throw new BadRequestException('Estimate not found.');
    }

    // 수정 요청이 있으면 다시 pending으로
    if (modificationRequest) {
      const currentEstimate = await this.prisma.estimate.findUnique({
        where: { id: flow.estimateId },
        select: { requestContent: true },
      });
      const existingContent = currentEstimate?.requestContent || '';
      const updatedContent = existingContent
        ? `${existingContent}\n\n--- Modification Request ---\n${modificationRequest}`
        : modificationRequest;

      await this.prisma.estimate.update({
        where: { id: flow.estimateId },
        data: {
          requestContent: updatedContent,
          statusAi: 'pending', // 수정 요청 → 다시 대기
        },
      });

      return {
        success: true,
        message: 'Modification request submitted. Our expert will review and contact you.',
        status: 'pending',
      };
    }

    // 승인인 경우 accepted로
    const estimate = await this.estimateService.updateAIStatus(
      flow.estimateId,
      'accepted',
    );

    return {
      success: true,
      message: 'Estimate accepted. We will contact you soon.',
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
        // 목록 조회 시 큰 필드 제외 (pageVisits, userAgent)
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
          ipAddress: true,
          // IP 지리 정보
          country: true,
          countryName: true,
          city: true,
          // 추적 정보
          utmSource: true,
          referrerUrl: true,
          landingPage: true,
          isCompleted: true,
          estimateId: true,
          createdAt: true,
        },
      }),
      this.prisma.chatbotFlow.count({ where }),
    ]);

    // estimateId가 있는 플로우들의 견적 상태 조회
    const estimateIds = flows
      .filter((f) => f.estimateId)
      .map((f) => f.estimateId!);

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

    // 플로우에 estimateStatus 추가
    const flowsWithStatus = flows.map((flow) => ({
      ...flow,
      estimateStatus: flow.estimateId
        ? estimateStatusMap.get(flow.estimateId) || null
        : null,
    }));

    return {
      data: flowsWithStatus,
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

  // 관리자용: 퍼널 분석
  async getFunnelAnalysis(days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // 각 단계별 도달 수 (해당 단계 이상까지 진행한 사용자 수)
    const [
      step1, // 시작 (모든 플로우)
      step2, // 투어 타입 선택 완료
      step3, // 첫 방문 여부 응답
      step4, // 관심사 선택 완료
      step5, // 지역 선택 완료
      step6, // 명소 선택 완료
      step7, // 여행 정보 입력 완료
      completed, // 견적 생성 완료
      estimateSent, // 전문가에게 발송
      estimateAccepted, // 고객 수락
    ] = await Promise.all([
      this.prisma.chatbotFlow.count({ where: { createdAt: { gte: startDate } } }),
      this.prisma.chatbotFlow.count({ where: { createdAt: { gte: startDate }, currentStep: { gte: 2 } } }),
      this.prisma.chatbotFlow.count({ where: { createdAt: { gte: startDate }, currentStep: { gte: 3 } } }),
      this.prisma.chatbotFlow.count({ where: { createdAt: { gte: startDate }, currentStep: { gte: 4 } } }),
      this.prisma.chatbotFlow.count({ where: { createdAt: { gte: startDate }, currentStep: { gte: 5 } } }),
      this.prisma.chatbotFlow.count({ where: { createdAt: { gte: startDate }, currentStep: { gte: 6 } } }),
      this.prisma.chatbotFlow.count({ where: { createdAt: { gte: startDate }, currentStep: { gte: 7 } } }),
      this.prisma.chatbotFlow.count({ where: { createdAt: { gte: startDate }, isCompleted: true } }),
      this.prisma.estimate.count({
        where: {
          createdAt: { gte: startDate },
          statusAi: { in: ['sent', 'accepted'] }
        }
      }),
      this.prisma.estimate.count({
        where: {
          createdAt: { gte: startDate },
          statusAi: 'accepted'
        }
      }),
    ]);

    const funnel = [
      { step: 1, name: '챗봇 시작', count: step1, rate: 100 },
      { step: 2, name: '투어 타입 선택', count: step2, rate: step1 > 0 ? Math.round((step2 / step1) * 100) : 0 },
      { step: 3, name: '첫 방문 여부', count: step3, rate: step1 > 0 ? Math.round((step3 / step1) * 100) : 0 },
      { step: 4, name: '관심사 선택', count: step4, rate: step1 > 0 ? Math.round((step4 / step1) * 100) : 0 },
      { step: 5, name: '지역 선택', count: step5, rate: step1 > 0 ? Math.round((step5 / step1) * 100) : 0 },
      { step: 6, name: '명소 선택', count: step6, rate: step1 > 0 ? Math.round((step6 / step1) * 100) : 0 },
      { step: 7, name: '여행 정보 입력', count: step7, rate: step1 > 0 ? Math.round((step7 / step1) * 100) : 0 },
      { step: 8, name: '견적 생성', count: completed, rate: step1 > 0 ? Math.round((completed / step1) * 100) : 0 },
      { step: 9, name: '전문가 발송', count: estimateSent, rate: step1 > 0 ? Math.round((estimateSent / step1) * 100) : 0 },
      { step: 10, name: '고객 수락', count: estimateAccepted, rate: step1 > 0 ? Math.round((estimateAccepted / step1) * 100) : 0 },
    ];

    // 이탈률 계산 (다음 단계로 넘어가지 않은 비율)
    const dropoff = funnel.slice(0, -1).map((item, idx) => {
      const nextCount = funnel[idx + 1].count;
      const dropoffCount = item.count - nextCount;
      const dropoffRate = item.count > 0 ? Math.round((dropoffCount / item.count) * 100) : 0;
      return {
        step: item.step,
        name: item.name,
        dropoffCount,
        dropoffRate,
      };
    });

    // 가장 이탈이 많은 단계 (상위 3개)
    const worstDropoff = [...dropoff]
      .sort((a, b) => b.dropoffRate - a.dropoffRate)
      .slice(0, 3);

    return {
      period: `${days}일`,
      funnel,
      dropoff,
      worstDropoff,
      summary: {
        totalStarted: step1,
        totalCompleted: completed,
        overallConversion: step1 > 0 ? `${Math.round((completed / step1) * 100)}%` : '0%',
        acceptanceRate: estimateSent > 0 ? `${Math.round((estimateAccepted / estimateSent) * 100)}%` : '0%',
      },
    };
  }

  // 관리자용: 리드 스코어 계산
  async getLeadScores(limit = 50) {
    // 최근 미완료 플로우 중 가장 유망한 리드
    const flows = await this.prisma.chatbotFlow.findMany({
      where: {
        isCompleted: false,
        currentStep: { gte: 3 }, // 최소 3단계 이상 진행
      },
      orderBy: { updatedAt: 'desc' },
      take: limit * 2, // 필터링 후 limit 적용
      select: {
        id: true,
        sessionId: true,
        currentStep: true,
        tourType: true,
        travelDate: true,
        adultsCount: true,
        childrenCount: true,
        budgetRange: true,
        customerName: true,
        customerEmail: true,
        country: true,
        countryName: true,
        city: true,
        utmSource: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // 리드 스코어 계산
    const scoredLeads = flows.map(flow => {
      let score = 0;
      const factors: string[] = [];

      // 진행 단계 점수 (최대 35점)
      score += flow.currentStep * 5;
      factors.push(`진행도: Step ${flow.currentStep} (+${flow.currentStep * 5})`);

      // 여행 날짜가 가까우면 가산점 (최대 20점)
      if (flow.travelDate) {
        const daysUntilTravel = Math.ceil(
          (new Date(flow.travelDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
        );
        if (daysUntilTravel > 0 && daysUntilTravel <= 30) {
          const dateScore = Math.max(0, 20 - Math.floor(daysUntilTravel / 2));
          score += dateScore;
          factors.push(`여행일 임박 (${daysUntilTravel}일 후): +${dateScore}`);
        } else if (daysUntilTravel > 30 && daysUntilTravel <= 90) {
          score += 10;
          factors.push(`여행일 설정됨: +10`);
        }
      }

      // 인원수 점수 (최대 15점)
      const totalPeople = (flow.adultsCount || 0) + (flow.childrenCount || 0);
      if (totalPeople >= 4) {
        score += 15;
        factors.push(`단체 여행 (${totalPeople}명): +15`);
      } else if (totalPeople >= 2) {
        score += 10;
        factors.push(`${totalPeople}인 여행: +10`);
      }

      // 예산 범위 점수 (최대 15점)
      if (flow.budgetRange) {
        const budgetMap: Record<string, number> = {
          '50-100': 5,
          '100-200': 10,
          '200-300': 12,
          '300+': 15,
        };
        const budgetScore = budgetMap[flow.budgetRange] || 5;
        score += budgetScore;
        factors.push(`예산 ${flow.budgetRange}: +${budgetScore}`);
      }

      // 연락처 제공 여부 (최대 15점)
      if (flow.customerEmail) {
        score += 10;
        factors.push(`이메일 제공: +10`);
      }
      if (flow.customerName) {
        score += 5;
        factors.push(`이름 제공: +5`);
      }

      // 최근 활동 보너스 (최대 10점)
      const hoursSinceUpdate = (Date.now() - new Date(flow.updatedAt).getTime()) / (1000 * 60 * 60);
      if (hoursSinceUpdate < 1) {
        score += 10;
        factors.push(`방금 활동: +10`);
      } else if (hoursSinceUpdate < 24) {
        score += 5;
        factors.push(`24시간 내 활동: +5`);
      }

      return {
        ...flow,
        score,
        factors,
        grade: score >= 70 ? 'HOT' : score >= 50 ? 'WARM' : 'COLD',
      };
    });

    // 점수순 정렬 후 limit 적용
    const topLeads = scoredLeads
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const summary = {
      hot: topLeads.filter(l => l.grade === 'HOT').length,
      warm: topLeads.filter(l => l.grade === 'WARM').length,
      cold: topLeads.filter(l => l.grade === 'COLD').length,
    };

    return {
      leads: topLeads,
      summary,
    };
  }

  // 관리자용: 국가별 통계 (단일 쿼리로 최적화)
  async getCountryStats(days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // 단일 Raw SQL로 국가별 총 건수와 완료 건수를 한번에 조회
    const countryStats = await this.prisma.$queryRaw<Array<{
      country: string;
      country_name: string | null;
      total_count: bigint;
      completed_count: bigint;
    }>>`
      SELECT
        country,
        country_name,
        COUNT(*) as total_count,
        COUNT(CASE WHEN is_completed = true THEN 1 END) as completed_count
      FROM chatbot_flows
      WHERE created_at >= ${startDate}
        AND country IS NOT NULL
      GROUP BY country, country_name
      ORDER BY COUNT(*) DESC
      LIMIT 20
    `;

    const data = countryStats.map((item) => {
      const total = Number(item.total_count);
      const completed = Number(item.completed_count);
      return {
        country: item.country,
        countryName: item.country_name,
        count: total,
        completed,
        conversionRate: total > 0
          ? `${Math.round((completed / total) * 100)}%`
          : '0%',
      };
    });

    return {
      period: `${days}일`,
      data,
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

  // 메시지 배치 저장
  async saveMessagesBatch(
    sessionId: string,
    messages: Array<{
      role: 'bot' | 'user';
      content: string;
      messageType?: 'text' | 'options' | 'form';
      options?: Array<{ value: string; label: string; sub?: string }>;
    }>,
  ) {
    // 세션 존재 확인
    await this.getFlow(sessionId);

    if (!messages || messages.length === 0) {
      return { count: 0, messages: [] };
    }

    // 배치 삽입
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

    // 첫 번째 사용자 메시지로 세션 제목 자동 설정
    const firstUserMsg = messages.find((m) => m.role === 'user');
    if (firstUserMsg) {
      const existingUserMsgCount = await this.prisma.chatbotMessage.count({
        where: { sessionId, role: 'user' },
      });

      // 방금 추가한 메시지 수를 고려
      const userMsgsInBatch = messages.filter((m) => m.role === 'user').length;
      if (existingUserMsgCount === userMsgsInBatch) {
        // 이번 배치가 첫 사용자 메시지를 포함
        const title =
          firstUserMsg.content.slice(0, 50) +
          (firstUserMsg.content.length > 50 ? '...' : '');
        await this.prisma.chatbotFlow.update({
          where: { sessionId },
          data: { title },
        });
      }
    }

    return { count: createdMessages.length, messages: createdMessages };
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
      estimates.map((e) => [e.id, { statusAi: e.statusAi, shareHash: e.shareHash }]),
    );

    const sessions = flows.map((flow) => {
      const estimateInfo = flow.estimateId ? estimateMap.get(flow.estimateId) : null;
      return {
        sessionId: flow.sessionId,
        title: flow.title,
        currentStep: flow.currentStep,
        isCompleted: flow.isCompleted,
        estimateId: flow.estimateId,
        estimateStatus: estimateInfo?.statusAi || null,
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

    // 세션을 사용자에게 연결
    await this.prisma.chatbotFlow.update({
      where: { sessionId },
      data: { userId },
    });

    this.logger.log(`Session ${sessionId} linked to user ${userId}`);
    return { success: true, linked: true };
  }

  // 세션 제목 업데이트
  async updateSessionTitle(sessionId: string, title: string, userId?: string) {
    const flow = await this.getFlow(sessionId);

    // 사용자 권한 확인 (userId가 제공된 경우)
    if (userId && flow.userId && flow.userId !== userId) {
      throw new ForbiddenException('You do not have permission to modify this session.');
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
      throw new ForbiddenException('You do not have permission to delete this session.');
    }

    // ChatbotMessage는 onDelete: Cascade로 자동 삭제됨
    await this.prisma.chatbotFlow.delete({
      where: { sessionId },
    });

    return { success: true };
  }

  // ============ 관리자용: 견적 생성 ============

  // 챗봇 플로우에서 견적 생성 (관리자)
  async createEstimateFromFlow(sessionId: string, title?: string) {
    const flow = await this.getFlow(sessionId);

    // 이미 견적이 연결되어 있으면 에러
    if (flow.estimateId) {
      throw new BadRequestException('이 세션에는 이미 견적이 연결되어 있습니다.');
    }

    // 견적 제목 생성
    const estimateTitle = title || (flow.customerName ? `${flow.customerName}님 견적` : `상담 #${flow.id} 견적`);

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
    const interests = [...(flow.interestMain || []), ...(flow.interestSub || [])];

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
      requestContentParts.push(`[투어 타입] ${tourTypeLabels[flow.tourType] || flow.tourType}`);
    }

    // Step 2: 첫 방문 여부
    if (flow.isFirstVisit !== null) {
      requestContentParts.push(`[한국 첫 방문] ${flow.isFirstVisit ? '예' : '아니오'}`);
    }

    // Step 3: 계획 유무
    if (flow.hasPlan !== null) {
      requestContentParts.push(`[계획 유무] ${flow.hasPlan ? '계획 있음' : '계획 없음'}`);
      if (flow.hasPlan && flow.isFlexible !== null) {
        requestContentParts.push(`[계획 수정 가능] ${flow.isFlexible ? '수정 가능' : '수정 불가'}`);
      }
      if (flow.hasPlan && flow.planDetails) {
        requestContentParts.push(`[계획 상세]\n${flow.planDetails}`);
      }
    }

    // Step 4: 관심사
    if (flow.interestMain?.length || flow.interestSub?.length) {
      const allInterests = [...(flow.interestMain || []), ...(flow.interestSub || [])];
      requestContentParts.push(`[관심사] ${allInterests.join(', ')}`);
    }

    // Step 5: 지역
    if (flow.region) {
      requestContentParts.push(`[지역] ${flow.region}`);
    }

    // Step 6: 폼 입력 정보
    requestContentParts.push(`\n--- 여행 정보 ---`);
    if (flow.travelDate) {
      requestContentParts.push(`[여행일] ${new Date(flow.travelDate).toLocaleDateString('ko-KR')}`);
    }
    if (flow.duration) {
      requestContentParts.push(`[기간] ${flow.duration}일`);
    }

    const totalPax = (flow.adultsCount || 0) + (flow.childrenCount || 0) + (flow.infantsCount || 0) + (flow.seniorsCount || 0);
    requestContentParts.push(`[인원] 총 ${totalPax}명 (성인 ${flow.adultsCount || 0}, 아동 ${flow.childrenCount || 0}, 유아 ${flow.infantsCount || 0}, 시니어 ${flow.seniorsCount || 0})`);

    if (flow.budgetRange) {
      requestContentParts.push(`[예산] ${flow.budgetRange}`);
    }
    if (flow.needsPickup !== null) {
      requestContentParts.push(`[공항 픽업] ${flow.needsPickup ? '필요' : '불필요'}`);
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
