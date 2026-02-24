import { Injectable, Logger } from '@nestjs/common';
import { GeminiCoreService } from '../core/gemini-core.service';
import { parseJsonResponse } from '../core/response-parser.util';
import { ITEM_TYPE_LABELS } from '../prompts/item.prompts';
import { AiPromptService } from '../../ai-prompt/ai-prompt.service';
import { PromptKey } from '../../ai-prompt/prompt-registry';

export interface ItemContentResult {
  keyword: string;
  description: string;
  descriptionEng: string;
}

@Injectable()
export class ItemAiService {
  private readonly logger = new Logger(ItemAiService.name);

  constructor(
    private geminiCore: GeminiCoreService,
    private aiPromptService: AiPromptService,
  ) {}

  async translateAndFillMissing(params: {
    description: string;
    nameKor: string;
    nameEng: string;
    missingKeyword: boolean;
  }): Promise<Partial<ItemContentResult> | null> {
    const { description, nameKor, nameEng, missingKeyword } = params;

    const keywordInstruction = missingKeyword
      ? `\n  "keyword": "5-8 comma-separated keywords in English (e.g. Seoul, palace, history, culture, photo spot)",`
      : '';

    const prompt = `You are a Korea travel content translator. Translate the following Korean description to English.
Keep the tone friendly and informative for foreign tourists. Preserve brand names and proper nouns as-is.

Item name (Korean): ${nameKor}
Item name (English): ${nameEng || 'N/A'}

Korean description:
${description}

Respond ONLY with valid JSON:
{${keywordInstruction}
  "descriptionEng": "English translation of the Korean description above"
}`;

    const text = await this.geminiCore.callGemini(prompt, {
      temperature: 0.3,
      maxOutputTokens: 65536,
    });

    const result = parseJsonResponse<Partial<ItemContentResult>>(text, {
      keyword: '',
      descriptionEng: '',
    });

    if (result.descriptionEng) {
      return result;
    }

    return null;
  }

  async generateItemContent(params: {
    nameKor: string;
    nameEng: string;
    itemType: string;
  }): Promise<ItemContentResult | null> {
    const { nameKor, nameEng, itemType } = params;
    const typeLabel = ITEM_TYPE_LABELS[itemType] || itemType;

    const built = await this.aiPromptService.buildPrompt(
      PromptKey.ITEM_CONTENT,
      { typeLabel, nameKor, nameEng: nameEng || '없음' },
    );

    const text = await this.geminiCore.callGemini(built.text, {
      temperature: built.temperature,
      maxOutputTokens: built.maxOutputTokens,
    });

    const result = parseJsonResponse<ItemContentResult>(text, {
      keyword: '',
      description: '',
      descriptionEng: '',
    });

    if (result.keyword || result.description || result.descriptionEng) {
      return result;
    }

    return null;
  }
}
