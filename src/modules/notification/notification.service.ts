import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  NotificationDto,
  NotificationListDto,
  NotificationQueryDto,
} from './dto/notification.dto';

@Injectable()
export class NotificationService {
  constructor(private prisma: PrismaService) {}

  async getNotifications(
    agentId: number,
    query: NotificationQueryDto,
  ): Promise<NotificationListDto> {
    const { page = 1, limit = 20, type, unreadOnly } = query;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {
      recipientAgentId: agentId,
    };

    if (type) {
      where.type = type;
    }

    if (unreadOnly) {
      where.isRead = false;
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

  async deleteNotification(agentId: number, notificationId: number): Promise<void> {
    await this.prisma.notification.deleteMany({
      where: {
        id: notificationId,
        recipientAgentId: agentId,
      },
    });
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
      type: 'new_estimate_request',
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

  private getTourTypeKorean(tourType?: string): string {
    const tourTypeMap: Record<string, string> = {
      'ai-custom': 'AI 맞춤 투어',
      'history-group': '역사/그룹 투어',
      'online': '온라인 투어',
      'private': '프라이빗 투어',
      'custom': '맞춤 투어',
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
