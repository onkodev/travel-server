import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { NotificationService } from '../notification/notification.service';
import { convertDecimalFields, jsonCast } from '../../common/utils';
import { ESTIMATE_STATUS } from './dto/estimate.dto';
import { ESTIMATE_EVENTS, EstimateSentEvent } from '../../common/events';

@Injectable()
export class EstimateDispatchService {
  private readonly logger = new Logger(EstimateDispatchService.name);

  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
    private notificationService: NotificationService,
    private eventEmitter: EventEmitter2,
  ) {}

  // 견적 발송 처리
  async sendEstimate(id: number) {
    // 조회 + 상태 업데이트를 트랜잭션으로 래핑
    const { estimate, updatedEstimate } = await this.prisma.$transaction(
      async (tx) => {
        const est = await tx.estimate.findUnique({ where: { id } });
        if (!est) {
          throw new NotFoundException(`견적 ID ${id}를 찾을 수 없습니다.`);
        }
        const updated = await tx.estimate.update({
          where: { id },
          data: {
            statusAi: ESTIMATE_STATUS.SENT,
            sentAt: new Date(),
          },
        });
        return { estimate: est, updatedEstimate: updated };
      },
    );

    // 고객 이메일이 있으면 이메일 발송
    if (estimate.customerEmail) {
      const items =
        jsonCast<
          Array<{
            name: string;
            type?: string;
            price: number;
            quantity: number;
            date?: string;
          }>
        >(estimate.items) || [];

      this.emailService
        .sendEstimate({
          to: estimate.customerEmail,
          customerName: estimate.customerName || 'Valued Customer',
          estimateTitle: estimate.title || 'Your Travel Quotation',
          shareHash: estimate.shareHash || '',
          items,
          totalAmount: Number(estimate.totalAmount) ?? 0,
          currency: estimate.currency || 'USD',
          travelDays: estimate.travelDays ?? undefined,
          startDate: estimate.startDate,
          endDate: estimate.endDate,
          adultsCount: estimate.adultsCount ?? undefined,
          childrenCount: estimate.childrenCount ?? undefined,
        })
        .catch((error) => {
          this.logger.error(
            `Failed to send estimate email to ${estimate.customerEmail}:`,
            error,
          );
          this.prisma.estimate
            .update({
              where: { id: estimate.id },
              data: {
                internalMemo: `[자동] 이메일 발송 실패: ${error.message?.substring(0, 200) || 'unknown'}`,
              },
            })
            .catch((dbErr) => {
              this.logger.error(
                `Failed to update estimate memo: ${dbErr.message}`,
              );
            });
        });
    }

    // 관리자에게 견적 발송 완료 알림
    this.notificationService
      .notifyEstimateSent({
        estimateId: estimate.id,
        estimateTitle: estimate.title || undefined,
        customerName: estimate.customerName || undefined,
        customerEmail: estimate.customerEmail || undefined,
      })
      .catch((error) => {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Failed to send estimate notification: ${errorMessage}`,
        );
      });

    // 채팅 세션이 있으면 이벤트 발송 (ChatbotService가 수신하여 메시지 저장)
    if (estimate.chatSessionId) {
      const event: EstimateSentEvent = {
        chatSessionId: estimate.chatSessionId,
        estimateId: estimate.id,
      };
      this.eventEmitter.emit(ESTIMATE_EVENTS.SENT, event);
    }

    return convertDecimalFields(updatedEstimate);
  }
}
