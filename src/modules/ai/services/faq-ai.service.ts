import { Injectable, Logger } from '@nestjs/common';
import { GeminiCoreService } from '../core/gemini-core.service';
import { parseJsonResponse } from '../core/response-parser.util';
import { AiPromptService } from '../../ai-prompt/ai-prompt.service';
import { PromptKey } from '../../ai-prompt/prompt-registry';

export interface ExtractedFaqItem {
  question: string;
  questionKo?: string;
  tags: string[];
  category: string;
  questionSource?: string;
  answerSource?: string;
}

@Injectable()
export class FaqAiService {
  private readonly logger = new Logger(FaqAiService.name);

  constructor(
    private geminiCore: GeminiCoreService,
    private aiPromptService: AiPromptService,
  ) {}

  async extractFaqFromEmail(params: {
    subject: string;
    emailBody: string;
  }): Promise<ExtractedFaqItem[]> {
    const built = await this.aiPromptService.buildPrompt(
      PromptKey.FAQ_EXTRACTION,
      {
        subject: params.subject || '(No subject)',
        emailBody: params.emailBody,
      },
    );

    try {
      const text = await this.geminiCore.callGemini(built.text, {
        temperature: built.temperature,
        maxOutputTokens: built.maxOutputTokens,
      });
      const parsed = parseJsonResponse<ExtractedFaqItem[]>(text, []);
      const result = Array.isArray(parsed) ? parsed : [];

      return result.filter(
        (item) =>
          item.question &&
          typeof item.question === 'string' &&
          item.question.length > 0,
      );
    } catch (error) {
      this.logger.error('FAQ 추출 실패:', error);
      return [];
    }
  }
}
