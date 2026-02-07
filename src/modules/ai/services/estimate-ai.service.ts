import { Injectable, Logger } from '@nestjs/common';
import { GeminiCoreService } from '../core/gemini-core.service';
import { parseJsonResponse } from '../core/response-parser.util';
import {
  ESTIMATE_ANALYSIS_PROMPT,
  ESTIMATE_ANALYSIS_CONFIG,
  EstimateAnalysisParams,
} from '../prompts/estimate.prompts';
import { EstimateItemForAnalysis } from '../types';

// Re-export for backward compatibility
export type { EstimateItemForAnalysis };

export interface EstimateAnalysisResult {
  regions: string[];
  interests: string[];
  keywords: string[];
  groupType: string | null;
  budgetLevel: string | null;
  specialNeeds: string[];
}

@Injectable()
export class EstimateAiService {
  private readonly logger = new Logger(EstimateAiService.name);

  constructor(private geminiCore: GeminiCoreService) {}

  /**
   * 견적 분석 (DB 업데이트 없이 결과만 반환)
   */
  async analyzeEstimate(params: {
    requestContent: string | null;
    items: EstimateItemForAnalysis[];
  }): Promise<EstimateAnalysisResult | null> {
    const { requestContent, items } = params;

    // 아이템 정보 요약
    const itemsSummary =
      items.length > 0
        ? items
            .map(
              (item) =>
                `- ${item.name} (${item.type}${item.region ? `, ${item.region}` : ''})`,
            )
            .join('\n')
        : '아이템 없음';

    const promptParams: EstimateAnalysisParams = {
      requestContent,
      itemsSummary,
    };

    const prompt = ESTIMATE_ANALYSIS_PROMPT(promptParams);

    const text = await this.geminiCore.callGemini(
      prompt,
      ESTIMATE_ANALYSIS_CONFIG,
    );

    interface ParsedResult {
      regions?: string[];
      interests?: string[];
      keywords?: string[];
      groupType?: string | null;
      budgetLevel?: string | null;
      specialNeeds?: string[];
    }

    const result = parseJsonResponse<ParsedResult | null>(text, null);

    if (result) {
      return {
        regions: result.regions || [],
        interests: result.interests || [],
        keywords: result.keywords || [],
        groupType: result.groupType || null,
        budgetLevel: result.budgetLevel || null,
        specialNeeds: result.specialNeeds || [],
      };
    }

    return null;
  }
}
