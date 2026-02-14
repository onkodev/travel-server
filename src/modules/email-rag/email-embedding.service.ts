import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmbeddingService } from '../ai/core/embedding.service';

const MAX_EMBEDDING_CHARS = 8000;
const CONCURRENT_EMBEDDINGS = 5;
const BATCH_SIZE = 100;

@Injectable()
export class EmailEmbeddingService {
  private readonly logger = new Logger(EmailEmbeddingService.name);
  private isSyncing = false;

  constructor(
    private prisma: PrismaService,
    private embeddingService: EmbeddingService,
  ) {}

  /**
   * 이메일 스레드 하나를 임베딩
   */
  async embedThread(threadId: number): Promise<boolean> {
    const thread = await this.prisma.emailThread.findUnique({
      where: { id: threadId },
    });

    if (!thread) {
      this.logger.warn(`Thread ${threadId}: not found in DB`);
      return false;
    }

    if (!thread.rawData) {
      this.logger.warn(`Thread ${threadId}: rawData is null/undefined`);
      return false;
    }

    // rawData에서 텍스트 추출
    const text = this.extractTextFromRawData(thread.rawData);
    if (!text || text.length < 10) {
      this.logger.warn(
        `Thread ${threadId}: text too short (${text?.length || 0} chars), rawData type: ${typeof thread.rawData}, isArray: ${Array.isArray(thread.rawData)}`,
      );
      return false;
    }

    // Subject + body를 결합하여 임베딩 텍스트 생성 (8000자 제한)
    const embeddingText = this.buildEmbeddingText(
      text,
      thread.subject,
      thread.fromEmail,
    );

    const embedding =
      await this.embeddingService.generateEmbedding(embeddingText);

    if (!embedding) {
      this.logger.warn(`Failed to generate embedding for thread ${threadId}`);
      return false;
    }

    const vectorStr = `[${embedding.join(',')}]`;
    await this.prisma.$executeRaw`
      UPDATE email_threads
      SET embedding = ${vectorStr}::vector
      WHERE id = ${threadId}
    `;

    return true;
  }

  /**
   * 전체 미처리 이메일 임베딩 (서버 내부 루프, 한 번 호출로 전체 처리)
   */
  async syncAll(batchSize?: number): Promise<{
    processed: number;
    embedded: number;
    failed: number;
  }> {
    if (this.isSyncing) {
      return { processed: 0, embedded: 0, failed: 0 };
    }

    this.isSyncing = true;
    let totalProcessed = 0;
    let totalEmbedded = 0;
    let totalFailed = 0;
    const limit = batchSize || BATCH_SIZE;

    try {
      while (true) {
        const threads = await this.prisma.$queryRaw<Array<{ id: number }>>`
          SELECT id FROM email_threads
          WHERE raw_data IS NOT NULL AND embedding IS NULL
          ORDER BY created_at DESC
          LIMIT ${limit}
        `;

        if (threads.length === 0) break;

        this.logger.log(`임베딩 배치: ${threads.length}건 처리 시작 (누적: ${totalEmbedded}건)`);

        let batchEmbedded = 0;
        for (let i = 0; i < threads.length; i += CONCURRENT_EMBEDDINGS) {
          const batch = threads.slice(i, i + CONCURRENT_EMBEDDINGS);
          const results = await Promise.all(
            batch.map(async (thread) => {
              try {
                return await this.embedThread(thread.id);
              } catch (e) {
                this.logger.warn(
                  `Failed to embed thread ${thread.id}: ${e.message}`,
                );
                totalFailed++;
                return false;
              }
            }),
          );
          batchEmbedded += results.filter(Boolean).length;

          // Gemini API 레이트 리밋 방지
          if (i + CONCURRENT_EMBEDDINGS < threads.length) {
            await new Promise((r) => setTimeout(r, 300));
          }
        }

        totalEmbedded += batchEmbedded;
        totalProcessed += threads.length;

        // 배치에서 하나도 임베딩 안 되면 무한루프 방지
        if (batchEmbedded === 0) {
          this.logger.warn(`배치 ${threads.length}건 중 임베딩 0건 — 중단`);
          break;
        }

        // 배치 크기가 제한보다 적으면 더 이상 없음
        if (threads.length < limit) break;
      }

      this.logger.log(`임베딩 완료: ${totalProcessed}건 처리, ${totalEmbedded}건 성공, ${totalFailed}건 실패`);
    } finally {
      this.isSyncing = false;
    }

    return { processed: totalProcessed, embedded: totalEmbedded, failed: totalFailed };
  }

  /**
   * 동기화 상태 조회 (raw SQL로 정확한 카운트)
   */
  async getSyncStatus(): Promise<{
    totalThreads: number;
    embeddedThreads: number;
    unembeddedThreads: number;
  }> {
    const result = await this.prisma.$queryRaw<
      [{ total: bigint; embedded: bigint; unembedded: bigint }]
    >`
      SELECT
        COUNT(*) FILTER (WHERE raw_data IS NOT NULL) AS total,
        COUNT(*) FILTER (WHERE embedding IS NOT NULL) AS embedded,
        COUNT(*) FILTER (WHERE raw_data IS NOT NULL AND embedding IS NULL) AS unembedded
      FROM email_threads
    `;

    return {
      totalThreads: Number(result[0].total),
      embeddedThreads: Number(result[0].embedded),
      unembeddedThreads: Number(result[0].unembedded),
    };
  }

  // ========== Private helpers ==========

  private extractMessageText(msg: Record<string, unknown>): string {
    const parts: string[] = [];
    if (typeof msg.subject === 'string' && msg.subject) parts.push(msg.subject);
    if (typeof msg.from === 'string' && msg.from) parts.push(`From: ${msg.from}`);
    if (typeof msg.snippet === 'string' && msg.snippet) parts.push(msg.snippet);
    if (typeof msg.body === 'string' && msg.body) parts.push(msg.body);
    return parts.join('\n');
  }

  private extractTextFromRawData(rawData: unknown): string {
    if (!rawData || typeof rawData !== 'object') return '';

    const data = rawData as Record<string, unknown>;

    // rawData 구조: { messages: [{ snippet, body, ... }] } 또는 직접 텍스트
    if (typeof data.body === 'string') return data.body;
    if (typeof data.snippet === 'string') return data.snippet;

    if (Array.isArray(data.messages)) {
      return data.messages
        .map((msg: Record<string, unknown>) => this.extractMessageText(msg))
        .filter(Boolean)
        .join('\n---\n');
    }

    // rawData가 배열인 경우 (messages가 최상위)
    if (Array.isArray(rawData)) {
      return (rawData as Array<Record<string, unknown>>)
        .map((msg) => this.extractMessageText(msg))
        .filter(Boolean)
        .join('\n---\n');
    }

    // fallback: JSON 문자열화
    try {
      return JSON.stringify(rawData).slice(0, MAX_EMBEDDING_CHARS);
    } catch {
      return '';
    }
  }

  private buildEmbeddingText(
    content: string,
    subject: string | null,
    fromEmail: string | null,
  ): string {
    const parts: string[] = [];
    if (subject) parts.push(`Subject: ${subject}`);
    if (fromEmail) parts.push(`From: ${fromEmail}`);
    parts.push(content);

    const combined = parts.join('\n');
    // Gemini embedding API 제한: ~8000자
    return combined.slice(0, MAX_EMBEDDING_CHARS);
  }
}
