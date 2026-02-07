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

interface MessageEvent {
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
  private readonly subscribers = new Map<string, Subject<MessageEvent>>();

  // 이벤트 큐: 연결 끊김 시 메시지 손실 방지
  private readonly eventQueues = new Map<string, QueuedEvent[]>();

  // Cleanup interval to remove stale subscribers (5 minutes)
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Periodic cleanup of stale connections and expired events
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleSubscribers();
      this.cleanupExpiredEvents();
    }, CLEANUP_INTERVAL_MS);
  }

  onModuleDestroy() {
    clearInterval(this.cleanupInterval);
    // Complete all subjects on shutdown
    this.subscribers.forEach((subject) => {
      subject.complete();
    });
    this.subscribers.clear();
    this.eventQueues.clear();
  }

  // ============================================================================
  // Event Queue Management
  // ============================================================================

  /**
   * 이벤트를 큐에 추가 (연결 끊김 시 메시지 손실 방지)
   */
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

    // 최대 크기 초과 시 오래된 이벤트 제거
    while (queue.length > EVENT_QUEUE_MAX_SIZE) {
      queue.shift();
    }

    return queuedEvent;
  }

  /**
   * 특정 시간 이후의 누락된 이벤트 조회 (재연결 시 사용)
   */
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

  /**
   * 만료된 이벤트 정리
   */
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
      this.logger.debug(`Cleaned up ${totalCleaned} expired events from queue`);
    }
  }

  /**
   * Get or create a Subject for a session
   */
  getOrCreateSubject(sessionId: string): Subject<MessageEvent> {
    let subject = this.subscribers.get(sessionId);

    if (!subject || subject.closed) {
      subject = new Subject<MessageEvent>();
      this.subscribers.set(sessionId, subject);
      this.logger.log(
        `SSE subscription created for session: ${sessionId}, totalSubscribers=${this.subscribers.size}`,
      );
    } else {
      this.logger.debug(`SSE subscription reused for session: ${sessionId}`);
    }

    return subject;
  }

  /**
   * Remove subscriber when client disconnects
   */
  removeSubscriber(sessionId: string): void {
    const subject = this.subscribers.get(sessionId);
    if (subject) {
      subject.complete();
      this.subscribers.delete(sessionId);
      this.logger.log(
        `SSE subscription removed for session: ${sessionId}, remainingSubscribers=${this.subscribers.size}`,
      );
    }
  }

  /**
   * Cleanup stale subscribers (subjects that have been closed)
   */
  private cleanupStaleSubscribers(): void {
    let cleaned = 0;
    this.subscribers.forEach((subject, sessionId) => {
      if (subject.closed) {
        this.subscribers.delete(sessionId);
        cleaned++;
      }
    });
    if (cleaned > 0) {
      this.logger.debug(`Cleaned up ${cleaned} stale SSE subscribers`);
    }
  }

  /**
   * Handle new message event
   * 이벤트를 큐에 저장 후 SSE로 전송 (연결 끊김 시에도 큐에 보관)
   */
  @OnEvent(CHATBOT_EVENTS.NEW_MESSAGE)
  handleNewMessage(event: ChatbotNewMessageEvent): void {
    const subscribersList = Array.from(this.subscribers.keys());
    this.logger.log(
      `SSE handleNewMessage: session=${event.sessionId}, role=${event.message.role}, totalSubscribers=${this.subscribers.size}, subscribedSessions=[${subscribersList.join(', ')}]`,
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

    const subject = this.subscribers.get(event.sessionId);
    if (!subject || subject.closed) {
      this.logger.log(
        `No active SSE subscriber for session: ${event.sessionId}, event queued: ${queuedEvent.id}`,
      );
      return;
    }

    try {
      subject.next({
        type: 'newMessage',
        data: eventData,
        id: queuedEvent.id, // 이벤트 ID 포함 (클라이언트 중복 방지용)
      });
      this.logger.log(
        `SSE newMessage sent: session=${event.sessionId}, role=${event.message.role}`,
      );
    } catch (error) {
      this.logger.error(`Failed to send SSE newMessage: ${error}`);
      // 큐에는 이미 저장되어 있으므로 재연결 시 클라이언트가 가져갈 수 있음
    }
  }

  /**
   * Handle estimate status changed event
   * 이벤트를 큐에 저장 후 SSE로 전송 (연결 끊김 시에도 큐에 보관)
   */
  @OnEvent(CHATBOT_EVENTS.ESTIMATE_STATUS_CHANGED)
  handleEstimateStatusChanged(event: ChatbotEstimateStatusEvent): void {
    const eventData = JSON.stringify({
      estimateId: event.estimateId,
      status: event.status,
    });

    // 이벤트 큐에 저장
    const queuedEvent = this.queueEvent(event.sessionId, {
      type: 'estimateStatusChanged',
      data: eventData,
    });

    const subject = this.subscribers.get(event.sessionId);
    if (!subject || subject.closed) {
      this.logger.debug(
        `No active SSE subscriber for session: ${event.sessionId}, estimate status event queued: ${queuedEvent.id}`,
      );
      return;
    }

    try {
      subject.next({
        type: 'estimateStatusChanged',
        data: eventData,
        id: queuedEvent.id,
      });
      this.logger.debug(
        `SSE estimateStatusChanged sent for session: ${event.sessionId}, status: ${event.status}`,
      );
    } catch (error) {
      this.logger.error(`Failed to send SSE estimateStatusChanged: ${error}`);
    }
  }

  /**
   * Send a ping to keep connection alive
   */
  sendPing(sessionId: string): void {
    const subject = this.subscribers.get(sessionId);
    if (!subject || subject.closed) {
      return;
    }

    subject.next({
      type: 'ping',
      data: JSON.stringify({ timestamp: Date.now() }),
    });
  }

  /**
   * Get active subscriber count (for monitoring)
   */
  getActiveSubscriberCount(): number {
    return this.subscribers.size;
  }
}
