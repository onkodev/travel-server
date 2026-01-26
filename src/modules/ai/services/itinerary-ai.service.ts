import { Injectable, Logger } from '@nestjs/common';
import { GeminiCoreService } from '../core/gemini-core.service';
import { parseJsonResponse } from '../core/response-parser.util';
import {
  MODIFICATION_INTENT_PROMPT,
  MODIFICATION_INTENT_CONFIG,
  SELECT_BEST_ITEM_PROMPT,
  SELECT_BEST_ITEM_CONFIG,
  SELECT_MULTIPLE_ITEMS_PROMPT,
  SELECT_MULTIPLE_ITEMS_CONFIG,
  DAY_TIMELINE_PROMPT,
  DAY_TIMELINE_CONFIG,
  ModificationIntentParams,
  SelectBestItemParams,
  SelectMultipleItemsParams,
  DayTimelineParams,
} from '../prompts/itinerary.prompts';
import { AvailableItem, TimelineItem } from '../types';

export interface ModificationIntent {
  action:
    | 'regenerate_day'
    | 'add_item'
    | 'remove_item'
    | 'replace_item'
    | 'general_feedback';
  dayNumber?: number;
  itemName?: string;
  category?: string;
  confidence: number;
  explanation?: string;
}

export interface SelectedItem {
  selectedId: number;
  reason: string;
}

// Re-export types for backward compatibility
export type { AvailableItem, TimelineItem };

@Injectable()
export class ItineraryAiService {
  private readonly logger = new Logger(ItineraryAiService.name);

  constructor(private geminiCore: GeminiCoreService) {}

  /**
   * 일정 수정 의도 파싱
   */
  async parseModificationIntent(params: {
    userMessage: string;
    currentItinerary: Array<{ dayNumber: number; name: string; type: string }>;
    interests?: string[];
    region?: string;
  }): Promise<ModificationIntent> {
    const { userMessage, currentItinerary, interests, region } = params;

    const itineraryText = currentItinerary
      .map((item) => `Day ${item.dayNumber}: ${item.name} (${item.type})`)
      .join('\n');

    const promptParams: ModificationIntentParams = {
      itineraryText,
      interests: interests?.join(', ') || 'Not specified',
      region: region || 'Not specified',
      userMessage,
    };

    const prompt = MODIFICATION_INTENT_PROMPT(promptParams);
    const text = await this.geminiCore.callGemini(
      prompt,
      MODIFICATION_INTENT_CONFIG,
    );

    const defaultResult: ModificationIntent = {
      action: 'general_feedback',
      confidence: 0.5,
      explanation: 'Could not parse user intent',
    };

    return parseJsonResponse(text, defaultResult);
  }

  /**
   * DB Item 목록에서 최적의 아이템 선택
   */
  async selectBestItem(params: {
    availableItems: AvailableItem[];
    userRequest: string;
    interests: string[];
    context?: string;
  }): Promise<SelectedItem | null> {
    const { availableItems, userRequest, interests, context } = params;

    if (availableItems.length === 0) return null;

    const itemList = availableItems
      .map(
        (i) =>
          `[ID:${i.id}] ${i.nameEng}${i.keyword ? ` | Keywords: ${i.keyword}` : ''}${i.categories?.length ? ` | Categories: ${i.categories.join(', ')}` : ''}`,
      )
      .join('\n');

    const promptParams: SelectBestItemParams = {
      itemList,
      userRequest,
      interests: interests.join(', '),
      context,
    };

    const prompt = SELECT_BEST_ITEM_PROMPT(promptParams);
    const text = await this.geminiCore.callGemini(
      prompt,
      SELECT_BEST_ITEM_CONFIG,
    );

    return parseJsonResponse(text, null);
  }

  /**
   * DB Item 목록에서 여러 아이템 선택 (일차 재생성용)
   */
  async selectMultipleItems(params: {
    availableItems: AvailableItem[];
    count: number;
    interests: string[];
    dayNumber: number;
    region: string;
  }): Promise<SelectedItem[]> {
    const { availableItems, count, interests, dayNumber, region } = params;

    if (availableItems.length === 0) return [];

    const itemList = availableItems
      .map(
        (i) =>
          `[ID:${i.id}] ${i.nameEng}${i.keyword ? ` | ${i.keyword}` : ''}${i.categories?.length ? ` | ${i.categories.join(', ')}` : ''}`,
      )
      .join('\n');

    const promptParams: SelectMultipleItemsParams = {
      itemList,
      count,
      interests: interests.join(', '),
      dayNumber,
      region,
    };

    const prompt = SELECT_MULTIPLE_ITEMS_PROMPT(promptParams);
    const text = await this.geminiCore.callGemini(
      prompt,
      SELECT_MULTIPLE_ITEMS_CONFIG,
    );

    return parseJsonResponse(text, []);
  }

  /**
   * 단일 일차 타임라인 생성
   */
  async generateDayTimeline(params: {
    dayNumber: number;
    items: TimelineItem[];
  }): Promise<{ success: boolean; timeline: string }> {
    const { dayNumber, items } = params;

    if (!items || items.length === 0) {
      return { success: false, timeline: '' };
    }

    const sortedItems = [...items].sort((a, b) => a.order - b.order);
    const itemList = sortedItems
      .map((item) => `- ${item.name} (${item.type})`)
      .join('\n');

    const promptParams: DayTimelineParams = {
      dayNumber,
      itemList,
    };

    const prompt = DAY_TIMELINE_PROMPT(promptParams);
    const text = await this.geminiCore.callGemini(prompt, DAY_TIMELINE_CONFIG);

    if (text.trim()) {
      return { success: true, timeline: text.trim() };
    }

    return { success: false, timeline: '' };
  }
}
