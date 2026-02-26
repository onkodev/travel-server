import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface GeminiCallOptions {
  temperature?: number;
  maxOutputTokens?: number;
  systemPrompt?: string;
  history?: Array<{ role: string; parts: Array<{ text: string }> }>;
  signal?: AbortSignal;
  /** thinking 비활성화 (JSON 구조화 출력 등 추론 불필요 시) */
  disableThinking?: boolean;
  /** Gemini 모델명 오버라이드 (미지정 시 기본 모델 사용) */
  model?: string;
}

@Injectable()
export class GeminiCoreService {
  private readonly logger = new Logger(GeminiCoreService.name);
  private apiKey: string;
  private static readonly DEFAULT_MODEL = 'gemini-2.5-flash';
  private static readonly API_BASE =
    'https://generativelanguage.googleapis.com/v1beta/models';

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('GEMINI_API_KEY') || '';
  }

  private static readonly MAX_RETRIES = 5;
  private static readonly BASE_DELAY_MS = 2000;

  /**
   * Gemini API 호출 공통 메서드 (429 자동 재시도 포함)
   */
  async callGemini(
    prompt: string,
    options?: GeminiCallOptions,
  ): Promise<string> {
    if (!this.apiKey) {
      throw new BadRequestException('Gemini API key is not configured');
    }

    const model = options?.model || GeminiCoreService.DEFAULT_MODEL;
    const apiUrl = `${GeminiCoreService.API_BASE}/${model}:generateContent`;

    const generationConfig: Record<string, unknown> = {
      temperature: options?.temperature ?? 0.7,
    };
    if (options?.maxOutputTokens) {
      generationConfig.maxOutputTokens = options.maxOutputTokens;
    }

    // 2.5 모델의 thinking 비활성화 (구조화 출력 시 불필요한 추론 오버헤드 제거)
    if (options?.disableThinking) {
      generationConfig.thinkingConfig = { thinkingBudget: 0 };
    }

    const body: Record<string, unknown> = {
      contents: options?.history
        ? [...options.history, { role: 'user', parts: [{ text: prompt }] }]
        : [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig,
    };

    if (options?.systemPrompt) {
      body.systemInstruction = { parts: [{ text: options.systemPrompt }] };
    }

    for (let attempt = 0; attempt <= GeminiCoreService.MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': this.apiKey,
          },
          body: JSON.stringify(body),
          signal: options?.signal,
        });

        if (response.status === 429) {
          if (attempt < GeminiCoreService.MAX_RETRIES) {
            const delay =
              GeminiCoreService.BASE_DELAY_MS * Math.pow(2, attempt) +
              Math.random() * 1000;
            this.logger.warn(
              `Gemini 429 레이트 리밋, ${Math.round(delay / 1000)}초 후 재시도 (${attempt + 1}/${GeminiCoreService.MAX_RETRIES})`,
            );
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
          const errorBody = await response.text();
          this.logger.error(`Gemini 429 최대 재시도 초과: ${errorBody}`);
          throw new BadRequestException('API 레이트 리밋 초과');
        }

        if (!response.ok) {
          const errorBody = await response.text();
          this.logger.error(
            `Gemini API error: ${response.status} ${errorBody}`,
          );
          throw new BadRequestException('AI 응답 생성 실패');
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!text) {
          this.logger.error(`Empty Gemini response: ${JSON.stringify(data)}`);
          throw new BadRequestException('Gemini returned empty response');
        }

        return text;
      } catch (error) {
        if (error instanceof BadRequestException) {
          throw error;
        }
        if (error?.name === 'AbortError') {
          this.logger.warn('Gemini API request aborted (timeout)');
          throw error;
        }
        this.logger.error('Gemini API request failed:', error);
        throw new BadRequestException('AI 서비스 오류');
      }
    }

    throw new BadRequestException('AI 응답 생성 실패');
  }
}
