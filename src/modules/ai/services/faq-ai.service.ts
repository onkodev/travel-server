import { Injectable, Logger } from '@nestjs/common';
import { GeminiCoreService } from '../core/gemini-core.service';
import { parseJsonResponse } from '../core/response-parser.util';
import {
  FAQ_EXTRACTION_PROMPT,
  FAQ_EXTRACTION_CONFIG,
  FaqExtractionParams,
} from '../prompts/faq.prompts';

export interface ExtractedFaqItem {
  question: string;
  answer: string;
  questionKo?: string;
  answerKo?: string;
  tags: string[];
  confidence: number;
  category: string;
  questionSource?: string;
  answerSource?: string;
}

@Injectable()
export class FaqAiService {
  private readonly logger = new Logger(FaqAiService.name);

  constructor(private geminiCore: GeminiCoreService) {}

  /**
   * 이메일 내용에서 FAQ Q&A 추출
   */
  async extractFaqFromEmail(params: FaqExtractionParams): Promise<ExtractedFaqItem[]> {
    const prompt = FAQ_EXTRACTION_PROMPT(params);

    try {
      const text = await this.geminiCore.callGemini(prompt, FAQ_EXTRACTION_CONFIG);
      const result = parseJsonResponse<ExtractedFaqItem[]>(text, []);

      // 유효성 검사: question과 answer가 있는 항목만 반환
      return result.filter(
        (item) =>
          item.question &&
          item.answer &&
          typeof item.question === 'string' &&
          typeof item.answer === 'string' &&
          item.question.length > 0 &&
          item.answer.length > 0,
      );
    } catch (error) {
      this.logger.error('FAQ 추출 실패:', error);
      return [];
    }
  }
}
