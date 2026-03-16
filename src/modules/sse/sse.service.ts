import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { Subject, Observable, merge, interval } from 'rxjs';
import { map, finalize } from 'rxjs/operators';

export interface SseEvent {
  type: string;
  data: unknown;
}

/**
 * SSE 스트림 관리 서비스
 * - 채팅 세션별 실시간 메시지 푸시
 * - 어드민 알림 실시간 푸시
 * - 어드민 채팅 페이지 presence 추적 (SSE 연결 기반 — 연결 = 보고 있음)
 * - 30초 heartbeat로 연결 유지
 */
@Injectable()
export class SseService implements OnModuleDestroy {
  private readonly logger = new Logger(SseService.name);

  // sessionId → Set<Subject> (복수 클라이언트 구독 가능)
  private chatSubscribers = new Map<string, Set<Subject<SseEvent>>>();
  // agentId → Set<Subject>
  private notificationSubscribers = new Map<number, Set<Subject<SseEvent>>>();

  // 어드민 채팅 페이지 presence (SSE 연결 기반)
  // 연결 = 보고 있음, 연결 해제 = 떠남 (즉시 감지)
  private chatPageViewers = new Set<Subject<SseEvent>>();

  /**
   * 채팅 세션 SSE 구독
   */
  subscribeChatSession(sessionId: string): Observable<MessageEvent> {
    const subject = new Subject<SseEvent>();

    if (!this.chatSubscribers.has(sessionId)) {
      this.chatSubscribers.set(sessionId, new Set());
    }
    this.chatSubscribers.get(sessionId)!.add(subject);

    this.logger.log(
      `Chat SSE subscribed: ${sessionId} (total: ${this.chatSubscribers.get(sessionId)!.size})`,
    );

    // 30초 heartbeat + 실제 이벤트 머지
    const heartbeat$ = interval(30_000).pipe(
      map(() => ({ data: { type: 'heartbeat' } }) as MessageEvent),
    );

    const events$ = subject.asObservable().pipe(
      map((evt) => ({ data: evt }) as MessageEvent),
    );

    return merge(heartbeat$, events$).pipe(
      finalize(() => {
        this.chatSubscribers.get(sessionId)?.delete(subject);
        if (this.chatSubscribers.get(sessionId)?.size === 0) {
          this.chatSubscribers.delete(sessionId);
        }
        this.logger.log(`Chat SSE disconnected: ${sessionId}`);
      }),
    );
  }

  /**
   * 채팅 이벤트 발행 (메시지 저장 후 호출)
   */
  emitChatEvent(sessionId: string, type: string, data: unknown): void {
    const subscribers = this.chatSubscribers.get(sessionId);
    if (subscribers && subscribers.size > 0) {
      const event: SseEvent = { type, data };
      for (const subject of subscribers) {
        subject.next(event);
      }
      this.logger.debug(
        `Chat SSE emit [${type}] to ${subscribers.size} subscribers: ${sessionId}`,
      );
    }
  }

  /**
   * 어드민 알림 SSE 구독
   */
  subscribeNotifications(agentId: number): Observable<MessageEvent> {
    const subject = new Subject<SseEvent>();

    if (!this.notificationSubscribers.has(agentId)) {
      this.notificationSubscribers.set(agentId, new Set());
    }
    this.notificationSubscribers.get(agentId)!.add(subject);

    this.logger.log(
      `Notification SSE subscribed: agent ${agentId} (total: ${this.notificationSubscribers.get(agentId)!.size})`,
    );

    const heartbeat$ = interval(30_000).pipe(
      map(() => ({ data: { type: 'heartbeat' } }) as MessageEvent),
    );

    const events$ = subject.asObservable().pipe(
      map((evt) => ({ data: evt }) as MessageEvent),
    );

    return merge(heartbeat$, events$).pipe(
      finalize(() => {
        this.notificationSubscribers.get(agentId)?.delete(subject);
        if (this.notificationSubscribers.get(agentId)?.size === 0) {
          this.notificationSubscribers.delete(agentId);
        }
        this.logger.log(`Notification SSE disconnected: agent ${agentId}`);
      }),
    );
  }

  /**
   * 알림 이벤트 발행 (알림 생성 후 호출)
   */
  emitNotificationEvent(agentId: number, type: string, data: unknown): void {
    const subscribers = this.notificationSubscribers.get(agentId);
    if (subscribers && subscribers.size > 0) {
      const event: SseEvent = { type, data };
      for (const subject of subscribers) {
        subject.next(event);
      }
    }
  }

  /**
   * 어드민 전체 브로드캐스트 (세션 상태 변경 등)
   * 알림 SSE + 채팅 페이지 SSE 양쪽에 동시 발행
   */
  emitAdminBroadcast(type: string, data: unknown): void {
    this.emitNotificationEvent(1, type, data);
    this.emitChatPageEvent(type, data);
  }

  /**
   * 어드민 채팅 페이지 SSE 구독
   * 연결 자체가 presence 역할 — 연결되어 있으면 "보고 있음"
   */
  subscribeChatPagePresence(): Observable<MessageEvent> {
    const subject = new Subject<SseEvent>();
    this.chatPageViewers.add(subject);

    this.logger.log(
      `Chat page viewer connected (total: ${this.chatPageViewers.size})`,
    );

    const heartbeat$ = interval(30_000).pipe(
      map(() => ({ data: { type: 'heartbeat' } }) as MessageEvent),
    );

    const events$ = subject.asObservable().pipe(
      map((evt) => ({ data: evt }) as MessageEvent),
    );

    return merge(heartbeat$, events$).pipe(
      finalize(() => {
        this.chatPageViewers.delete(subject);
        this.logger.log(
          `Chat page viewer disconnected (total: ${this.chatPageViewers.size})`,
        );
      }),
    );
  }

  /**
   * 채팅 페이지 SSE 이벤트 발행
   */
  emitChatPageEvent(type: string, data: unknown): void {
    if (this.chatPageViewers.size > 0) {
      const event: SseEvent = { type, data };
      for (const subject of this.chatPageViewers) {
        subject.next(event);
      }
    }
  }

  /**
   * 어드민이 채팅 페이지를 보고 있는지 확인
   * SSE 연결이 하나라도 있으면 true
   */
  hasActiveChatPageViewers(): boolean {
    const hasViewers = this.chatPageViewers.size > 0;
    this.logger.log(
      `Chat page presence check: ${hasViewers ? 'YES' : 'NO'} (${this.chatPageViewers.size} viewers)`,
    );
    return hasViewers;
  }

  onModuleDestroy() {
    for (const [, subjects] of this.chatSubscribers) {
      for (const subject of subjects) {
        subject.complete();
      }
    }
    this.chatSubscribers.clear();

    for (const [, subjects] of this.notificationSubscribers) {
      for (const subject of subjects) {
        subject.complete();
      }
    }
    this.notificationSubscribers.clear();

    for (const subject of this.chatPageViewers) {
      subject.complete();
    }
    this.chatPageViewers.clear();
  }
}
