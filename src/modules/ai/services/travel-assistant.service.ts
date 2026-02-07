import { Injectable, Logger } from '@nestjs/common';
import { GeminiCoreService } from '../core/gemini-core.service';
import {
  parseJsonResponse,
  extractJsonAndText,
} from '../core/response-parser.util';
import {
  TRAVEL_ASSISTANT_SYSTEM_PROMPT,
  TRAVEL_ASSISTANT_CONFIG,
  RANK_RECOMMENDATIONS_PROMPT,
  RANK_RECOMMENDATIONS_CONFIG,
  buildContextInfo,
  TravelAssistantContext,
  RankRecommendationsParams,
} from '../prompts/conversation.prompts';
import { AvailableItem } from '../types';

export interface ChatResponse {
  response: string;
  intent: 'question' | 'modification' | 'feedback' | 'other';
  modificationData?: {
    action: string;
    dayNumber?: number;
    itemName?: string;
    category?: string;
  };
}

export interface RankedItem {
  id: number;
  name: string;
  reason: string;
}

@Injectable()
export class TravelAssistantService {
  private readonly logger = new Logger(TravelAssistantService.name);

  constructor(private geminiCore: GeminiCoreService) {}

  /**
   * 여행 도우미 대화형 응답 생성
   */
  async chat(params: {
    userMessage: string;
    context?: TravelAssistantContext;
    conversationHistory?: Array<{
      role: 'user' | 'assistant';
      content: string;
    }>;
  }): Promise<ChatResponse> {
    const { userMessage, context, conversationHistory } = params;

    const contextInfo = buildContextInfo(context);
    const systemPrompt = TRAVEL_ASSISTANT_SYSTEM_PROMPT({ contextInfo });

    // 대화 기록을 Gemini 형식으로 변환
    const history = conversationHistory?.map((msg) => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }],
    }));

    const text = await this.geminiCore.callGemini(userMessage, {
      ...TRAVEL_ASSISTANT_CONFIG,
      systemPrompt,
      history,
    });

    // 응답과 JSON 분리
    const { textContent, jsonContent } = extractJsonAndText(text);

    const response = textContent || text;
    let intent: 'question' | 'modification' | 'feedback' | 'other' = 'other';
    let modificationData: ChatResponse['modificationData'] = undefined;

    if (jsonContent && typeof jsonContent === 'object') {
      const parsed = jsonContent as {
        intent?: string;
        modificationData?: ChatResponse['modificationData'];
      };
      intent = (parsed.intent as ChatResponse['intent']) || 'other';
      if (parsed.modificationData) {
        modificationData = parsed.modificationData;
      }
    }

    return { response, intent, modificationData };
  }

  /**
   * 장소 추천 (사용자에게 보여줄 추천 목록 생성)
   */
  async rankRecommendations(params: {
    availableItems: AvailableItem[];
    userRequest: string;
    interests: string[];
    limit: number;
  }): Promise<RankedItem[]> {
    const { availableItems, userRequest, interests, limit } = params;

    if (availableItems.length === 0) return [];

    const itemList = availableItems
      .map(
        (i) =>
          `[ID:${i.id}] ${i.nameEng}${i.keyword ? ` | ${i.keyword}` : ''}${i.descriptionEng ? ` | ${i.descriptionEng.slice(0, 100)}` : ''}`,
      )
      .join('\n');

    const promptParams: RankRecommendationsParams = {
      itemList,
      userRequest,
      interests: interests.join(', '),
      limit,
    };

    const prompt = RANK_RECOMMENDATIONS_PROMPT(promptParams);
    const text = await this.geminiCore.callGemini(
      prompt,
      RANK_RECOMMENDATIONS_CONFIG,
    );

    return parseJsonResponse(text, []);
  }
}
