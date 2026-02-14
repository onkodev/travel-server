import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const TIMEOUT_MS = 10_000;
const MAX_TEXT_LENGTH = 8_000;
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 2000;

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

    return this.callEmbeddingAPI(truncated);
  }

  private async callEmbeddingAPI(text: string): Promise<number[] | null> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
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

        if (response.status === 429) {
          if (attempt < MAX_RETRIES) {
            const delay =
              BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 1000;
            this.logger.warn(
              `Embedding 429 레이트 리밋, ${Math.round(delay / 1000)}초 후 재시도 (${attempt + 1}/${MAX_RETRIES})`,
            );
            clearTimeout(timer);
            await this.delay(delay);
            continue;
          }
          this.logger.error('Embedding 429 최대 재시도 초과');
          return null;
        }

        if (!response.ok) {
          const errorBody = await response.text();
          this.logger.error(
            `Embedding API 오류: ${response.status} ${errorBody}`,
          );
          if (attempt < MAX_RETRIES && response.status >= 500) {
            clearTimeout(timer);
            await this.delay(1000);
            continue;
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
        if (error instanceof Error && error.name === 'AbortError') {
          if (attempt < MAX_RETRIES) {
            this.logger.warn(
              `Embedding API 타임아웃, 재시도 (${attempt + 1}/${MAX_RETRIES})`,
            );
            continue;
          }
        }
        this.logger.error('임베딩 생성 실패:', error);
        return null;
      } finally {
        clearTimeout(timer);
      }
    }

    return null;
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
