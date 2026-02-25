import { Injectable, Logger } from '@nestjs/common';
import { GeminiCoreService } from '../core/gemini-core.service';
import { parseJsonResponse } from '../core/response-parser.util';
import { AiPromptService } from '../../ai-prompt/ai-prompt.service';
import { PromptKey } from '../../ai-prompt/prompt-registry';
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

  constructor(
    private geminiCore: GeminiCoreService,
    private aiPromptService: AiPromptService,
  ) {}

  async parseModificationIntent(params: {
    userMessage: string;
    currentItinerary: Array<{ dayNumber: number; name: string; category: string }>;
    interests?: string[];
    region?: string;
  }): Promise<ModificationIntent> {
    const { userMessage, currentItinerary, interests, region } = params;

    const itineraryText = currentItinerary
      .map((item) => `Day ${item.dayNumber}: ${item.name} (${item.category})`)
      .join('\n');

    const built = await this.aiPromptService.buildPrompt(
      PromptKey.MODIFICATION_INTENT,
      {
        itineraryText,
        interests: interests?.join(', ') || 'Not specified',
        region: region || 'Not specified',
        userMessage,
      },
    );

    const text = await this.geminiCore.callGemini(built.text, {
      temperature: built.temperature,
      maxOutputTokens: built.maxOutputTokens,
    });

    const defaultResult: ModificationIntent = {
      action: 'general_feedback',
      confidence: 0.5,
      explanation: 'Could not parse user intent',
    };

    return parseJsonResponse(text, defaultResult);
  }

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

    const built = await this.aiPromptService.buildPrompt(
      PromptKey.SELECT_BEST_ITEM,
      {
        itemList,
        userRequest,
        interests: interests.join(', '),
        context: context ? `Context: ${context}` : '',
      },
    );

    const text = await this.geminiCore.callGemini(built.text, {
      temperature: built.temperature,
      maxOutputTokens: built.maxOutputTokens,
    });

    return parseJsonResponse(text, null);
  }

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

    const built = await this.aiPromptService.buildPrompt(
      PromptKey.SELECT_MULTIPLE_ITEMS,
      {
        dayNumber: String(dayNumber),
        region,
        interests: interests.join(', '),
        count: String(count),
        itemList,
      },
    );

    const text = await this.geminiCore.callGemini(built.text, {
      temperature: built.temperature,
      maxOutputTokens: built.maxOutputTokens,
    });

    return parseJsonResponse(text, []);
  }

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
      .map((item) => `- ${item.name} (${item.category})`)
      .join('\n');

    const built = await this.aiPromptService.buildPrompt(
      PromptKey.DAY_TIMELINE,
      { dayNumber: String(dayNumber), itemList },
    );

    const text = await this.geminiCore.callGemini(built.text, {
      temperature: built.temperature,
      maxOutputTokens: built.maxOutputTokens,
      disableThinking: true,
    });

    if (text.trim()) {
      return { success: true, timeline: text.trim() };
    }

    return { success: false, timeline: '' };
  }
}
