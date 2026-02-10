import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Subject } from 'rxjs';
import {
  CHATBOT_EVENTS,
  type ChatbotNewMessageEvent,
  type ChatbotEstimateStatusEvent,
} from '../../common/events';

// ============================================================================
// Types
// ============================================================================

export interface MessageEvent {
  data: string;
  type?: string;
  id?: string;
}

export interface QueuedEvent {
  id: string;
  type: 'newMessage' | 'estimateStatusChanged';
  data: string;
  timestamp: number;
}

// ============================================================================
// Constants
// ============================================================================

const EVENT_QUEUE_MAX_SIZE = 50; // 세션당 최대 이벤트 수
const EVENT_QUEUE_TTL_MS = 5 * 60 * 1000; // 5분 후 이벤트 만료
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5분마다 정리

// ============================================================================
// Service
// ============================================================================

@Injectable()
export class ChatbotSseService implements OnModuleDestroy {
  private readonly logger = new Logger(ChatbotSseService.name);

  // 세션당 여러 구독자 지원 (관리자 + 고객 동시 접속 가능)
  private readonly subscribers = new Map<
    string,
    Set<Subject<MessageEvent>>
  >();

  // 이벤트 큐: 연결 끊김 시 메시지 손실 방지
  private readonly eventQueues = new Map<string, QueuedEvent[]>();

  // Cleanup interval
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleSubscribers();
      this.cleanupExpiredEvents();
    }, CLEANUP_INTERVAL_MS);
  }

  onModuleDestroy() {
    clearInterval(this.cleanupInterval);
    this.subscribers.forEach((subjects) => {
      subjects.forEach((s) => s.complete());
    });
    this.subscribers.clear();
    this.eventQueues.clear();
  }

  // ============================================================================
  // Event Queue Management
  // ============================================================================

  private queueEvent(
    sessionId: string,
    event: Omit<QueuedEvent, 'id' | 'timestamp'>,
  ): QueuedEvent {
    const queuedEvent: QueuedEvent = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      ...event,
    };

    let queue = this.eventQueues.get(sessionId);
    if (!queue) {
      queue = [];
      this.eventQueues.set(sessionId, queue);
    }

    queue.push(queuedEvent);

    while (queue.length > EVENT_QUEUE_MAX_SIZE) {
      queue.shift();
    }

    return queuedEvent;
  }

  getMissedEvents(sessionId: string, sinceTimestamp?: number): QueuedEvent[] {
    const queue = this.eventQueues.get(sessionId);
    if (!queue) return [];

    const now = Date.now();
    const cutoff = sinceTimestamp || 0;

    return queue.filter(
      (event) =>
        event.timestamp > cutoff && now - event.timestamp < EVENT_QUEUE_TTL_MS,
    );
  }

  private cleanupExpiredEvents(): void {
    const now = Date.now();
    let totalCleaned = 0;

    this.eventQueues.forEach((queue, sessionId) => {
      const before = queue.length;
      const filtered = queue.filter(
        (event) => now - event.timestamp < EVENT_QUEUE_TTL_MS,
      );

      if (filtered.length === 0) {
        this.eventQueues.delete(sessionId);
      } else if (filtered.length !== before) {
        this.eventQueues.set(sessionId, filtered);
      }

      totalCleaned += before - filtered.length;
    });

    if (totalCleaned > 0) {
      this.logger.debug(
        `Cleaned up ${totalCleaned} expired events from queue`,
      );
    }
  }

  // ============================================================================
  // Subscriber Management (다중 구독자 지원)
  // ============================================================================

  /**
   * 세션에 새 구독자 Subject 생성 (각 SSE 연결마다 독립적)
   */
  createSubscriber(sessionId: string): Subject<MessageEvent> {
    const subject = new Subject<MessageEvent>();

    let subs = this.subscribers.get(sessionId);
    if (!subs) {
      subs = new Set();
      this.subscribers.set(sessionId, subs);
    }
    subs.add(subject);

    this.logger.log(
      `SSE subscriber added: session=${sessionId}, count=${subs.size}`,
    );
    return subject;
  }

  /**
   * 특정 구독자만 제거 (다른 구독자에 영향 없음)
   */
  removeSubscriber(sessionId: string, subject: Subject<MessageEvent>): void {
    const subs = this.subscribers.get(sessionId);
    if (!subs) return;

    subject.complete();
    subs.delete(subject);

    if (subs.size === 0) {
      this.subscribers.delete(sessionId);
    }

    this.logger.log(
      `SSE subscriber removed: session=${sessionId}, remaining=${subs.size}`,
    );
  }

  /**
   * Cleanup stale (closed) subscribers
   */
  private cleanupStaleSubscribers(): void {
    let cleaned = 0;
    this.subscribers.forEach((subs, sessionId) => {
      subs.forEach((subject) => {
        if (subject.closed) {
          subs.delete(subject);
          cleaned++;
        }
      });
      if (subs.size === 0) {
        this.subscribers.delete(sessionId);
      }
    });
    if (cleaned > 0) {
      this.logger.debug(`Cleaned up ${cleaned} stale SSE subscribers`);
    }
  }

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * 새 메시지 이벤트 → 모든 구독자에게 브로드캐스트
   */
  @OnEvent(CHATBOT_EVENTS.NEW_MESSAGE)
  handleNewMessage(event: ChatbotNewMessageEvent): void {
    const subs = this.subscribers.get(event.sessionId);
    const subCount = subs?.size ?? 0;

    this.logger.log(
      `SSE handleNewMessage: session=${event.sessionId}, role=${event.message.role}, subscribers=${subCount}`,
    );

    const eventData = JSON.stringify({
      id: event.message.id,
      role: event.message.role,
      content: event.message.content,
      createdAt: event.message.createdAt,
    });

    // 이벤트 큐에 저장 (연결 여부와 관계없이)
    const queuedEvent = this.queueEvent(event.sessionId, {
      type: 'newMessage',
      data: eventData,
    });

    if (!subs || subs.size === 0) {
      this.logger.log(
        `No SSE subscribers for session: ${event.sessionId}, event queued: ${queuedEvent.id}`,
      );
      return;
    }

    // 모든 구독자에게 전송
    let sentCount = 0;
    for (const subject of subs) {
      if (subject.closed) continue;
      try {
        subject.next({
          type: 'newMessage',
          data: eventData,
          id: queuedEvent.id,
        });
        sentCount++;
      } catch (error) {
        this.logger.error(`Failed to send SSE to subscriber: ${error}`);
      }
    }

    this.logger.log(
      `SSE newMessage sent: session=${event.sessionId}, role=${event.message.role}, sentTo=${sentCount}/${subCount}`,
    );
  }

  /**
   * 견적 상태 변경 이벤트 → 모든 구독자에게 브로드캐스트
   */
  @OnEvent(CHATBOT_EVENTS.ESTIMATE_STATUS_CHANGED)
  handleEstimateStatusChanged(event: ChatbotEstimateStatusEvent): void {
    const eventData = JSON.stringify({
      estimateId: event.estimateId,
      status: event.status,
    });

    const queuedEvent = this.queueEvent(event.sessionId, {
      type: 'estimateStatusChanged',
      data: eventData,
    });

    const subs = this.subscribers.get(event.sessionId);
    if (!subs || subs.size === 0) {
      this.logger.debug(
        `No SSE subscribers for session: ${event.sessionId}, estimate event queued: ${queuedEvent.id}`,
      );
      return;
    }

    for (const subject of subs) {
      if (subject.closed) continue;
      try {
        subject.next({
          type: 'estimateStatusChanged',
          data: eventData,
          id: queuedEvent.id,
        });
      } catch (error) {
        this.logger.error(
          `Failed to send SSE estimateStatusChanged: ${error}`,
        );
      }
    }
  }

  /**
   * Send a ping to keep all connections alive for a session
   */
  sendPing(sessionId: string): void {
    const subs = this.subscribers.get(sessionId);
    if (!subs) return;

    const pingData: MessageEvent = {
      type: 'ping',
      data: JSON.stringify({ timestamp: Date.now() }),
    };

    for (const subject of subs) {
      if (!subject.closed) {
        subject.next(pingData);
      }
    }
  }

  /**
   * 세션 삭제 시 관련 구독자 및 이벤트 큐 정리
   */
  cleanupSession(sessionId: string): void {
    const subs = this.subscribers.get(sessionId);
    if (subs) {
      subs.forEach((subject) => subject.complete());
      this.subscribers.delete(sessionId);
    }
    this.eventQueues.delete(sessionId);
    this.logger.debug(`Cleaned up SSE resources for session: ${sessionId}`);
  }

  /**
   * Get total active subscriber count (for monitoring)
   */
  getActiveSubscriberCount(): number {
    let total = 0;
    this.subscribers.forEach((subs) => {
      total += subs.size;
    });
    return total;
  }
}
