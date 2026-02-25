import { Injectable, Logger } from '@nestjs/common';
import { GeminiCoreService } from '../core/gemini-core.service';
import { parseJsonResponse } from '../core/response-parser.util';
import { AiPromptService } from '../../ai-prompt/ai-prompt.service';
import { PromptKey } from '../../ai-prompt/prompt-registry';
import { EstimateItemForAnalysis } from '../types';

// Re-export for backward compatibility
export type { EstimateItemForAnalysis };

export interface EstimateAnalysisResult {
  regions: string[];
  interests: string[];
  keywords: string[];
  tourType: string | null;
  travelerType: string | null;
  priceRange: string | null;
  specialNeeds: string[];
}

@Injectable()
export class EstimateAiService {
  private readonly logger = new Logger(EstimateAiService.name);

  constructor(
    private geminiCore: GeminiCoreService,
    private aiPromptService: AiPromptService,
  ) {}

  /**
   * 견적 분석 (DB 업데이트 없이 결과만 반환)
   */
  async analyzeEstimate(params: {
    requestContent: string | null;
    items: EstimateItemForAnalysis[];
  }): Promise<EstimateAnalysisResult | null> {
    const { requestContent, items } = params;

    const itemsSummary =
      items.length > 0
        ? items
            .map(
              (item) =>
                `- ${item.name} (${item.category}${item.region ? `, ${item.region}` : ''})`,
            )
            .join('\n')
        : '아이템 없음';

    const built = await this.aiPromptService.buildPrompt(
      PromptKey.ESTIMATE_ANALYSIS,
      {
        requestContent: requestContent || '내용 없음',
        itemsSummary,
      },
    );

    const text = await this.geminiCore.callGemini(built.text, {
      temperature: built.temperature,
      maxOutputTokens: built.maxOutputTokens,
      disableThinking: true,
    });

    interface ParsedResult {
      regions?: string[];
      interests?: string[];
      keywords?: string[];
      tourType?: string | null;
      travelerType?: string | null;
      budgetLevel?: string | null;
      specialNeeds?: string[];
    }

    const result = parseJsonResponse<ParsedResult | null>(text, null);

    if (result) {
      // budgetLevel → priceRange 매핑 (luxury → premium)
      const priceRange =
        result.budgetLevel === 'luxury'
          ? 'premium'
          : result.budgetLevel || null;

      return {
        regions: result.regions || [],
        interests: result.interests || [],
        keywords: result.keywords || [],
        tourType: result.tourType || null,
        travelerType: result.travelerType || null,
        priceRange,
        specialNeeds: result.specialNeeds || [],
      };
    }

    return null;
  }
}
