import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ItineraryAiService,
  ModificationIntent,
} from '../ai/services/itinerary-ai.service';
import { TravelAssistantService } from '../ai/services/travel-assistant.service';
import { ItemService } from '../item/item.service';
import { normalizeImages } from '../../common/utils';
import { EstimateItem } from '../../common/types';

// Re-export for backward compatibility
export type { EstimateItem };
export type { ModificationIntent };

interface FlowWithEstimate {
  sessionId: string;
  estimateId: number | null;
  region: string | null;
  duration: number | null;
  interestMain: string[];
  interestSub: string[];
  attractions: string[];
  estimate: { id: number; items: unknown };
}

@Injectable()
export class ConversationalEstimateService {
  private readonly logger = new Logger(ConversationalEstimateService.name);

  constructor(
    private prisma: PrismaService,
    private itineraryAiService: ItineraryAiService,
    private travelAssistantService: TravelAssistantService,
    private itemService: ItemService,
  ) {}

  /**
   * 사용자 메시지를 분석하여 수정 의도 파싱
   */
  async parseModificationIntent(
    sessionId: string,
    userMessage: string,
  ): Promise<ModificationIntent> {
    const flow = await this.prisma.chatbotFlow.findUnique({
      where: { sessionId },
    });

    if (!flow) {
      throw new NotFoundException('Session not found.');
    }

    if (!flow.estimateId) {
      throw new BadRequestException('No estimate found for this session.');
    }

    const estimate = await this.prisma.estimate.findUnique({
      where: { id: flow.estimateId! },
      select: { id: true, items: true },
    });

    if (!estimate) {
      throw new BadRequestException('Estimate not found.');
    }

    const items = (estimate.items as unknown as EstimateItem[]) || [];
    const currentItinerary = items.map((item) => ({
      dayNumber: item.dayNumber,
      name: item.itemName || item.name || item.nameEng || 'Unknown',
      type: item.type,
    }));

    const interests = [
      ...(flow.interestMain || []),
      ...(flow.interestSub || []),
    ];

    return this.itineraryAiService.parseModificationIntent({
      userMessage,
      currentItinerary,
      interests,
      region: flow.region || undefined,
    });
  }

  /**
   * 대화형 일정 수정 실행
   */
  async modifyItinerary(
    sessionId: string,
    userMessage: string,
    preParsedIntent?: {
      action: string;
      dayNumber?: number;
      itemName?: string;
      category?: string;
    },
    preloadedData?: {
      flow: { sessionId: string; estimateId: number | null; region: string | null; duration: number | null; interestMain: string[]; interestSub: string[]; attractions: string[] };
      estimate: { id: number; items: unknown };
    },
  ): Promise<{
    success: boolean;
    updatedItems: EstimateItem[];
    botMessage: string;
    intent: ModificationIntent;
  }> {
    let intent: ModificationIntent;
    if (preParsedIntent) {
      // travelAssistantService.chat()에서 이미 감지한 intent 재사용 (Gemini 호출 스킵)
      intent = {
        action: preParsedIntent.action as ModificationIntent['action'],
        dayNumber: preParsedIntent.dayNumber,
        itemName: preParsedIntent.itemName,
        category: preParsedIntent.category,
        confidence: 0.8,
        explanation: 'Pre-parsed from travel assistant',
      };
    } else {
      intent = await this.parseModificationIntent(sessionId, userMessage);
    }

    this.logger.log(`Modification intent: ${JSON.stringify(intent)}`);

    // 신뢰도가 낮으면 확인 요청
    if (intent.confidence < 0.5 && intent.action !== 'general_feedback') {
      return {
        success: false,
        updatedItems: [],
        botMessage:
          'I\'m not sure what you\'d like to change. Could you be more specific? For example:\n- "Change Day 2"\n- "Add Namsan Tower"\n- "Remove shopping places"',
        intent,
      };
    }

    const flow =
      preloadedData?.flow ??
      (await this.prisma.chatbotFlow.findUnique({
        where: { sessionId },
      }));

    if (!flow?.estimateId) {
      throw new BadRequestException('No estimate found.');
    }

    const estimate =
      preloadedData?.estimate ??
      (await this.prisma.estimate.findUnique({
        where: { id: flow.estimateId! },
      }));

    if (!estimate) {
      throw new BadRequestException('Estimate not found.');
    }

    // flow에 estimate를 추가하여 핸들러에 전달
    const flowWithEstimate = { ...flow, estimate };

    switch (intent.action) {
      case 'regenerate_day':
        return this.handleRegenerateDay(flowWithEstimate, intent);

      case 'add_item':
        return this.handleAddItem(flowWithEstimate, intent);

      case 'remove_item':
        return this.handleRemoveItem(flowWithEstimate, intent);

      case 'replace_item':
        return this.handleReplaceItem(flowWithEstimate, intent);

      case 'general_feedback':
      default:
        return {
          success: true,
          updatedItems: (estimate.items as unknown as EstimateItem[]) || [],
          botMessage: this.getPositiveFeedbackResponse(),
          intent,
        };
    }
  }

  /**
   * 특정 일차 재생성
   */
  async regenerateDay(
    sessionId: string,
    dayNumber: number,
  ): Promise<{
    success: boolean;
    updatedItems: EstimateItem[];
    botMessage: string;
  }> {
    const flow = await this.prisma.chatbotFlow.findUnique({
      where: { sessionId },
    });

    if (!flow?.estimateId) {
      throw new BadRequestException('No estimate found.');
    }

    const estimate = await this.prisma.estimate.findUnique({
      where: { id: flow.estimateId! },
    });

    if (!estimate) {
      throw new BadRequestException('Estimate not found.');
    }

    const flowWithEstimate = { ...flow, estimate };

    const intent: ModificationIntent = {
      action: 'regenerate_day',
      dayNumber,
      confidence: 1.0,
    };

    return this.handleRegenerateDay(flowWithEstimate, intent);
  }

  /**
   * 일정 확정 및 전문가에게 전송
   */
  async finalizeItinerary(sessionId: string): Promise<{
    success: boolean;
    message: string;
    estimateId: number;
  }> {
    const flow = await this.prisma.chatbotFlow.findUnique({
      where: { sessionId },
    });

    if (!flow?.estimateId) {
      throw new BadRequestException('No estimate found.');
    }

    // 플로우 완료 상태로 변경
    await this.prisma.chatbotFlow.update({
      where: { sessionId },
      data: { isCompleted: true },
    });

    // 견적 상태를 pending으로 변경 (전문가 검토 대기)
    await this.prisma.estimate.update({
      where: { id: flow.estimateId! },
      data: { statusAi: 'pending' },
    });

    return {
      success: true,
      message:
        'Your itinerary has been sent to our travel expert for review. They will contact you soon!',
      estimateId: flow.estimateId,
    };
  }

  // ========== Private handlers ==========

  private async handleRegenerateDay(
    flow: FlowWithEstimate,
    intent: ModificationIntent,
  ): Promise<{
    success: boolean;
    updatedItems: EstimateItem[];
    botMessage: string;
    intent: ModificationIntent;
  }> {
    const dayNumber = intent.dayNumber;
    if (!dayNumber) {
      return {
        success: false,
        updatedItems: [],
        botMessage:
          'Which day would you like me to regenerate? Please specify the day number.',
        intent,
      };
    }

    const items = (flow.estimate.items as EstimateItem[]) || [];
    // 실제 일정의 최대 일차 (flow.duration보다 신뢰성 있음)
    const maxDayInItems =
      items.length > 0 ? Math.max(...items.map((i) => i.dayNumber || 1)) : 1;
    const duration = Math.max(flow.duration || 1, maxDayInItems);

    this.logger.log(
      `handleRegenerateDay: dayNumber=${dayNumber}, duration=${duration}, maxDayInItems=${maxDayInItems}, itemCount=${items.length}`,
    );

    if (dayNumber < 1 || dayNumber > duration) {
      this.logger.warn(
        `handleRegenerateDay: Invalid day number! dayNumber=${dayNumber}, duration=${duration}`,
      );
      return {
        success: false,
        updatedItems: items,
        botMessage: `Invalid day number. Your trip is ${duration} day(s) long (Days 1-${duration}).`,
        intent,
      };
    }

    const interests = [
      ...(flow.interestMain || []),
      ...(flow.interestSub || []),
    ];

    // 기존 일정의 itemId 목록 (중복 방지)
    const existingItemIds = items
      .filter((i) => i.dayNumber !== dayNumber && i.itemId)
      .map((i) => i.itemId as number);

    this.logger.log(
      `handleRegenerateDay: searching items - interests=${interests.join(',')}, region=${flow.region}, excludeIds=${existingItemIds.length}`,
    );

    // DB에서 후보 아이템 조회 (최소 10개 필요)
    let candidateItems = await this.itemService.findSimilarItems({
      interests,
      region: flow.region || undefined,
      type: 'place',
      excludeIds: existingItemIds,
      limit: 30,
    });

    // 후보가 부족하면 지역 조건 없이 재검색
    if (candidateItems.length < 10) {
      this.logger.log(
        `handleRegenerateDay: only ${candidateItems.length} items found, searching without region constraint`,
      );
      const moreItems = await this.itemService.findSimilarItems({
        interests,
        type: 'place',
        excludeIds: [...existingItemIds, ...candidateItems.map((c) => c.id)],
        limit: 30 - candidateItems.length,
      });
      candidateItems = [...candidateItems, ...moreItems];
    }

    this.logger.log(
      `handleRegenerateDay: found ${candidateItems.length} candidate items`,
    );

    if (candidateItems.length === 0) {
      return {
        success: false,
        updatedItems: items,
        botMessage:
          'I could not find suitable places in our database. Please try with different preferences.',
        intent,
      };
    }

    // AI로 최적의 아이템 선택 (3-5개)
    this.logger.log(
      `handleRegenerateDay: candidateItems=${candidateItems.length}, interests=${interests.join(',')}`,
    );
    const selectedItems = await this.itineraryAiService.selectMultipleItems({
      availableItems: candidateItems,
      count: Math.min(4, candidateItems.length),
      interests,
      dayNumber,
      region: flow.region || 'Seoul',
    });
    this.logger.log(
      `handleRegenerateDay: selectedItems=${selectedItems.length}`,
    );

    // 선택된 아이템으로 일정 구성
    const otherDayItems = items.filter((i) => i.dayNumber !== dayNumber);
    const newItems: EstimateItem[] = selectedItems
      .map((selection, idx) => {
        const dbItem = candidateItems.find(
          (c) => c.id === selection.selectedId,
        );
        if (!dbItem) return null;

        return {
          id: `ai-day${dayNumber}-${idx + 1}`,
          type: dbItem.type || 'place',
          itemId: dbItem.id,
          itemName: dbItem.nameEng,
          name: dbItem.nameEng,
          nameEng: dbItem.nameEng,
          dayNumber,
          orderIndex: idx,
          note: selection.reason,
          itemInfo: {
            nameKor: dbItem.nameKor,
            nameEng: dbItem.nameEng,
            descriptionEng: dbItem.descriptionEng || undefined,
            images: normalizeImages(dbItem.images),
          },
        };
      })
      .filter(Boolean) as EstimateItem[];

    const updatedItems = [...otherDayItems, ...newItems].sort((a, b) => {
      if (a.dayNumber !== b.dayNumber) return a.dayNumber - b.dayNumber;
      return a.orderIndex - b.orderIndex;
    });

    // DB 업데이트
    await this.prisma.estimate.update({
      where: { id: flow.estimateId! },
      data: { items: updatedItems as unknown as Prisma.InputJsonValue },
    });

    this.logger.log(
      `handleRegenerateDay: success! updatedItems=${updatedItems.length}`,
    );
    return {
      success: true,
      updatedItems,
      botMessage: `I've created a new itinerary for Day ${dayNumber} using our curated places! Take a look and let me know if you'd like any more changes.`,
      intent,
    };
  }

  private async handleAddItem(
    flow: FlowWithEstimate,
    intent: ModificationIntent,
  ): Promise<{
    success: boolean;
    updatedItems: EstimateItem[];
    botMessage: string;
    intent: ModificationIntent;
  }> {
    const items = (flow.estimate.items as EstimateItem[]) || [];

    if (!intent.itemName && !intent.category) {
      return {
        success: false,
        updatedItems: items,
        botMessage:
          'What would you like to add? Please tell me the name of a place or a category (like "food", "shopping", "culture").',
        intent,
      };
    }

    const interests = [
      ...(flow.interestMain || []),
      ...(flow.interestSub || []),
    ];
    const existingItemIds = items
      .filter((i) => i.itemId)
      .map((i) => i.itemId as number);

    // 사용자가 특정 장소명을 요청한 경우, 먼저 정확한 이름 매칭 시도 (excludeIds 없이)
    if (intent.itemName && intent.itemName.length > 3) {
      this.logger.log(
        `Searching for exact match: query="${intent.itemName}", region="${flow.region}"`,
      );

      const exactMatch = await this.itemService.findSimilarItems({
        query: intent.itemName,
        region: flow.region || undefined,
        type: 'place',
        limit: 5,
      });

      this.logger.log(`Exact match results: ${exactMatch.length} items found`);
      if (exactMatch.length > 0) {
        this.logger.log(
          `First result: ${exactMatch[0].nameEng} (ID: ${exactMatch[0].id})`,
        );
      }

      // 이름 유사도 기준으로 정렬 (정확한 매칭 우선)
      const requestedLower = intent.itemName.toLowerCase();
      const sortedResults = [...exactMatch].sort((a, b) => {
        const aKor = (a.nameKor || '').toLowerCase();
        const bKor = (b.nameKor || '').toLowerCase();
        const aEng = (a.nameEng || '').toLowerCase();
        const bEng = (b.nameEng || '').toLowerCase();
        // 요청된 이름과의 길이 차이가 작을수록 우선 (더 정확한 매칭)
        const aDiff = Math.min(
          Math.abs(aKor.length - requestedLower.length),
          Math.abs(aEng.length - requestedLower.length),
        );
        const bDiff = Math.min(
          Math.abs(bKor.length - requestedLower.length),
          Math.abs(bEng.length - requestedLower.length),
        );
        return aDiff - bDiff;
      });

      const foundItem = sortedResults.find((item) => {
        const nameEng = (item.nameEng || '').toLowerCase();
        const nameKor = (item.nameKor || '').toLowerCase();
        return (
          nameEng.includes(requestedLower) ||
          requestedLower.includes(nameEng) ||
          nameKor.includes(requestedLower) ||
          requestedLower.includes(nameKor)
        );
      });

      if (foundItem) {
        this.logger.log(
          `Exact match found for "${intent.itemName}": ${foundItem.nameEng} (ID: ${foundItem.id})`,
        );
        const reason = `I found "${foundItem.nameEng}" in our curated list. It's a great choice!`;
        return this.addItemToItinerary(flow, items, foundItem, intent, reason);
      } else {
        this.logger.log(`No exact match for "${intent.itemName}" in results`);
      }
    }

    // DB에서 후보 아이템 검색 (폴백 로직 포함)
    const candidateItems = await this.itemService.findSimilarItems({
      query: intent.itemName || undefined,
      categories: intent.category ? [intent.category] : interests,
      interests,
      region: flow.region || undefined,
      type: 'place',
      excludeIds: existingItemIds,
      limit: 15,
    });

    // DB에서 아무것도 못 찾은 경우 → TBD 아이템 생성
    if (candidateItems.length === 0 && intent.itemName) {
      return this.addTbdItemToItinerary(flow, items, intent.itemName, intent);
    }

    if (candidateItems.length === 0) {
      return {
        success: false,
        updatedItems: items,
        botMessage: `I couldn't find any places in our database. Please tell me the specific place name you'd like to add, and I'll note it for our travel expert to review.`,
        intent,
      };
    }

    // AI로 최적의 아이템 선택
    const userRequest =
      intent.itemName || intent.category || 'a good place to visit';
    const selection = await this.itineraryAiService.selectBestItem({
      availableItems: candidateItems,
      userRequest,
      interests,
      context: `User wants to add "${intent.itemName || intent.category}" to their ${flow.region || 'Korea'} trip. If exact match not found, suggest the most similar/relevant place from the list.`,
    });

    if (!selection) {
      // AI 선택 실패 시 첫 번째 후보 사용
      const fallbackItem = candidateItems[0];
      return this.addItemToItinerary(
        flow,
        items,
        fallbackItem,
        intent,
        `I couldn't find "${intent.itemName}" exactly, but here's a similar place I recommend`,
      );
    }

    const selectedDbItem = candidateItems.find(
      (c) => c.id === selection.selectedId,
    );
    if (!selectedDbItem) {
      // 선택된 ID가 없으면 첫 번째 후보 사용
      const fallbackItem = candidateItems[0];
      return this.addItemToItinerary(
        flow,
        items,
        fallbackItem,
        intent,
        `I couldn't find "${intent.itemName}" exactly, but here's a similar place`,
      );
    }

    // 요청한 이름과 다른 아이템을 선택한 경우 처리
    const requestedName = (intent.itemName || '').toLowerCase();
    const selectedName = (selectedDbItem.nameEng || '').toLowerCase();
    const selectedNameKor = (selectedDbItem.nameKor || '').toLowerCase();

    // 일반적인 장소 타입 단어 (이것들만으로는 매칭 불가)
    const genericWords = [
      'palace',
      'temple',
      'market',
      'park',
      'tower',
      'village',
      'museum',
      'beach',
      'mountain',
      'restaurant',
      'cafe',
      'hotel',
      'street',
      'station',
    ];

    // 핵심 단어 추출 (일반 단어 제외, 3자 이상)
    const requestedWords = requestedName
      .split(/\s+/)
      .filter((w) => w.length > 2 && !genericWords.includes(w));
    const selectedWords = selectedName
      .split(/\s+/)
      .filter((w) => w.length > 2 && !genericWords.includes(w));

    // 핵심 단어가 있으면 그 중 하나가 반드시 매칭되어야 함
    const hasCoreWordMatch =
      requestedWords.length === 0 ||
      requestedWords.some(
        (rw) =>
          selectedName.includes(rw) ||
          selectedNameKor.includes(rw) ||
          selectedWords.some((sw) => sw.includes(rw) || rw.includes(sw)),
      );

    const isExactMatch =
      hasCoreWordMatch ||
      selectedName.includes(requestedName) ||
      requestedName.includes(selectedName) ||
      selectedNameKor.includes(requestedName) ||
      requestedName.includes(selectedNameKor);

    this.logger.log(
      `Name match check: requested="${requestedName}" (core: ${requestedWords.join(',')}), selected="${selectedName}" (core: ${selectedWords.join(',')}), hasCoreMatch=${hasCoreWordMatch}, isMatch=${isExactMatch}`,
    );

    // 정확히 일치하지 않고 사용자가 특정 장소명을 요청한 경우 → TBD로 저장
    if (!isExactMatch && intent.itemName && intent.itemName.length > 3) {
      this.logger.log(
        `No exact match for "${intent.itemName}", creating TBD item`,
      );
      return this.addTbdItemToItinerary(flow, items, intent.itemName, intent);
    }

    const messagePrefix = isExactMatch
      ? ''
      : `I couldn't find "${intent.itemName}" in our curated list, but I found a similar place: `;

    return this.addItemToItinerary(
      flow,
      items,
      selectedDbItem,
      intent,
      messagePrefix + selection.reason,
    );
  }

  /**
   * 아이템을 일정에 추가하는 헬퍼 메서드
   */
  private async addItemToItinerary(
    flow: FlowWithEstimate,
    items: EstimateItem[],
    dbItem: { id: number; type?: string; nameEng: string; nameKor: string; descriptionEng?: string | null; images?: unknown },
    intent: ModificationIntent,
    reason: string,
  ): Promise<{
    success: boolean;
    updatedItems: EstimateItem[];
    botMessage: string;
    intent: ModificationIntent;
  }> {
    // 지정된 일차 또는 마지막 일차에 추가
    const targetDay =
      intent.dayNumber || Math.max(...items.map((i) => i.dayNumber), 1);
    const dayItems = items.filter((i) => i.dayNumber === targetDay);
    const maxOrder = Math.max(...dayItems.map((i) => i.orderIndex), -1);

    const newItem: EstimateItem = {
      id: `ai-added-${Date.now()}`,
      type: dbItem.type || 'place',
      itemId: dbItem.id,
      itemName: dbItem.nameEng,
      name: dbItem.nameEng,
      nameEng: dbItem.nameEng,
      dayNumber: targetDay,
      orderIndex: maxOrder + 1,
      note: reason,
      itemInfo: {
        nameKor: dbItem.nameKor,
        nameEng: dbItem.nameEng,
        descriptionEng: dbItem.descriptionEng || undefined,
        images: normalizeImages(dbItem.images),
      },
    };

    const updatedItems = [...items, newItem];

    await this.prisma.estimate.update({
      where: { id: flow.estimateId! },
      data: { items: updatedItems as unknown as Prisma.InputJsonValue },
    });

    return {
      success: true,
      updatedItems,
      botMessage: `I've added "${dbItem.nameEng}" (${dbItem.nameKor}) to Day ${targetDay}! ${reason}`,
      intent,
    };
  }

  /**
   * TBD(To Be Determined) 아이템을 일정에 추가
   * - DB에 없는 장소를 사용자가 직접 요청한 경우
   * - 관리자가 나중에 실제 아이템과 매칭
   */
  private async addTbdItemToItinerary(
    flow: FlowWithEstimate,
    items: EstimateItem[],
    placeName: string,
    intent: ModificationIntent,
  ): Promise<{
    success: boolean;
    updatedItems: EstimateItem[];
    botMessage: string;
    intent: ModificationIntent;
  }> {
    // 지정된 일차 또는 마지막 일차에 추가
    const targetDay =
      intent.dayNumber || Math.max(...items.map((i) => i.dayNumber), 1);
    const dayItems = items.filter((i) => i.dayNumber === targetDay);
    const maxOrder = Math.max(...dayItems.map((i) => i.orderIndex), -1);

    const newItem: EstimateItem = {
      id: `tbd-${Date.now()}`,
      type: 'place',
      itemId: undefined, // DB 아이템 없음
      itemName: placeName,
      name: placeName,
      nameEng: placeName,
      dayNumber: targetDay,
      orderIndex: maxOrder + 1,
      isTbd: true, // TBD 플래그
      note: `Requested by customer. Our travel expert will find the best option for "${placeName}".`,
    };

    const updatedItems = [...items, newItem];

    await this.prisma.estimate.update({
      where: { id: flow.estimateId! },
      data: { items: updatedItems as unknown as Prisma.InputJsonValue },
    });

    return {
      success: true,
      updatedItems,
      botMessage: `I've noted "${placeName}" for Day ${targetDay}. Our travel expert will review this and find the best option for you. In the meantime, feel free to continue customizing your itinerary!`,
      intent,
    };
  }

  private async handleRemoveItem(
    flow: FlowWithEstimate,
    intent: ModificationIntent,
  ): Promise<{
    success: boolean;
    updatedItems: EstimateItem[];
    botMessage: string;
    intent: ModificationIntent;
  }> {
    const items = (flow.estimate.items as EstimateItem[]) || [];

    if (!intent.itemName && !intent.category) {
      return {
        success: false,
        updatedItems: items,
        botMessage:
          'What would you like to remove? Please specify the place name or category.',
        intent,
      };
    }

    let updatedItems: EstimateItem[];
    let removedCount = 0;

    if (intent.itemName) {
      // 이름으로 제거
      const itemNameLower = intent.itemName.toLowerCase();
      updatedItems = items.filter((i) => {
        const name = (i.itemName || i.name || '').toLowerCase();
        const shouldRemove = name.includes(itemNameLower);
        if (shouldRemove) removedCount++;
        return !shouldRemove;
      });
    } else if (intent.category) {
      // 카테고리로 제거 (type 기반)
      const categoryLower = intent.category.toLowerCase();
      updatedItems = items.filter((i) => {
        const type = (i.type || '').toLowerCase();
        const name = (i.itemName || i.name || '').toLowerCase();
        const shouldRemove =
          type.includes(categoryLower) || name.includes(categoryLower);
        if (shouldRemove) removedCount++;
        return !shouldRemove;
      });
    } else {
      updatedItems = items;
    }

    if (removedCount === 0) {
      return {
        success: false,
        updatedItems: items,
        botMessage: `I couldn't find any items matching "${intent.itemName || intent.category}" to remove.`,
        intent,
      };
    }

    await this.prisma.estimate.update({
      where: { id: flow.estimateId! },
      data: { items: updatedItems as unknown as Prisma.InputJsonValue },
    });

    return {
      success: true,
      updatedItems,
      botMessage: `I've removed ${removedCount} item(s) from your itinerary. Anything else you'd like to change?`,
      intent,
    };
  }

  private async handleReplaceItem(
    flow: FlowWithEstimate,
    intent: ModificationIntent,
  ): Promise<{
    success: boolean;
    updatedItems: EstimateItem[];
    botMessage: string;
    intent: ModificationIntent;
  }> {
    const items = (flow.estimate.items as EstimateItem[]) || [];

    if (!intent.itemName) {
      return {
        success: false,
        updatedItems: items,
        botMessage:
          'Which place would you like to replace? Please tell me the name.',
        intent,
      };
    }

    // 교체할 아이템 찾기
    const itemNameLower = intent.itemName.toLowerCase();
    const itemIndex = items.findIndex((i) => {
      const name = (i.itemName || i.name || '').toLowerCase();
      return name.includes(itemNameLower);
    });

    if (itemIndex === -1) {
      return {
        success: false,
        updatedItems: items,
        botMessage: `I couldn't find "${intent.itemName}" in your itinerary.`,
        intent,
      };
    }

    const itemToReplace = items[itemIndex];
    const interests = [
      ...(flow.interestMain || []),
      ...(flow.interestSub || []),
    ];
    const existingItemIds = items
      .filter((i) => i.itemId)
      .map((i) => i.itemId as number);

    // DB에서 대체 후보 아이템 검색
    const candidateItems = await this.itemService.findSimilarItems({
      categories: intent.category ? [intent.category] : undefined,
      interests,
      region: flow.region || undefined,
      type: 'place',
      excludeIds: existingItemIds,
      limit: 15,
    });

    if (candidateItems.length === 0) {
      return {
        success: false,
        updatedItems: items,
        botMessage: `I couldn't find replacement candidates in our database. Could you specify what type of place you'd prefer?`,
        intent,
      };
    }

    // AI로 최적의 대체 아이템 선택
    const selection = await this.itineraryAiService.selectBestItem({
      availableItems: candidateItems,
      userRequest: `Replace "${itemToReplace.itemName || itemToReplace.name}" with something similar or better`,
      interests,
      context: intent.category
        ? `User prefers ${intent.category} category`
        : undefined,
    });

    if (!selection) {
      return {
        success: false,
        updatedItems: items,
        botMessage: `I couldn't find a good replacement. Could you suggest what type of place you'd prefer?`,
        intent,
      };
    }

    const selectedDbItem = candidateItems.find(
      (c) => c.id === selection.selectedId,
    );
    if (!selectedDbItem) {
      return {
        success: false,
        updatedItems: items,
        botMessage: `Something went wrong selecting the replacement. Please try again.`,
        intent,
      };
    }

    // 아이템 교체
    const updatedItems = [...items];
    updatedItems[itemIndex] = {
      ...itemToReplace,
      id: `ai-replaced-${Date.now()}`,
      itemId: selectedDbItem.id,
      itemName: selectedDbItem.nameEng,
      name: selectedDbItem.nameEng,
      nameEng: selectedDbItem.nameEng,
      note: selection.reason,
      itemInfo: {
        nameKor: selectedDbItem.nameKor,
        nameEng: selectedDbItem.nameEng,
        descriptionEng: selectedDbItem.descriptionEng || undefined,
        images: normalizeImages(selectedDbItem.images),
      },
    };

    await this.prisma.estimate.update({
      where: { id: flow.estimateId! },
      data: { items: updatedItems as unknown as Prisma.InputJsonValue },
    });

    return {
      success: true,
      updatedItems,
      botMessage: `I've replaced "${itemToReplace.itemName || itemToReplace.name}" with "${selectedDbItem.nameEng}". ${selection.reason}`,
      intent,
    };
  }

  private getPositiveFeedbackResponse(): string {
    const responses = [
      "Great! I'm glad you like it. When you're ready, click 'Send to Expert' to have our travel specialist finalize your itinerary.",
      "Awesome! If you're happy with the itinerary, you can send it to our expert for final touches.",
      "Perfect! Let me know if you'd like any changes, or send it to our expert when you're ready.",
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  }

  /**
   * 여행 도우미 대화 - 질문 답변 및 일정 수정 통합
   */
  async chat(
    sessionId: string,
    userMessage: string,
    conversationHistory?: Array<{
      role: 'user' | 'assistant';
      content: string;
    }>,
  ): Promise<{
    response: string;
    intent: 'question' | 'modification' | 'feedback' | 'other';
    updatedItems?: EstimateItem[];
    modificationSuccess?: boolean;
  }> {
    const flow = await this.prisma.chatbotFlow.findUnique({
      where: { sessionId },
    });

    if (!flow) {
      throw new NotFoundException('Session not found.');
    }

    // 컨텍스트 구성
    const context: {
      tripDates?: { start: string; end: string };
      region?: string;
      interests?: string[];
      currentItinerary?: Array<{
        dayNumber: number;
        name: string;
        type: string;
      }>;
    } = {};

    if (flow.travelDate && flow.duration) {
      const startDate = new Date(flow.travelDate);
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + flow.duration - 1);
      context.tripDates = {
        start: startDate.toISOString().split('T')[0],
        end: endDate.toISOString().split('T')[0],
      };
    }
    if (flow.region) {
      context.region = flow.region;
    }
    const interests = [
      ...(flow.interestMain || []),
      ...(flow.interestSub || []),
    ];
    if (interests.length > 0) {
      context.interests = interests;
    }

    // 견적이 있으면 현재 일정 추가 (수정 분기에서도 재사용하므로 전체 조회)
    let estimateRecord: { id: number; items: unknown } | null = null;
    if (flow.estimateId) {
      estimateRecord = await this.prisma.estimate.findUnique({
        where: { id: flow.estimateId! },
      });

      if (estimateRecord?.items) {
        const items = estimateRecord.items as unknown as EstimateItem[];
        context.currentItinerary = items.map((item) => ({
          dayNumber: item.dayNumber,
          name: item.itemName || item.name || item.nameEng || 'Unknown',
          type: item.type,
        }));
      }
    }

    // AI로 대화 응답 생성
    const aiResult = await this.travelAssistantService.chat({
      userMessage,
      context,
      conversationHistory,
    });

    // 수정 의도가 감지되면 실제 수정 수행
    if (
      aiResult.intent === 'modification' &&
      flow.estimateId &&
      aiResult.modificationData
    ) {
      try {
        const modResult = await this.modifyItinerary(
          sessionId,
          userMessage,
          aiResult.modificationData,
          estimateRecord ? { flow, estimate: estimateRecord } : undefined,
        );
        this.logger.log(
          `Modification result: success=${modResult.success}, itemCount=${modResult.updatedItems?.length}`,
        );
        return {
          response: modResult.botMessage,
          intent: 'modification',
          updatedItems: modResult.updatedItems,
          modificationSuccess: modResult.success,
        };
      } catch (e) {
        this.logger.warn('Modification failed, returning AI response', e);
        return {
          response: aiResult.response,
          intent: aiResult.intent,
        };
      }
    }

    return {
      response: aiResult.response,
      intent: aiResult.intent,
    };
  }
}
