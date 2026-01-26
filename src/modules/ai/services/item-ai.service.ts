import { Injectable, Logger } from '@nestjs/common';
import { GeminiCoreService } from '../core/gemini-core.service';
import { parseJsonResponse } from '../core/response-parser.util';
import {
  ITEM_CONTENT_PROMPT,
  ITEM_CONTENT_CONFIG,
  ITEM_TYPE_LABELS,
  ItemContentParams,
} from '../prompts/item.prompts';

export interface ItemContentResult {
  keyword: string;
  description: string;
  descriptionEng: string;
}

@Injectable()
export class ItemAiService {
  private readonly logger = new Logger(ItemAiService.name);

  constructor(private geminiCore: GeminiCoreService) {}

  /**
   * 아이템 컨텐츠 생성 (DB 업데이트 없이 결과만 반환)
   */
  async generateItemContent(params: {
    nameKor: string;
    nameEng: string;
    itemType: string;
  }): Promise<ItemContentResult | null> {
    const { nameKor, nameEng, itemType } = params;
    const typeLabel = ITEM_TYPE_LABELS[itemType] || itemType;

    const promptParams: ItemContentParams = {
      nameKor,
      nameEng,
      typeLabel,
    };

    const prompt = ITEM_CONTENT_PROMPT(promptParams);

    const text = await this.geminiCore.callGemini(prompt, ITEM_CONTENT_CONFIG);

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
