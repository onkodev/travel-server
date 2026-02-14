import {
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GmailService, GmailThread, GmailMessage } from './gmail.service';
import { FaqAiService, ExtractedFaqItem } from '../ai/services/faq-ai.service';
import { FaqService } from '../faq/faq.service';
import { EmailEmbeddingService } from '../email-rag/email-embedding.service';

interface SyncProgress {
  status: 'running' | 'completed';
  target: number;
  fetched: number;
  processed: number;
  extracted: number;
  skipped: number;
  failed: number;
  startedAt: string;
  completedAt?: string;
}

@Injectable()
export class GmailSyncService implements OnModuleInit {
  private readonly logger = new Logger(GmailSyncService.name);
  private isSyncRunning = false;
  private shouldStop = false;

  /** 비표준 날짜 문자열 안전 파싱 (Invalid Date → 현재 시간 fallback) */
  private safeDate(dateStr: string | null | undefined): Date {
    if (!dateStr) return new Date();
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) {
      this.logger.warn(`Invalid date format, using now(): "${dateStr}"`);
      return new Date();
    }
    return d;
  }

  constructor(
    private prisma: PrismaService,
    private gmailService: GmailService,
    private faqAiService: FaqAiService,
    private faqService: FaqService,
    private emailEmbeddingService: EmailEmbeddingService,
  ) {}

  async onModuleInit() {
    // 서버 재시작 시 stale syncing 상태 즉시 리셋
    const updated = await this.prisma.gmailSyncState.updateMany({
      where: { syncStatus: 'syncing' },
      data: {
        syncStatus: 'idle',
        lastError: '서버 재시작으로 동기화가 중단되었습니다',
        syncProgress: Prisma.DbNull,
      },
    });
    if (updated.count > 0) {
      this.logger.warn(`서버 시작: stale 동기화 상태 ${updated.count}건 리셋`);
    }
  }

  // ============================================================================
  // 동기화 상태 조회
  // ============================================================================

  async getSyncStatus() {
    const existing = await this.prisma.gmailSyncState.findFirst();

    if (existing) {
      const updates: Record<string, unknown> = {};

      // DB는 syncing인데 실제 프로세스가 돌고 있지 않으면 → 비정상 종료
      if (existing.syncStatus === 'syncing' && !this.isSyncRunning) {
        const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
        if (existing.updatedAt < fiveMinAgo) {
          updates.syncStatus = 'idle';
          updates.lastError = '이전 동기화가 비정상 종료됨';
          updates.syncProgress = Prisma.DbNull;
        }
      }

      let syncState = existing;
      if (Object.keys(updates).length > 0) {
        syncState = await this.prisma.gmailSyncState.update({
          where: { id: existing.id },
          data: updates,
        });
      }

      // 실제 DB 카운트로 덮어쓰기 (러닝 카운터는 부정확할 수 있음)
      const [actualProcessed, actualExtracted] = await Promise.all([
        this.prisma.emailThread.count({ where: { isProcessed: true } }),
        this.prisma.faq.count({ where: { source: 'gmail' } }),
      ]);

      return {
        ...syncState,
        totalProcessed: actualProcessed,
        totalExtracted: actualExtracted,
      };
    }

    // 없으면 Gmail 계정 이메일로 생성
    try {
      const accountEmail = await this.gmailService.getAccountEmail();
      return this.prisma.gmailSyncState.create({
        data: { accountEmail },
      });
    } catch {
      return {
        id: 0,
        accountEmail: '(미설정)',
        lastSyncHistoryId: null,
        lastSyncAt: null,
        totalProcessed: 0,
        totalExtracted: 0,
        totalAccountMessages: 0,
        syncStatus: 'idle',
        syncProgress: null,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }
  }

  /**
   * 전체 이메일 수만 Gmail API에서 새로 조회하여 DB 갱신
   */
  async refreshMessageCount() {
    const accountEmail = await this.gmailService.getAccountEmail();
    const totalAccountMessages = await this.gmailService.getInboxThreadCount();

    await this.prisma.gmailSyncState.upsert({
      where: { accountEmail },
      update: { totalAccountMessages },
      create: { accountEmail, totalAccountMessages },
    });

    return { totalAccountMessages };
  }

  /**
   * 동기화 상태 초기화 (stale pageToken, 에러 상태 등)
   */
  async resetSync() {
    if (this.isSyncRunning) {
      return { reset: false, message: '동기화 진행 중에는 초기화할 수 없습니다' };
    }

    const existing = await this.prisma.gmailSyncState.findFirst();
    if (!existing) {
      return { reset: false, message: '동기화 상태가 없습니다' };
    }

    await this.prisma.gmailSyncState.update({
      where: { id: existing.id },
      data: {
        syncStatus: 'idle',
        syncProgress: Prisma.DbNull,
        nextPageToken: null,
        lastError: null,
      },
    });

    this.logger.log('동기화 상태 초기화 완료 (pageToken, 에러, 진행률 클리어)');
    return { reset: true, message: '동기화 상태가 초기화되었습니다' };
  }

  /**
   * 진행 중인 동기화 중지
   */
  async stopSync() {
    if (!this.isSyncRunning) {
      return { stopped: false, message: '진행 중인 동기화가 없습니다' };
    }

    this.shouldStop = true;
    this.logger.warn('동기화 중지 요청됨 — 현재 배치 완료 후 중지됩니다');
    return { stopped: true, message: '동기화가 중지됩니다. 현재 처리 중인 배치 완료 후 중지됩니다.' };
  }

  // ============================================================================
  // 동기화 시작 (fire-and-forget)
  // ============================================================================

  /**
   * 배치 동기화 시작 - DB를 먼저 syncing으로 바꾼 후 즉시 반환, 실제 작업은 백그라운드
   * 이전 동기화가 끝난 지점(pageToken)부터 이어서 가져옴
   */
  async startBatchSync(params: { maxResults?: number; query?: string }) {
    if (this.isSyncRunning) {
      return { started: false, message: '이미 동기화가 진행 중입니다' };
    }

    if (!this.gmailService.isConfigured()) {
      return { started: false, message: 'Gmail API가 설정되지 않았습니다' };
    }

    const targetCount = params.maxResults ?? 50;

    try {
      const accountEmail = await this.gmailService.getAccountEmail();
      const initialProgress: SyncProgress = {
        status: 'running',
        target: targetCount || 0, // 0 = 전체
        fetched: 0,
        processed: 0,
        extracted: 0,
        skipped: 0,
        failed: 0,
        startedAt: new Date().toISOString(),
      };

      // DB 기반 lock: syncStatus가 syncing이 아닌 경우에만 업데이트 (원자적 확인)
      const updated = await this.prisma.gmailSyncState.updateMany({
        where: {
          accountEmail,
          syncStatus: { not: 'syncing' },
        },
        data: {
          syncStatus: 'syncing',
          lastError: null,
          syncProgress: initialProgress as unknown as Prisma.InputJsonValue,
        },
      });

      if (updated.count === 0) {
        // 레코드가 없거나 이미 syncing 중
        const existing = await this.prisma.gmailSyncState.findFirst({
          where: { accountEmail },
        });
        if (existing) {
          return { started: false, message: '이미 동기화가 진행 중입니다' };
        }
        // 레코드 자체가 없으면 생성
        await this.prisma.gmailSyncState.create({
          data: {
            accountEmail,
            syncStatus: 'syncing',
            syncProgress: initialProgress as unknown as Prisma.InputJsonValue,
          },
        });
      }

      this.isSyncRunning = true;
      this.shouldStop = false;
    } catch {
      this.isSyncRunning = false;
      return {
        started: false,
        message: 'Gmail 계정 정보를 가져올 수 없습니다',
      };
    }

    // 백그라운드에서 실행 (HTTP 응답 후 계속 실행됨)
    this.runBatchSync(params).catch((error) => {
      this.logger.error('배치 동기화 실패:', error);
    });

    return { started: true, message: '동기화가 시작되었습니다' };
  }

  // ============================================================================
  // 실제 동기화 로직 (백그라운드)
  // ============================================================================

  private async runBatchSync(params: { maxResults?: number; query?: string }) {
    const accountEmail = await this.gmailService.getAccountEmail();
    const targetCount = params.maxResults ?? 50;
    const fetchAll = targetCount === 0;

    const progress: SyncProgress = {
      status: 'running',
      target: targetCount,
      fetched: 0,
      processed: 0,
      extracted: 0,
      skipped: 0,
      failed: 0,
      startedAt: new Date().toISOString(),
    };

    try {
      // 동기화 이어가기 로직
      const syncState = await this.prisma.gmailSyncState.findFirst();
      let nextPageToken: string | undefined =
        syncState?.nextPageToken || undefined;

      let query = params.query;
      if (nextPageToken) {
        this.logger.log('저장된 pageToken에서 이어서 가져오기');
      } else if (syncState?.fullScanCompleted && syncState?.lastSyncAt) {
        const since = new Date(syncState.lastSyncAt);
        since.setDate(since.getDate() - 1);
        const afterDate = `${since.getFullYear()}/${String(since.getMonth() + 1).padStart(2, '0')}/${String(since.getDate()).padStart(2, '0')}`;
        const afterFilter = `after:${afterDate}`;
        query = query ? `${query} ${afterFilter}` : afterFilter;
        this.logger.log(
          `전체 스캔 완료 → ${afterDate} 이후 새 이메일만 가져오기`,
        );
      } else {
        this.logger.log('처음부터 가져오기 시작');
      }

      // 스트리밍 방식: 페이지 단위로 fetch → 즉시 process (메모리 절약)
      const PROCESS_CONCURRENCY = 3;

      while ((fetchAll || progress.fetched < targetCount) && !this.shouldStop) {
        const batchSize = fetchAll ? 100 : Math.min(100, targetCount - progress.fetched);

        let threads: GmailThread[];
        try {
          const result = await this.gmailService.fetchThreads({
            maxResults: batchSize,
            query,
            pageToken: nextPageToken,
          });

          threads = result.threads;
          nextPageToken = result.nextPageToken;
        } catch (fetchError) {
          if (nextPageToken) {
            this.logger.warn(
              `pageToken으로 가져오기 실패, 초기화 후 재시도: ${
                fetchError instanceof Error ? fetchError.message : fetchError
              }`,
            );
            nextPageToken = undefined;
            await this.prisma.gmailSyncState.update({
              where: { accountEmail },
              data: { nextPageToken: null },
            });
            continue;
          }
          throw fetchError;
        }

        progress.fetched += threads.length;
        if (fetchAll) {
          progress.target = progress.fetched;
        }
        this.logger.log(
          `이메일 가져오기: ${progress.fetched}${fetchAll ? '' : `/${targetCount}`}건`,
        );

        // fetch 완료 시점 progress 저장
        await this.updateProgress(accountEmail, progress);

        // 가져온 페이지 즉시 처리 (메모리에 쌓지 않음)
        for (let i = 0; i < threads.length; i += PROCESS_CONCURRENCY) {
          if (this.shouldStop) break;

          const chunk = threads.slice(i, i + PROCESS_CONCURRENCY);
          const results = await Promise.all(
            chunk.map((thread) => this.processThread(thread, accountEmail)),
          );

          for (const result of results) {
            if (result.skipped) progress.skipped++;
            else if (result.failed) progress.failed++;
            else {
              progress.processed++;
              progress.extracted += result.extractedCount;
            }
          }

          // 매 배치마다 progress 저장 (UI 실시간 반영)
          await this.updateProgress(accountEmail, progress);

          // Gemini API 레이트 리밋 방지 (배치 간 딜레이)
          if (i + PROCESS_CONCURRENCY < threads.length) {
            await this.delay(2000);
          }
        }

        // 페이지 완료 — pageToken 저장 (서버 재시작 시 이어서 가능)
        await this.prisma.gmailSyncState.update({
          where: { accountEmail },
          data: {
            nextPageToken: nextPageToken || null,
            syncProgress: progress as unknown as Prisma.InputJsonValue,
          },
        });

        this.logger.log(
          `페이지 처리 완료: ${progress.processed} 처리, ${progress.extracted} FAQ, ${progress.skipped} 건너뜀`,
        );

        if (!nextPageToken || threads.length === 0) break;
      }

      // target을 실제 가져온 수로 보정
      progress.target = progress.fetched;

      if (this.shouldStop) {
        this.logger.warn(
          `동기화 중지됨: ${progress.processed} 처리, ${progress.extracted} FAQ 추출 (중간 저장됨, 다음 실행 시 이어서 가능)`,
        );
        await this.prisma.gmailSyncState.update({
          where: { accountEmail },
          data: {
            syncStatus: 'idle',
            nextPageToken: nextPageToken || null,
            totalProcessed: { increment: progress.processed },
            totalExtracted: { increment: progress.extracted },
            syncProgress: { ...progress, status: 'completed', completedAt: new Date().toISOString() } as unknown as Prisma.InputJsonValue,
            lastError: '사용자 요청으로 중지됨',
          },
        });
        return;
      }

      this.logger.log(
        `Gmail 처리 완료: ${progress.processed} 처리, ${progress.extracted} FAQ 추출, ${progress.skipped} 건너뜀`,
      );

      // DB에 있지만 미처리된 스레드 처리
      await this.processUnprocessedFromDb(accountEmail, progress);

      // 완료
      const completedProgress: SyncProgress = {
        ...progress,
        status: 'completed',
        completedAt: new Date().toISOString(),
      };

      const isFullScanDone = !nextPageToken;
      await this.prisma.gmailSyncState.update({
        where: { accountEmail },
        data: {
          syncStatus: 'idle',
          lastSyncAt: new Date(),
          nextPageToken: nextPageToken || null,
          fullScanCompleted: isFullScanDone ? true : undefined,
          totalProcessed: { increment: progress.processed },
          totalExtracted: { increment: progress.extracted },
          syncProgress: completedProgress as unknown as Prisma.InputJsonValue,
          lastError: null,
        },
      });

      this.logger.log(
        `동기화 완료: ${progress.processed} 처리, ${progress.extracted} FAQ 추출, ${progress.skipped} 건너뜀` +
          (isFullScanDone
            ? ' (전체 스캔 완료!)'
            : ' (이어서 가져올 이메일 있음)'),
      );

      // 자동 임베딩 (비동기)
      this.runAutoEmbedding().catch((err) => {
        this.logger.warn(`자동 임베딩 실패: ${err.message}`);
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`동기화 실패: ${errorMessage}`, error instanceof Error ? error.stack : undefined);

      await this.prisma.gmailSyncState.update({
        where: { accountEmail },
        data: {
          syncStatus: 'error',
          lastError: errorMessage,
          syncProgress: Prisma.DbNull,
        },
      });
    } finally {
      this.isSyncRunning = false;
    }
  }

  private async updateProgress(accountEmail: string, progress: SyncProgress) {
    await this.prisma.gmailSyncState.update({
      where: { accountEmail },
      data: {
        syncProgress: progress as unknown as Prisma.InputJsonValue,
      },
    });
  }

  // ============================================================================
  // 스레드 처리
  // ============================================================================

  private async processThread(
    thread: GmailThread,
    accountEmail: string,
  ): Promise<{
    extractedCount: number;
    skipped: boolean;
    failed: boolean;
  }> {
    // 이미 처리된 스레드인지 확인 (atomic check)
    const existing = await this.prisma.emailThread.findUnique({
      where: { gmailThreadId: thread.id },
    });

    if (existing?.isProcessed) {
      return { extractedCount: 0, skipped: true, failed: false };
    }

    // 기존 레코드가 있으면 원자적으로 isProcessed를 선점 (TOCTOU 방지)
    if (existing) {
      const claimed = await this.prisma.emailThread.updateMany({
        where: { id: existing.id, isProcessed: false },
        data: { isProcessed: true },
      });
      if (claimed.count === 0) {
        // 다른 워커가 이미 처리 중
        return { extractedCount: 0, skipped: true, failed: false };
      }
      // 처리 후 isProcessed는 아래에서 다시 업데이트됨 (extractedFaqCount 포함)
    }

    // 고객 문의 + 답변이 모두 있는지 확인 (한쪽만 있으면 FAQ 추출 불가)
    const emailLower = accountEmail.toLowerCase();
    const hasCustomerMsg = thread.messages.some(
      (msg) => !msg.from.toLowerCase().includes(emailLower),
    );
    const hasStaffReply = thread.messages.some((msg) =>
      msg.from.toLowerCase().includes(emailLower),
    );

    if (!hasCustomerMsg || !hasStaffReply) {
      // 문의+답변 쌍이 없음 → 저장만 하고 건너뜀
      await this.prisma.emailThread.upsert({
        where: { gmailThreadId: thread.id },
        update: { isProcessed: true, extractedFaqCount: 0 },
        create: {
          gmailThreadId: thread.id,
          subject: thread.subject,
          fromEmail: thread.from,
          lastMessageAt: this.safeDate(thread.lastMessageAt),
          messageCount: thread.messageCount,
          rawData: JSON.parse(JSON.stringify(thread.messages)),
          isProcessed: true,
          extractedFaqCount: 0,
        },
      });
      return { extractedCount: 0, skipped: true, failed: false };
    }

    // 스레드 저장/업데이트
    const emailThread = await this.prisma.emailThread.upsert({
      where: { gmailThreadId: thread.id },
      update: {
        subject: thread.subject,
        fromEmail: thread.from,
        lastMessageAt: this.safeDate(thread.lastMessageAt),
        messageCount: thread.messageCount,
        rawData: JSON.parse(JSON.stringify(thread.messages)),
      },
      create: {
        gmailThreadId: thread.id,
        subject: thread.subject,
        fromEmail: thread.from,
        lastMessageAt: this.safeDate(thread.lastMessageAt),
        messageCount: thread.messageCount,
        rawData: JSON.parse(JSON.stringify(thread.messages)),
      },
    });

    // 이메일 본문 합치기 (최대 길이 제한)
    const emailBody = thread.messages
      .map((msg) => `[From: ${msg.from}]\n[Date: ${msg.date}]\n${msg.body}`)
      .join('\n\n---\n\n')
      .substring(0, 10000);

    // AI로 FAQ 추출
    let extractedFaqs: ExtractedFaqItem[] = [];
    try {
      extractedFaqs = await this.faqAiService.extractFaqFromEmail({
        subject: thread.subject,
        emailBody,
      });
    } catch (error) {
      this.logger.error(`스레드 ${thread.id} FAQ 추출 실패:`, error);

      await this.prisma.emailThread.update({
        where: { id: emailThread.id },
        data: {
          isProcessed: true,
          processingError:
            error instanceof Error ? error.message : 'AI extraction failed',
        },
      });

      return { extractedCount: 0, skipped: false, failed: true };
    }

    // 추출된 FAQ를 DB에 저장 (status: pending) — 중복 체크 후 일괄 삽입
    let nonDuplicateFaqs: ExtractedFaqItem[] = [];
    if (extractedFaqs.length > 0) {
      // 중복 체크: similarity >= 0.9 인 기존 FAQ가 있으면 skip
      for (const faq of extractedFaqs) {
        try {
          const { hasDuplicate } = await this.faqService.checkDuplicates(
            faq.question,
            0.9,
          );
          if (hasDuplicate) {
            this.logger.debug(
              `중복 FAQ 건너뜀: "${faq.question.substring(0, 50)}..."`,
            );
            continue;
          }
        } catch {
          // 중복 체크 실패 시 FAQ는 그대로 저장
        }
        nonDuplicateFaqs.push(faq);
      }

      if (nonDuplicateFaqs.length < extractedFaqs.length) {
        this.logger.log(
          `중복 제거: ${extractedFaqs.length}건 중 ${extractedFaqs.length - nonDuplicateFaqs.length}건 건너뜀`,
        );
      }

      if (nonDuplicateFaqs.length > 0) {
        await this.prisma.faq.createMany({
          data: nonDuplicateFaqs.map((faq) => ({
            question: faq.question,
            answer: faq.answer,
            questionKo: faq.questionKo || null,
            answerKo: faq.answerKo || null,
            tags: faq.tags || [],
            category: faq.category || null,
            source: 'gmail',
            sourceEmailId: thread.id,
            sourceEmailSubject: thread.subject,
            confidence: faq.confidence,
            sourceContext:
              faq.questionSource || faq.answerSource
                ? {
                    questionSource: faq.questionSource || '',
                    answerSource: faq.answerSource || '',
                  }
                : undefined,
            status: 'pending',
          })),
        });
      }
    }

    // 스레드 처리 완료 표시
    const savedCount = nonDuplicateFaqs.length;
    await this.prisma.emailThread.update({
      where: { id: emailThread.id },
      data: {
        isProcessed: true,
        extractedFaqCount: savedCount,
      },
    });

    return {
      extractedCount: savedCount,
      skipped: false,
      failed: false,
    };
  }

  // ============================================================================
  // 스레드 목록 조회
  // ============================================================================

  async getThreads(params: {
    page?: number;
    limit?: number;
    processed?: string;
    search?: string;
  }) {
    const { page = 1, limit = 20, processed, search } = params;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    if (processed === 'true') where.isProcessed = true;
    if (processed === 'false') where.isProcessed = false;

    if (search) {
      where.OR = [
        { subject: { contains: search, mode: 'insensitive' } },
        { fromEmail: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [threads, total] = await Promise.all([
      this.prisma.emailThread.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.emailThread.count({ where }),
    ]);

    return {
      data: threads,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Gmail 스레드 ID로 이메일 스레드 조회 (rawData 포함)
   */
  async getThreadByGmailId(gmailThreadId: string) {
    return this.prisma.emailThread.findUnique({
      where: { gmailThreadId },
    });
  }

  /**
   * DB에 저장되었지만 미처리된 스레드를 FAQ 추출 처리
   */
  private async processUnprocessedFromDb(accountEmail: string, progress: SyncProgress) {
    const unprocessed = await this.prisma.emailThread.findMany({
      where: { isProcessed: false, rawData: { not: Prisma.JsonNull } },
    });

    if (unprocessed.length === 0) return;

    this.logger.log(`DB 미처리 스레드 ${unprocessed.length}건 발견, FAQ 추출 시작`);

    const CONCURRENCY = 3;
    for (let i = 0; i < unprocessed.length; i += CONCURRENCY) {
      if (this.shouldStop) break;

      const chunk = unprocessed.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        chunk.map((dbThread) => {
          const gmailThread: GmailThread = {
            id: dbThread.gmailThreadId,
            subject: dbThread.subject || '',
            from: dbThread.fromEmail || '',
            lastMessageAt: dbThread.lastMessageAt?.toISOString() || '',
            messageCount: dbThread.messageCount,
            messages: (dbThread.rawData as unknown as GmailMessage[]) || [],
          };
          return this.processThread(gmailThread, accountEmail);
        }),
      );

      for (const result of results) {
        if (result.skipped) progress.skipped++;
        else if (result.failed) progress.failed++;
        else {
          progress.processed++;
          progress.extracted += result.extractedCount;
        }
      }

      await this.updateProgress(accountEmail, progress);

      if (i + CONCURRENCY < unprocessed.length) {
        await this.delay(2000);
      }
    }

    this.logger.log(`DB 미처리 스레드 처리 완료`);
  }

  /**
   * 동기화 완료 후 미임베딩 이메일 자동 임베딩
   */
  private async runAutoEmbedding(): Promise<void> {
    this.logger.log('자동 임베딩 시작...');
    const result = await this.emailEmbeddingService.syncAll();
    this.logger.log(`자동 임베딩 완료: ${result.embedded}건 성공, ${result.failed}건 실패`);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
