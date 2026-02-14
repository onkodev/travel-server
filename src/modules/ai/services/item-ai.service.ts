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
