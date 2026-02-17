import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  NotificationDto,
  NotificationListDto,
  NotificationQueryDto,
} from './dto/notification.dto';
import { calculateSkip } from '../../common/dto/pagination.dto';

// 알림 타입 상수
export const NOTIFICATION_TYPES = {
  NEW_ESTIMATE_REQUEST: 'new_estimate_request',
  PAYMENT_COMPLETED: 'payment_completed',
  MODIFICATION_REQUEST: 'modification_request',
  ESTIMATE_SENT: 'estimate_sent',
  CUSTOMER_MESSAGE: 'customer_message',
  GENERAL_INQUIRY: 'general_inquiry',
} as const;

export type NotificationType =
  (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

@Injectable()
export class NotificationService {
  constructor(private prisma: PrismaService) {}

  async getNotifications(
    agentId: number,
    query: NotificationQueryDto,
  ): Promise<NotificationListDto> {
    const { page = 1, limit = 20, type, unreadOnly, readOnly } = query;
    const skip = calculateSkip(page, limit);

    const where: Record<string, unknown> = {
      recipientAgentId: agentId,
    };

    if (type) {
      where.type = type;
    }

    if (unreadOnly) {
      where.isRead = false;
    } else if (readOnly) {
      where.isRead = true;
    }

    const [notifications, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({
        where: { recipientAgentId: agentId, isRead: false },
      }),
    ]);

    return {
      notifications: notifications.map(this.toDto),
      total,
      unreadCount,
    };
  }

  async getUnreadCount(agentId: number): Promise<number> {
    return this.prisma.notification.count({
      where: { recipientAgentId: agentId, isRead: false },
    });
  }

  async markAsRead(agentId: number, notificationIds: number[]): Promise<void> {
    await this.prisma.notification.updateMany({
      where: {
        id: { in: notificationIds },
        recipientAgentId: agentId,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });
  }

  async markAllAsRead(agentId: number): Promise<void> {
    await this.prisma.notification.updateMany({
      where: {
        recipientAgentId: agentId,
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });
  }

  async deleteNotification(
    agentId: number,
    notificationId: number,
  ): Promise<void> {
    await this.prisma.notification.deleteMany({
      where: {
        id: notificationId,
        recipientAgentId: agentId,
      },
    });
  }

  async deleteNotifications(
    agentId: number,
    notificationIds: number[],
  ): Promise<number> {
    const result = await this.prisma.notification.deleteMany({
      where: {
        id: { in: notificationIds },
        recipientAgentId: agentId,
      },
    });
    return result.count;
  }

  async createNotification(data: {
    type: string;
    recipientAgentId: number;
    title: string;
    message: string;
    relatedEstimateId?: number;
    relatedSessionId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<NotificationDto> {
    const notification = await this.prisma.notification.create({
      data: {
        type: data.type,
        recipientAgentId: data.recipientAgentId,
        title: data.title,
        message: data.message,
        relatedEstimateId: data.relatedEstimateId,
        relatedSessionId: data.relatedSessionId,
        metadata: data.metadata as object,
      },
    });

    return this.toDto(notification);
  }

  // 새 견적 요청이 들어왔을 때 모든 관리자에게 알림 생성
  async notifyNewEstimateRequest(data: {
    estimateId?: number;
    sessionId?: string;
    customerName?: string;
    tourType?: string;
  }): Promise<void> {
    // 기본 관리자 ID (실제 환경에서는 관리자 목록을 조회해야 함)
    const adminAgentId = 1;

    const customerDisplay = data.customerName || '고객';
    const tourTypeDisplay = this.getTourTypeKorean(data.tourType);

    await this.createNotification({
      type: NOTIFICATION_TYPES.NEW_ESTIMATE_REQUEST,
      recipientAgentId: adminAgentId,
      title: '새로운 상담 요청',
      message: `${customerDisplay}님이 ${tourTypeDisplay} 상담을 요청했습니다.`,
      relatedEstimateId: data.estimateId,
      relatedSessionId: data.sessionId,
      metadata: {
        customerName: data.customerName,
        tourType: data.tourType,
      },
    });
  }

  // 관리자 알림 생성 공통 메서드
  async notifyAdmins(data: {
    type: string;
    title: string;
    message: string;
    relatedEstimateId?: number;
    relatedSessionId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    // 현재는 모든 관리자가 agentId = 1을 공유
    // 향후 개별 관리자 알림이 필요하면 여기서 관리자 목록 조회 후 각각 생성
    const adminAgentId = 1;

    await this.createNotification({
      type: data.type,
      recipientAgentId: adminAgentId,
      title: data.title,
      message: data.message,
      relatedEstimateId: data.relatedEstimateId,
      relatedSessionId: data.relatedSessionId,
      metadata: data.metadata,
    });
  }

  // 고객 결제 완료 알림
  async notifyPaymentCompleted(data: {
    estimateId: number;
    customerName?: string;
    amount: number;
    currency?: string;
  }): Promise<void> {
    const customerDisplay = data.customerName || '고객';
    const amountDisplay = `${data.currency || 'USD'} ${data.amount.toLocaleString()}`;

    await this.notifyAdmins({
      type: NOTIFICATION_TYPES.PAYMENT_COMPLETED,
      title: '결제 완료',
      message: `${customerDisplay}님이 견적 #${data.estimateId}에 대해 ${amountDisplay} 결제를 완료했습니다.`,
      relatedEstimateId: data.estimateId,
      metadata: {
        customerName: data.customerName,
        amount: data.amount,
        currency: data.currency,
      },
    });
  }

  // 고객 수정 요청 알림
  async notifyModificationRequest(data: {
    estimateId: number;
    sessionId?: string;
    customerName?: string;
    requestContent?: string;
  }): Promise<void> {
    const customerDisplay = data.customerName || '고객';

    await this.notifyAdmins({
      type: NOTIFICATION_TYPES.MODIFICATION_REQUEST,
      title: '견적 수정 요청',
      message: `${customerDisplay}님이 견적 #${data.estimateId}에 대해 수정을 요청했습니다.`,
      relatedEstimateId: data.estimateId,
      relatedSessionId: data.sessionId,
      metadata: {
        customerName: data.customerName,
        requestContent: data.requestContent,
      },
    });
  }

  // 견적 발송 완료 알림 (내부 로깅용)
  async notifyEstimateSent(data: {
    estimateId: number;
    customerName?: string;
    customerEmail?: string;
  }): Promise<void> {
    const customerDisplay = data.customerName || '고객';

    await this.notifyAdmins({
      type: NOTIFICATION_TYPES.ESTIMATE_SENT,
      title: '견적 발송 완료',
      message: `${customerDisplay}님에게 견적 #${data.estimateId}가 발송되었습니다.`,
      relatedEstimateId: data.estimateId,
      metadata: {
        customerName: data.customerName,
        customerEmail: data.customerEmail,
      },
    });
  }

  // 고객 채팅 메시지 알림
  async notifyCustomerMessage(data: {
    sessionId: string;
    customerName?: string;
    messagePreview?: string;
  }): Promise<void> {
    const customerDisplay = data.customerName || '고객';
    const preview = data.messagePreview
      ? data.messagePreview.length > 50
        ? data.messagePreview.slice(0, 50) + '...'
        : data.messagePreview
      : '';

    await this.notifyAdmins({
      type: NOTIFICATION_TYPES.CUSTOMER_MESSAGE,
      title: '새 고객 메시지',
      message: preview
        ? `${customerDisplay}님: "${preview}"`
        : `${customerDisplay}님이 메시지를 보냈습니다.`,
      relatedSessionId: data.sessionId,
      metadata: {
        customerName: data.customerName,
        messagePreview: data.messagePreview,
      },
    });
  }

  private getTourTypeKorean(tourType?: string): string {
    const tourTypeMap: Record<string, string> = {
      'ai-custom': 'AI 맞춤 투어',
      'history-group': '역사/그룹 투어',
      online: '온라인 투어',
      private: '프라이빗 투어',
      custom: '맞춤 투어',
    };
    return tourTypeMap[tourType || ''] || '맞춤 투어';
  }

  private toDto(notification: {
    id: number;
    type: string;
    title: string;
    message: string;
    isRead: boolean;
    relatedEstimateId: number | null;
    relatedSessionId: string | null;
    metadata: unknown;
    createdAt: Date;
    readAt: Date | null;
  }): NotificationDto {
    return {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      isRead: notification.isRead,
      relatedEstimateId: notification.relatedEstimateId ?? undefined,
      relatedSessionId: notification.relatedSessionId ?? undefined,
      metadata: notification.metadata as Record<string, unknown> | undefined,
      createdAt: notification.createdAt,
      readAt: notification.readAt ?? undefined,
    };
  }
}
