import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface GeminiCallOptions {
  temperature?: number;
  maxOutputTokens?: number;
  systemPrompt?: string;
  history?: Array<{ role: string; parts: Array<{ text: string }> }>;
}

@Injectable()
export class GeminiCoreService {
  private readonly logger = new Logger(GeminiCoreService.name);
  private apiKey: string;
  private baseUrl =
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('GEMINI_API_KEY') || '';
  }

  /**
   * Gemini API 호출 공통 메서드
   */
  async callGemini(
    prompt: string,
    options?: GeminiCallOptions,
  ): Promise<string> {
    if (!this.apiKey) {
      throw new BadRequestException('Gemini API key is not configured');
    }

    const apiUrl = `${this.baseUrl}?key=${this.apiKey}`;

    const body: Record<string, unknown> = {
      contents: options?.history
        ? [...options.history, { role: 'user', parts: [{ text: prompt }] }]
        : [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: options?.temperature ?? 0.7,
        maxOutputTokens: options?.maxOutputTokens ?? 1024,
      },
    };

    if (options?.systemPrompt) {
      body.systemInstruction = { parts: [{ text: options.systemPrompt }] };
    }

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error(`Gemini API error: ${response.status} ${errorBody}`);
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
      this.logger.error('Gemini API request failed:', error);
      throw new BadRequestException('AI 서비스 오류');
    }
  }
}
