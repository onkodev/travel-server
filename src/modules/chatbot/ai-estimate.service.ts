import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import {
  normalizeImages,
  calculateTotalPax,
  formatPaxString,
} from '../../common/utils';
import { EstimateItem } from '../../common/types';

// Re-export for backward compatibility
export type { EstimateItem };

// UUID 생성 헬퍼 (레거시 호환 - generateEstimateItemId 사용 권장)
function generateItemId(): string {
  return randomUUID();
}

// 템플릿 후보
interface TemplateCandidate {
  id: number;
  name: string;
  items: EstimateItem[];
  regions: string[];
  interests: string[];
  travelDays: number;
  score: number;
  scoreDetails?: {
    daysScore: number;
    daysReason: string;
    interestScore: number;
    matchedInterests: string[];
  };
}

// ChatbotFlow 데이터
interface ChatbotFlowData {
  sessionId: string;
  region: string | null;
  duration: number | null;
  interestMain: string[];
  interestSub: string[];
  attractions: string[];
  tourType: string | null;
  isFirstVisit: boolean | null;
  adultsCount: number | null;
  childrenCount: number | null;
  infantsCount: number | null;
  seniorsCount: number | null;
  ageRange: string | null;
  budgetRange: string | null;
  needsPickup: boolean | null;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  nationality: string | null;
  travelDate: Date | null;
  additionalNotes: string | null;
}

@Injectable()
export class AiEstimateService {
  private readonly logger = new Logger(AiEstimateService.name);

  // 영어 → 한글 지역명 매핑
  private readonly REGION_MAP: Record<string, string> = {
    seoul: '서울',
    busan: '부산',
    jeju: '제주',
    gyeonggi: '경기',
    gangwon: '강원',
    incheon: '인천',
    daegu: '대구',
    daejeon: '대전',
    gwangju: '광주',
    ulsan: '울산',
  };

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  /**
   * 첫 견적 생성 - 단순화된 버전
   * 1. 견본 데이터 매칭 (지역 + 일수 + 관심사)
   * 2. 정확히 맞는 템플릿 → 그대로 사용
   * 3. 일수 부족 시 → TBD로 채움
   * 4. 사용자 attractions 반영
   */
  async generateFirstEstimate(
    sessionId: string,
  ): Promise<{ estimateId: number; shareHash: string }> {
    this.logger.log(`[generateFirstEstimate] 시작 - sessionId: ${sessionId}`);

    // 1. ChatbotFlow 데이터 조회
    const flow = await this.getChatbotFlow(sessionId);
    if (!flow) {
      throw new NotFoundException('Chatbot session not found.');
    }

    const requestedDays = flow.duration || 3;
    this.logger.log(
      `[generateFirstEstimate] 요청 - region: ${flow.region}, days: ${requestedDays}, interests: ${flow.interestMain?.join(',')}`,
    );

    // 2. 견본 데이터 조회 및 매칭
    const template = await this.findBestTemplate(flow);

    if (!template) {
      this.logger.warn(
        '[generateFirstEstimate] 적합한 템플릿 없음 - TBD 견적 생성',
      );
      return this.generateTbdEstimate(flow);
    }

    this.logger.log(
      `[generateFirstEstimate] 선택된 템플릿: ${template.name} (${template.travelDays}일, score: ${template.score})`,
    );

    // 3. 템플릿 아이템 복사
    let items = this.copyTemplateItems(template.items, flow);

    // 4. 일수 조정 (부족하면 TBD 추가)
    if (template.travelDays < requestedDays) {
      items = this.addTbdDays(items, template.travelDays, requestedDays);
      this.logger.log(
        `[generateFirstEstimate] TBD 일정 추가: Day ${template.travelDays + 1} ~ Day ${requestedDays}`,
      );
    }

    // 5. 사용자 attractions 반영
    if (flow.attractions && flow.attractions.length > 0) {
      items = await this.applyUserAttractions(items, flow);
    }

    // 6. Estimate 생성
    const estimate = await this.createEstimate(flow, items, template);

    // 7. ChatbotFlow 업데이트 (Step 7 진입 - isCompleted는 finalizeItinerary에서 설정)
    await this.prisma.chatbotFlow.update({
      where: { sessionId: flow.sessionId },
      data: {
        estimateId: estimate.id,
        // isCompleted: false - 사용자가 "Send to Expert" 클릭 시 true로 변경
      },
    });

    this.logger.log(
      `[generateFirstEstimate] 완료 - estimateId: ${estimate.id}`,
    );
    return { estimateId: estimate.id, shareHash: estimate.shareHash };
  }

  /**
   * 최적 템플릿 찾기
   */
  private async findBestTemplate(
    flow: ChatbotFlowData,
  ): Promise<TemplateCandidate | null> {
    if (!flow.region) {
      this.logger.warn('Region not selected, cannot find template');
      return null;
    }
    const region = flow.region;
    const regionKor = this.REGION_MAP[region] || region;
    const requestedDays = flow.duration || 3;
    const userInterests = [
      ...(flow.interestMain || []),
      ...(flow.interestSub || []),
    ];

    // 견본 데이터 조회
    const templates = await this.prisma.estimate.findMany({
      where: {
        source: 'manual',
        statusManual: 'archived',
        OR: [
          { regions: { has: region } },
          { regions: { has: regionKor } },
          { regions: { has: 'Seoul' } },
        ],
      },
      select: {
        id: true,
        title: true,
        items: true,
        regions: true,
        interests: true,
        travelDays: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (templates.length === 0) {
      return null;
    }

    // 점수 계산 및 정렬
    const candidates: TemplateCandidate[] = templates.map((t) => {
      let score = 0;
      const templateInterests = t.interests || [];

      // 일수 매칭 (가장 중요)
      let daysScore = 0;
      let daysReason = '';
      if (t.travelDays === requestedDays) {
        daysScore = 50;
        daysReason = `정확히 ${requestedDays}일 일치`;
      } else if (
        t.travelDays === requestedDays - 1 ||
        t.travelDays === requestedDays + 1
      ) {
        daysScore = 30;
        daysReason = `1일 차이 (템플릿 ${t.travelDays}일 → 요청 ${requestedDays}일)`;
      } else if (t.travelDays < requestedDays) {
        daysScore = 20;
        daysReason = `템플릿 ${t.travelDays}일 < 요청 ${requestedDays}일 (부족분 TBD 처리)`;
      } else {
        daysScore = 10;
        daysReason = `템플릿 ${t.travelDays}일 > 요청 ${requestedDays}일`;
      }
      score += daysScore;

      // 관심사 매칭
      let interestScore = 0;
      const matchedInterests: string[] = [];
      if (userInterests.length > 0) {
        templateInterests.forEach((ti) => {
          const matched = userInterests.some(
            (ui) =>
              ui.toLowerCase().includes(ti.toLowerCase()) ||
              ti.toLowerCase().includes(ui.toLowerCase()),
          );
          if (matched) {
            matchedInterests.push(ti);
            interestScore += 10;
          }
        });
        score += interestScore;
      }

      return {
        id: t.id,
        name: t.title,
        items: t.items as unknown as EstimateItem[],
        regions: t.regions || [],
        interests: templateInterests,
        travelDays: t.travelDays,
        score,
        scoreDetails: {
          daysScore,
          daysReason,
          interestScore,
          matchedInterests,
        },
      };
    });

    // 점수순 정렬
    candidates.sort((a, b) => b.score - a.score);

    // 최소 점수 이상인 템플릿 반환
    const best = candidates[0];
    if (best.score >= 20) {
      return best;
    }

    return null;
  }

  /**
   * 템플릿 아이템 복사 (인원수 반영)
   */
  private copyTemplateItems(
    templateItems: EstimateItem[],
    flow: ChatbotFlowData,
  ): EstimateItem[] {
    const totalPax = calculateTotalPax(flow);

    return templateItems.map((item) => ({
      ...item,
      id: generateItemId(),
      quantity: item.type === 'place' ? totalPax : item.quantity,
      subtotal:
        item.type === 'place'
          ? (item.unitPrice ?? 0) * totalPax
          : item.subtotal,
    }));
  }

  /**
   * 부족한 일수를 TBD로 채우기
   */
  private addTbdDays(
    items: EstimateItem[],
    templateDays: number,
    requestedDays: number,
  ): EstimateItem[] {
    const result = [...items];

    for (let day = templateDays + 1; day <= requestedDays; day++) {
      result.push({
        id: generateItemId(),
        dayNumber: day,
        orderIndex: 0,
        type: 'place',
        itemId: undefined,
        isTbd: true,
        note: '전문가 상담 후 확정 예정',
        quantity: 1,
        unitPrice: 0,
        subtotal: 0,
      });
    }

    return result;
  }

  /**
   * 사용자 선택 명소 반영
   */
  private async applyUserAttractions(
    items: EstimateItem[],
    flow: ChatbotFlowData,
  ): Promise<EstimateItem[]> {
    if (!flow.attractions || flow.attractions.length === 0) {
      return items;
    }

    const totalPax = calculateTotalPax(flow);
    const existingItemIds = new Set(
      items.filter((i) => i.itemId).map((i) => i.itemId),
    );

    // attractions 이름으로 Item 조회
    const attractionItems = await this.prisma.item.findMany({
      where: {
        type: 'place',
        OR: flow.attractions.map((name) => ({
          OR: [
            { nameEng: { contains: name, mode: 'insensitive' as const } },
            { nameKor: { contains: name } },
          ],
        })),
      },
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
      take: flow.attractions.length * 2,
    });

    const result = [...items];
    const duration = flow.duration || 3;

    for (const attraction of attractionItems) {
      // 이미 있으면 스킵
      if (existingItemIds.has(attraction.id)) continue;

      // 가장 장소 수가 적은 날에 추가
      const dayCount: Record<number, number> = {};
      for (let d = 1; d <= duration; d++) dayCount[d] = 0;
      result
        .filter((i) => i.type === 'place' && !i.isTbd)
        .forEach((i) => {
          if (dayCount[i.dayNumber] !== undefined) dayCount[i.dayNumber]++;
        });

      const targetDay = Object.entries(dayCount).sort(
        ([, a], [, b]) => a - b,
      )[0]?.[0];
      const dayNumber = targetDay ? parseInt(targetDay) : 1;
      const maxOrder = Math.max(
        ...result
          .filter((i) => i.dayNumber === dayNumber)
          .map((i) => i.orderIndex),
        -1,
      );

      const unitPrice = Number(attraction.price) || 0;
      result.push({
        id: generateItemId(),
        dayNumber,
        orderIndex: maxOrder + 1,
        type: 'place',
        itemId: attraction.id,
        isTbd: false,
        quantity: totalPax,
        unitPrice,
        subtotal: unitPrice * totalPax,
        itemInfo: {
          nameKor: attraction.nameKor,
          nameEng: attraction.nameEng,
          descriptionEng: attraction.descriptionEng || undefined,
          images: normalizeImages(attraction.images),
          lat: Number(attraction.lat),
          lng: Number(attraction.lng),
          addressEnglish: attraction.addressEnglish || undefined,
        },
      });

      existingItemIds.add(attraction.id);
      this.logger.log(
        `[applyUserAttractions] ${attraction.nameKor} → Day ${dayNumber} 추가`,
      );
    }

    return result;
  }

  /**
   * TBD 전용 견적 생성 (템플릿 없을 때)
   */
  private async generateTbdEstimate(
    flow: ChatbotFlowData,
  ): Promise<{ estimateId: number; shareHash: string }> {
    const duration = flow.duration || 3;
    const items: EstimateItem[] = [];

    for (let day = 1; day <= duration; day++) {
      items.push({
        id: generateItemId(),
        dayNumber: day,
        orderIndex: 0,
        type: 'place',
        itemId: undefined,
        isTbd: true,
        note: '전문가 상담 후 확정 예정',
        quantity: 1,
        unitPrice: 0,
        subtotal: 0,
      });
    }

    // 사용자 attractions가 있으면 반영
    let finalItems = items;
    if (flow.attractions && flow.attractions.length > 0) {
      finalItems = await this.applyUserAttractions(items, flow);
    }

    const estimate = await this.createEstimate(flow, finalItems, null);

    await this.prisma.chatbotFlow.update({
      where: { sessionId: flow.sessionId },
      data: {
        estimateId: estimate.id,
        // isCompleted: false - 사용자가 "Send to Expert" 클릭 시 true로 변경
      },
    });

    return { estimateId: estimate.id, shareHash: estimate.shareHash };
  }

  /**
   * Estimate 생성
   */
  private async createEstimate(
    flow: ChatbotFlowData,
    items: EstimateItem[],
    template: TemplateCandidate | null,
  ): Promise<{ id: number; shareHash: string }> {
    const totalPax = calculateTotalPax(flow);
    const region = flow.region || 'unknown';
    const regionKor = this.REGION_MAP[region] || region;
    const duration = flow.duration || 3;

    // shareHash 생성
    const shareHash = randomUUID().replace(/-/g, '').substring(0, 16);

    // 제목 생성
    const customerName = flow.customerName || 'Guest';
    const title = `AI Quote - ${customerName} (${region} ${duration}D)`;

    // TBD 여부 확인
    const hasTbdItems = items.some((item) => item.isTbd);

    // 내부 메모 생성 (관리자용 - 템플릿 선택 이유 상세)
    const internalMemo = this.buildInternalMemo(flow, template);

    // 고객 요청사항 (requestContent)
    const requestContent = this.buildRequestContent(flow);

    // 유효기간: 10일 후
    const validDate = new Date();
    validDate.setDate(validDate.getDate() + 10);

    const estimate = await this.prisma.estimate.create({
      data: {
        title,
        items: items as unknown as Prisma.InputJsonValue,
        regions: [region, regionKor],
        interests: [...(flow.interestMain || []), ...(flow.interestSub || [])],
        travelDays: duration,
        adultsCount: flow.adultsCount || 1,
        childrenCount: flow.childrenCount || 0,
        infantsCount: flow.infantsCount || 0,
        startDate: flow.travelDate,
        endDate: flow.travelDate
          ? new Date(
              new Date(flow.travelDate).getTime() +
                (duration - 1) * 24 * 60 * 60 * 1000,
            )
          : null,
        customerName: flow.customerName,
        customerEmail: flow.customerEmail,
        customerPhone: flow.customerPhone,
        nationality: flow.nationality,
        source: 'ai',
        statusAi: hasTbdItems ? 'pending' : 'draft',
        chatSessionId: flow.sessionId,
        shareHash,
        internalMemo,
        requestContent,
        totalAmount: items.reduce((sum, item) => sum + (item.subtotal ?? 0), 0),
        validDate,
        displayOptions: {
          place: true,
          accommodation: true,
          transportation: true,
          contents: true,
          price: false, // AI 견적은 가격 숨김
        },
      },
    });

    return { id: estimate.id, shareHash };
  }

  /**
   * 내부 메모 생성 (관리자용 - 템플릿 선택 이유 상세)
   */
  private buildInternalMemo(
    flow: ChatbotFlowData,
    template: TemplateCandidate | null,
  ): string {
    const lines: string[] = [];

    lines.push(
      '╔════════════════════════════════════════════════════════════════╗',
    );
    lines.push(
      '║                    AI 견적 생성 리포트                          ║',
    );
    lines.push(
      '╚════════════════════════════════════════════════════════════════╝',
    );
    lines.push('');
    lines.push(`📅 생성 시간: ${new Date().toLocaleString('ko-KR')}`);
    lines.push('');

    // 템플릿 선택 정보
    lines.push(
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    );
    lines.push('📋 템플릿 선택 결과');
    lines.push(
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    );

    if (template) {
      lines.push(`✅ 선택된 템플릿: ${template.name}`);
      lines.push(`   - 템플릿 ID: ${template.id}`);
      lines.push(`   - 템플릿 일수: ${template.travelDays}일`);
      lines.push(
        `   - 템플릿 관심사: ${template.interests.join(', ') || '없음'}`,
      );
      lines.push('');
      lines.push(`📊 매칭 점수: ${template.score}점`);

      if (template.scoreDetails) {
        lines.push('');
        lines.push('   [점수 상세]');
        lines.push(`   • 일수 매칭: +${template.scoreDetails.daysScore}점`);
        lines.push(`     → ${template.scoreDetails.daysReason}`);
        lines.push(
          `   • 관심사 매칭: +${template.scoreDetails.interestScore}점`,
        );
        if (template.scoreDetails.matchedInterests.length > 0) {
          lines.push(
            `     → 일치 항목: ${template.scoreDetails.matchedInterests.join(', ')}`,
          );
        } else {
          lines.push('     → 일치 항목 없음');
        }
      }
    } else {
      lines.push('⚠️ 적합한 템플릿 없음 - TBD 견적 생성');
      lines.push('   → 전문가 상담 필요');
    }

    lines.push('');

    // 고객 요청 정보 요약
    lines.push(
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    );
    lines.push('👤 고객 요청 정보 (입력값)');
    lines.push(
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    );
    lines.push(`• 지역: ${flow.region || 'Not selected'}`);
    lines.push(`• 요청 일수: ${flow.duration || 3}일`);
    lines.push(
      `• 인원: 성인 ${flow.adultsCount || 1}, 아동 ${flow.childrenCount || 0}, 유아 ${flow.infantsCount || 0}`,
    );

    if (flow.interestMain?.length) {
      lines.push(`• 관심사(주): ${flow.interestMain.join(', ')}`);
    }
    if (flow.interestSub?.length) {
      lines.push(`• 관심사(부): ${flow.interestSub.join(', ')}`);
    }
    if (flow.attractions?.length) {
      lines.push(`• 희망 명소: ${flow.attractions.join(', ')}`);
    }
    if (flow.isFirstVisit !== null) {
      lines.push(`• 첫 방문 여부: ${flow.isFirstVisit ? '예' : '아니오'}`);
    }
    if (flow.budgetRange) {
      lines.push(`• 예산 범위: ${flow.budgetRange}`);
    }
    if (flow.needsPickup !== null) {
      lines.push(`• 픽업 필요: ${flow.needsPickup ? '예' : '아니오'}`);
    }

    lines.push('');

    // 처리 결과
    lines.push(
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    );
    lines.push('⚙️ 처리 내용');
    lines.push(
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    );

    if (template) {
      const requestedDays = flow.duration || 3;
      if (template.travelDays < requestedDays) {
        lines.push(
          `• 일수 조정: ${template.travelDays}일 템플릿 → ${requestedDays}일 (Day ${template.travelDays + 1}~${requestedDays} TBD 추가)`,
        );
      } else if (template.travelDays === requestedDays) {
        lines.push('• 일수 조정: 없음 (정확히 일치)');
      } else {
        lines.push(
          `• 일수 조정: ${template.travelDays}일 템플릿 (요청보다 ${template.travelDays - requestedDays}일 많음)`,
        );
      }

      if (flow.attractions?.length) {
        lines.push(
          `• 사용자 명소 반영: ${flow.attractions.length}개 추가 시도`,
        );
      }
    }

    return lines.join('\n');
  }

  /**
   * 고객 요청사항 생성 (requestContent - 고객이 입력한 내용)
   */
  private buildRequestContent(flow: ChatbotFlowData): string {
    const lines: string[] = [];

    // 기본 여행 정보
    lines.push(`지역: ${flow.region || 'Not selected'}`);
    lines.push(`여행 일수: ${flow.duration || 3}일`);
    lines.push(
      `인원: 성인 ${flow.adultsCount || 1}명, 아동 ${flow.childrenCount || 0}명, 유아 ${flow.infantsCount || 0}명`,
    );

    if (flow.travelDate) {
      lines.push(
        `여행 날짜: ${new Date(flow.travelDate).toLocaleDateString('ko-KR')}`,
      );
    }

    if (flow.interestMain?.length) {
      lines.push(`관심사: ${flow.interestMain.join(', ')}`);
    }

    if (flow.attractions?.length) {
      lines.push(`희망 명소: ${flow.attractions.join(', ')}`);
    }

    if (flow.isFirstVisit !== null) {
      lines.push(`한국 첫 방문: ${flow.isFirstVisit ? '예' : '아니오'}`);
    }

    if (flow.budgetRange) {
      lines.push(`예산: ${flow.budgetRange}`);
    }

    if (flow.needsPickup !== null && flow.needsPickup) {
      lines.push('공항 픽업 필요');
    }

    // 고객이 직접 입력한 추가 요청사항
    if (flow.additionalNotes) {
      lines.push('');
      lines.push('--- 추가 요청사항 ---');
      lines.push(flow.additionalNotes);
    }

    return lines.join('\n');
  }

  /**
   * ChatbotFlow 조회
   */
  private async getChatbotFlow(
    sessionId: string,
  ): Promise<ChatbotFlowData | null> {
    const flow = await this.prisma.chatbotFlow.findUnique({
      where: { sessionId },
    });

    if (!flow) return null;

    return {
      sessionId: flow.sessionId,
      region: flow.region,
      duration: flow.duration,
      interestMain: flow.interestMain || [],
      interestSub: flow.interestSub || [],
      attractions: flow.attractions || [],
      tourType: flow.tourType,
      isFirstVisit: flow.isFirstVisit,
      adultsCount: flow.adultsCount,
      childrenCount: flow.childrenCount,
      infantsCount: flow.infantsCount,
      seniorsCount: flow.seniorsCount,
      ageRange: flow.ageRange,
      budgetRange: flow.budgetRange,
      needsPickup: flow.needsPickup,
      customerName: flow.customerName,
      customerEmail: flow.customerEmail,
      customerPhone: flow.customerPhone,
      nationality: flow.nationality,
      travelDate: flow.travelDate,
      additionalNotes: flow.additionalNotes,
    };
  }

  /**
   * 수정 요청 처리
   */
  async modifyEstimate(
    estimateId: number,
    request: {
      dayNumber?: number;
      replaceItemId?: number;
      action: 'replace' | 'add' | 'remove';
      preference?: string;
    },
  ): Promise<{ success: boolean; items: EstimateItem[] }> {
    const estimate = await this.prisma.estimate.findUnique({
      where: { id: estimateId },
    });

    if (!estimate) {
      throw new NotFoundException('Estimate not found.');
    }

    const currentItems = estimate.items as unknown as EstimateItem[];
    let newItems = [...currentItems];

    if (
      request.action === 'remove' &&
      request.dayNumber &&
      request.replaceItemId
    ) {
      newItems = currentItems.filter(
        (item) =>
          !(
            item.dayNumber === request.dayNumber &&
            item.itemId === request.replaceItemId
          ),
      );
      // orderIndex 재정렬
      newItems = this.reorderItems(newItems);
    }

    await this.prisma.estimate.update({
      where: { id: estimateId },
      data: { items: newItems as unknown as Prisma.InputJsonValue },
    });

    return { success: true, items: newItems };
  }

  /**
   * 아이템 순서 재정렬
   */
  private reorderItems(items: EstimateItem[]): EstimateItem[] {
    const byDay: Record<number, EstimateItem[]> = {};

    items.forEach((item) => {
      if (!byDay[item.dayNumber]) byDay[item.dayNumber] = [];
      byDay[item.dayNumber].push(item);
    });

    const result: EstimateItem[] = [];
    Object.keys(byDay)
      .map(Number)
      .sort((a, b) => a - b)
      .forEach((day) => {
        byDay[day]
          .sort((a, b) => a.orderIndex - b.orderIndex)
          .forEach((item, idx) => {
            result.push({ ...item, orderIndex: idx });
          });
      });

    return result;
  }
}
