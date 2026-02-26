import { Injectable, Logger } from '@nestjs/common';
import { GeminiCoreService } from '../core/gemini-core.service';
import { extractJsonAndText } from '../core/response-parser.util';
import {
  buildContextInfo,
  TravelAssistantContext,
} from '../prompts/conversation.prompts';
import { AiPromptService } from '../../ai-prompt/ai-prompt.service';
import { PromptKey } from '../../ai-prompt/prompt-registry';

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

@Injectable()
export class TravelAssistantService {
  private readonly logger = new Logger(TravelAssistantService.name);

  constructor(
    private geminiCore: GeminiCoreService,
    private aiPromptService: AiPromptService,
  ) {}

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
    const built = await this.aiPromptService.buildPrompt(
      PromptKey.TRAVEL_ASSISTANT,
      {
        contextInfo: contextInfo
          ? `\nUser's trip context:\n${contextInfo}`
          : '',
      },
    );

    const history = conversationHistory?.map((msg) => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }],
    }));

    const text = await this.geminiCore.callGemini(userMessage, {
      temperature: built.temperature,
      maxOutputTokens: built.maxOutputTokens,
      systemPrompt: built.text,
      history,
    });

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
}
