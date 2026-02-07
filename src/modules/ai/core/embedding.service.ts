import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const TIMEOUT_MS = 10_000;
const MAX_TEXT_LENGTH = 8_000;

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly apiKey: string;
  private readonly baseUrl =
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent';

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('GEMINI_API_KEY') || '';
  }

  async generateEmbedding(text: string): Promise<number[] | null> {
    if (!this.apiKey) {
      this.logger.warn(
        'GEMINI_API_KEY가 설정되지 않아 임베딩을 생성할 수 없습니다',
      );
      return null;
    }

    const truncated =
      text.length > MAX_TEXT_LENGTH ? text.slice(0, MAX_TEXT_LENGTH) : text;

    return this.callEmbeddingAPI(truncated, true);
  }

  private async callEmbeddingAPI(
    text: string,
    retry: boolean,
  ): Promise<number[] | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(`${this.baseUrl}?key=${this.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'models/gemini-embedding-001',
          content: { parts: [{ text }] },
          outputDimensionality: 768,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error(
          `Embedding API 오류: ${response.status} ${errorBody}`,
        );
        if (retry && response.status >= 500) {
          await this.delay(1000);
          return this.callEmbeddingAPI(text, false);
        }
        return null;
      }

      const data = await response.json();
      const values = data.embedding?.values;

      if (!values || !Array.isArray(values)) {
        this.logger.error(`빈 임베딩 응답: ${JSON.stringify(data)}`);
        return null;
      }

      return values;
    } catch (error) {
      if (retry && error instanceof Error && error.name === 'AbortError') {
        this.logger.warn('Embedding API 타임아웃, 재시도');
        return this.callEmbeddingAPI(text, false);
      }
      this.logger.error('임베딩 생성 실패:', error);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  buildFaqText(
    question: string,
    answer: string,
    questionKo?: string | null,
    answerKo?: string | null,
  ): string {
    let text = `Q: ${question}\nA: ${answer}`;
    if (questionKo) text += `\nQ(KO): ${questionKo}`;
    if (answerKo) text += `\nA(KO): ${answerKo}`;
    return text;
  }
}
