import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GmailService, GmailThread, GmailMessage } from './gmail.service';
import { FaqEmbeddingService } from '../faq/faq-embedding.service';
import { EmailEmbeddingService } from '../email-rag/email-embedding.service';

interface SyncProgress {
  status: 'running' | 'completed';
  target: number;
  fetched: number;
  processed: number;
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
  private autoSyncTimer: ReturnType<typeof setTimeout> | null = null;
  // 현재 동기화의 트리거 타입 (히스토리 저장용)
  private currentSyncType: 'manual' | 'auto' = 'manual';

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
    private faqEmbeddingService: FaqEmbeddingService,
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

    // 자동 동기화 스케줄러 초기화
    await this.initAutoSyncScheduler();
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
      const actualProcessed = await this.prisma.emailThread.count({
        where: { isProcessed: true },
      });

      return {
        ...syncState,
        totalProcessed: actualProcessed,
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
      return {
        reset: false,
        message: '동기화 진행 중에는 초기화할 수 없습니다',
      };
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
    return {
      stopped: true,
      message: '동기화가 중지됩니다. 현재 처리 중인 배치 완료 후 중지됩니다.',
    };
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
        const batchSize = fetchAll
          ? 100
          : Math.min(100, targetCount - progress.fetched);

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
            else progress.processed++;
          }

          // 매 배치마다 progress 저장 (UI 실시간 반영)
          await this.updateProgress(accountEmail, progress);
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
          `페이지 처리 완료: ${progress.processed} 처리, ${progress.skipped} 건너뜀`,
        );

        if (!nextPageToken || threads.length === 0) break;
      }

      // target을 실제 가져온 수로 보정
      progress.target = progress.fetched;

      if (this.shouldStop) {
        this.logger.warn(
          `동기화 중지됨: ${progress.processed} 처리 (중간 저장됨, 다음 실행 시 이어서 가능)`,
        );
        await this.prisma.gmailSyncState.update({
          where: { accountEmail },
          data: {
            syncStatus: 'idle',
            nextPageToken: nextPageToken || null,
            totalProcessed: { increment: progress.processed },
            syncProgress: {
              ...progress,
              status: 'completed',
              completedAt: new Date().toISOString(),
            } as unknown as Prisma.InputJsonValue,
            lastError: '사용자 요청으로 중지됨',
          },
        });

        // 히스토리 저장
        await this.saveHistory(progress, this.currentSyncType, '사용자 요청으로 중지됨');
        this.currentSyncType = 'manual';
        return;
      }

      this.logger.log(
        `Gmail 처리 완료: ${progress.processed} 처리, ${progress.skipped} 건너뜀`,
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
          syncProgress: completedProgress as unknown as Prisma.InputJsonValue,
          lastError: null,
        },
      });

      this.logger.log(
        `동기화 완료: ${progress.processed} 처리, ${progress.skipped} 건너뜀` +
          (isFullScanDone
            ? ' (전체 스캔 완료!)'
            : ' (이어서 가져올 이메일 있음)'),
      );

      // 자동 임베딩 (비동기)
      this.runAutoEmbedding().catch((err) => {
        this.logger.warn(`자동 임베딩 실패: ${err.message}`);
      });

      // 히스토리 저장
      const historyProgress = {
        ...progress,
        status: 'completed' as const,
        completedAt: new Date().toISOString(),
      };
      await this.saveHistory(historyProgress, this.currentSyncType);
      this.currentSyncType = 'manual';
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `동기화 실패: ${errorMessage}`,
        error instanceof Error ? error.stack : undefined,
      );

      await this.prisma.gmailSyncState.update({
        where: { accountEmail },
        data: {
          syncStatus: 'error',
          lastError: errorMessage,
          syncProgress: Prisma.DbNull,
        },
      });

      // 에러 히스토리 저장
      await this.saveHistory(progress, this.currentSyncType, errorMessage);
      this.currentSyncType = 'manual';
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
    _accountEmail: string,
  ): Promise<{
    skipped: boolean;
    failed: boolean;
  }> {
    // 이미 처리된 스레드인지 확인 (atomic check)
    const existing = await this.prisma.emailThread.findUnique({
      where: { gmailThreadId: thread.id },
    });

    if (existing?.isProcessed) {
      return { skipped: true, failed: false };
    }

    // 기존 레코드가 있으면 원자적으로 isProcessed를 선점 (TOCTOU 방지)
    if (existing) {
      const claimed = await this.prisma.emailThread.updateMany({
        where: { id: existing.id, isProcessed: false },
        data: { isProcessed: true },
      });
      if (claimed.count === 0) {
        return { skipped: true, failed: false };
      }
    }

    // 스레드 저장/업데이트
    try {
      await this.prisma.emailThread.upsert({
        where: { gmailThreadId: thread.id },
        update: {
          subject: thread.subject,
          fromEmail: thread.from,
          lastMessageAt: this.safeDate(thread.lastMessageAt),
          messageCount: thread.messageCount,
          rawData: JSON.parse(JSON.stringify(thread.messages)),
          isProcessed: true,
        },
        create: {
          gmailThreadId: thread.id,
          subject: thread.subject,
          fromEmail: thread.from,
          lastMessageAt: this.safeDate(thread.lastMessageAt),
          messageCount: thread.messageCount,
          rawData: JSON.parse(JSON.stringify(thread.messages)),
          isProcessed: true,
        },
      });
    } catch (error) {
      this.logger.error(`스레드 ${thread.id} 저장 실패:`, error);
      return { skipped: false, failed: true };
    }

    return { skipped: false, failed: false };
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
   * DB에 저장되었지만 미처리된 스레드 처리
   */
  private async processUnprocessedFromDb(
    accountEmail: string,
    progress: SyncProgress,
  ) {
    const unprocessed = await this.prisma.emailThread.findMany({
      where: { isProcessed: false, rawData: { not: Prisma.JsonNull } },
    });

    if (unprocessed.length === 0) return;

    this.logger.log(
      `DB 미처리 스레드 ${unprocessed.length}건 발견, 처리 시작`,
    );

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
        else progress.processed++;
      }

      await this.updateProgress(accountEmail, progress);

      if (i + CONCURRENCY < unprocessed.length) {
        await this.delay(2000);
      }
    }

    this.logger.log(`DB 미처리 스레드 처리 완료`);
  }

  /**
   * 동기화 완료 후 미임베딩 FAQ + 이메일 자동 임베딩
   */
  private async runAutoEmbedding(): Promise<void> {
    this.logger.log('자동 임베딩 시작...');

    // FAQ 임베딩 (승인된 FAQ 중 미임베딩 처리)
    try {
      const faqResult = await this.faqEmbeddingService.syncMissingEmbeddings();
      if (faqResult.total > 0) {
        this.logger.log(
          `FAQ 임베딩 완료: ${faqResult.success}건 성공, ${faqResult.failed}건 실패`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `FAQ 임베딩 실패: ${err instanceof Error ? err.message : err}`,
      );
    }

    // 이메일 임베딩
    const result = await this.emailEmbeddingService.syncAll();
    this.logger.log(
      `이메일 임베딩 완료: ${result.embedded}건 성공, ${result.failed}건 실패`,
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ============================================================================
  // 히스토리 관리
  // ============================================================================

  /**
   * 동기화 결과를 히스토리에 저장
   */
  private async saveHistory(
    progress: SyncProgress,
    type: 'manual' | 'auto',
    error?: string,
  ) {
    try {
      await this.prisma.gmailSyncHistory.create({
        data: {
          type,
          fetched: progress.fetched,
          processed: progress.processed,
          extracted: 0,
          skipped: progress.skipped,
          failed: progress.failed,
          startedAt: new Date(progress.startedAt),
          completedAt: progress.completedAt
            ? new Date(progress.completedAt)
            : new Date(),
          error: error || null,
        },
      });
    } catch (err) {
      this.logger.warn(
        `히스토리 저장 실패: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /**
   * 동기화 히스토리 목록 조회 (최근 순)
   */
  async getSyncHistory(params?: { page?: number; limit?: number }) {
    const page = params?.page || 1;
    const limit = params?.limit || 20;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.gmailSyncHistory.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.gmailSyncHistory.count(),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  // ============================================================================
  // 자동 동기화 스케줄러
  // ============================================================================

  /**
   * 현재 스케줄 설정 조회
   */
  async getSchedule() {
    const state = await this.prisma.gmailSyncState.findFirst();
    return {
      enabled: state?.autoSyncEnabled ?? false,
      intervalHours: state?.autoSyncInterval ?? 24,
      nextSyncAt: state?.nextAutoSyncAt?.toISOString() ?? null,
    };
  }

  /**
   * 스케줄 설정 변경
   */
  async updateSchedule(params: {
    enabled: boolean;
    intervalHours?: number;
  }) {
    const state = await this.prisma.gmailSyncState.findFirst();
    if (!state) {
      return { success: false, message: '동기화 상태가 없습니다' };
    }

    const intervalHours = params.intervalHours ?? state.autoSyncInterval;
    const nextSyncAt = params.enabled
      ? new Date(Date.now() + intervalHours * 60 * 60 * 1000)
      : null;

    await this.prisma.gmailSyncState.update({
      where: { id: state.id },
      data: {
        autoSyncEnabled: params.enabled,
        autoSyncInterval: intervalHours,
        nextAutoSyncAt: nextSyncAt,
      },
    });

    // 타이머 재설정
    if (params.enabled) {
      this.scheduleNextSync(intervalHours);
      this.logger.log(
        `자동 동기화 활성화: ${intervalHours}시간 간격`,
      );
    } else {
      if (this.autoSyncTimer) {
        clearTimeout(this.autoSyncTimer);
        this.autoSyncTimer = null;
      }
      this.logger.log('자동 동기화 비활성화');
    }

    return {
      success: true,
      enabled: params.enabled,
      intervalHours,
      nextSyncAt: nextSyncAt?.toISOString() ?? null,
    };
  }

  /**
   * 서버 시작 시 자동 동기화 스케줄러 초기화
   */
  private async initAutoSyncScheduler() {
    const state = await this.prisma.gmailSyncState.findFirst();
    if (!state?.autoSyncEnabled) return;

    const intervalHours = state.autoSyncInterval;

    if (state.nextAutoSyncAt) {
      const msUntilNext =
        new Date(state.nextAutoSyncAt).getTime() - Date.now();
      if (msUntilNext > 0) {
        // 예정 시간까지 남은 시간만큼 대기
        this.scheduleNextSync(msUntilNext / (60 * 60 * 1000));
        this.logger.log(
          `자동 동기화 복구: ${Math.round(msUntilNext / 60000)}분 후 실행 예정`,
        );
        return;
      }
    }

    // 예정 시간이 이미 지났으면 즉시 실행 후 재스케줄
    this.logger.log('자동 동기화: 예정 시간 초과, 즉시 실행');
    this.runAutoSync(intervalHours);
  }

  /**
   * 다음 자동 동기화 타이머 설정
   */
  private scheduleNextSync(intervalHours: number) {
    if (this.autoSyncTimer) {
      clearTimeout(this.autoSyncTimer);
    }

    const ms = intervalHours * 60 * 60 * 1000;
    this.autoSyncTimer = setTimeout(() => {
      this.runAutoSync(intervalHours);
    }, ms);
  }

  /**
   * 자동 동기화 실행 (타이머 콜백)
   */
  private async runAutoSync(intervalHours: number) {
    if (this.isSyncRunning) {
      this.logger.warn('자동 동기화: 이미 동기화 진행 중, 다음 주기로 연기');
      this.scheduleNextSync(intervalHours);
      return;
    }

    this.logger.log('자동 동기화 시작');
    this.currentSyncType = 'auto';

    try {
      await this.startBatchSync({ maxResults: 0 });
    } catch (err) {
      this.logger.error(
        `자동 동기화 실패: ${err instanceof Error ? err.message : err}`,
      );
    }

    // 다음 실행 예약 및 DB 업데이트
    const nextSyncAt = new Date(
      Date.now() + intervalHours * 60 * 60 * 1000,
    );
    this.scheduleNextSync(intervalHours);

    try {
      await this.prisma.gmailSyncState.updateMany({
        data: { nextAutoSyncAt: nextSyncAt },
      });
    } catch {
      // DB 업데이트 실패는 무시
    }
  }
}
