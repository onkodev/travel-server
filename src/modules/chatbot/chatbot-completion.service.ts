import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { EstimateService } from '../estimate/estimate.service';
import { ESTIMATE_STATUS } from '../estimate/dto';
import { AiEstimateService } from './ai-estimate.service';
import { ChatbotStepResponseService } from './chatbot-step-response.service';
import { NotificationService } from '../notification/notification.service';
import { EmailService } from '../email/email.service';
import {
  chatbotInquiryAdminTemplate,
  modificationRequestTemplate,
} from '../email/email-templates';
import { EstimateItem, EstimateStatusAi, EstimateSource } from '../../common/types';
import { formatDateKR } from '../../common/utils';
import { ESTIMATE_EVENTS } from '../../common/events';
import type { EstimateSentEvent } from '../../common/events';
import { ChatbotService } from './chatbot.service';
import { ChatbotMessageService } from './chatbot-message.service';

@Injectable()
export class ChatbotCompletionService {
  private readonly logger = new Logger(ChatbotCompletionService.name);

  constructor(
    private prisma: PrismaService,
    private estimateService: EstimateService,
    private aiEstimateService: AiEstimateService,
    private stepResponseService: ChatbotStepResponseService,
    private notificationService: NotificationService,
    private emailService: EmailService,
    private configService: ConfigService,
    private eventEmitter: EventEmitter2,
    private chatbotService: ChatbotService,
    private chatbotMessageService: ChatbotMessageService,
  ) {}

  // 플로우 완료 및 견적 생성 (AI 기반)
  async completeFlow(sessionId: string, userId?: string) {
    this.logger.log(
      `Starting completeFlow for session: ${sessionId}, userId: ${userId || 'anonymous'}`,
    );
    const flow = await this.chatbotService.getFlow(sessionId, true);

    // 이미 완료되었고 견적이 있으면 기존 결과 반환
    if (flow.isCompleted && flow.estimateId) {
      const existingEstimate = await this.prisma.estimate.findUnique({
        where: { id: flow.estimateId },
        select: { shareHash: true, statusAi: true },
      });
      return {
        success: true,
        estimateId: flow.estimateId,
        shareHash: existingEstimate?.shareHash || null,
        status: existingEstimate?.statusAi || 'draft',
        alreadyCompleted: true,
      };
    }

    // 소유자 검증 (userId가 주어지고 flow에도 userId가 있으면 일치해야 함)
    if (userId && flow.userId && flow.userId !== userId) {
      throw new ForbiddenException(
        'You do not have permission to complete this session.',
      );
    }

    // Step 6까지 완료 확인 (currentStep ≥ 7)
    if (flow.currentStep < 7) {
      throw new BadRequestException(
        'Please complete all steps before generating an estimate.',
      );
    }

    try {
      // AI 견적 생성
      const aiResult =
        await this.aiEstimateService.generateFirstEstimate(sessionId);

      // 챗봇 플로우 완료 처리
      await this.prisma.chatbotFlow.update({
        where: { sessionId },
        data: {
          isCompleted: true,
          ...(userId && { userId }),
        },
      });

      this.logger.log(
        `AI estimate generated for session: ${sessionId}, estimateId: ${aiResult.estimateId}`,
      );

      // Visitor 전환 추적 (fire-and-forget)
      if (flow.visitorId) {
        this.prisma.visitorSession
          .update({
            where: { id: flow.visitorId },
            data: { hasChatbot: true, hasEstimate: true },
          })
          .catch((err) => {
            this.logger.warn(
              `Failed to update visitor conversion: ${err.message}`,
            );
          });
      }

      return {
        success: true,
        estimateId: aiResult.estimateId,
        shareHash: aiResult.shareHash,
        status: 'draft',
      };
    } catch (error) {
      this.logger.error(
        `AI estimate generation failed for session ${sessionId}: ${error.message}`,
      );

      // AI 실패해도 플로우는 완료 처리하지 않음 (재시도 가능)
      throw new InternalServerErrorException(
        'Failed to generate estimate. Please try again or contact support.',
      );
    }
  }

  /**
   * 알림/이메일 발송 전용 private 메서드
   * DB 변경 없이 알림만 담당 (푸시 알림, 관리자 이메일, 고객 확인 이메일)
   */
  private async notifyExpertSubmission(
    sessionId: string,
    flow: Awaited<ReturnType<ChatbotService['getFlow']>>,
  ) {
    const notificationResults = {
      pushNotification: { sent: false, error: null as string | null },
      adminEmail: { sent: false, error: null as string | null },
      customerEmail: {
        sent: false,
        error: null as string | null,
        skipped: false,
      },
    };

    // 관리자에게 푸시 알림 전송
    try {
      await this.notificationService.notifyNewEstimateRequest({
        estimateId: flow.estimateId ?? undefined,
        sessionId: sessionId,
        customerName: flow.customerName ?? undefined,
        tourType: flow.tourType ?? undefined,
      });
      notificationResults.pushNotification.sent = true;
      this.logger.log(`Notification sent for session: ${sessionId}`);
    } catch (error) {
      notificationResults.pushNotification.error = error.message;
      this.logger.error(`Failed to send notification: ${error.message}`);
    }

    // 방문자 브라우징 기록 조회 (이메일 내용용)
    let visitedProducts: string[] = [];
    if (flow.visitorId) {
      try {
        const visitorSession = await this.prisma.visitorSession.findUnique({
          where: { id: flow.visitorId },
          include: {
            pageViews: {
              orderBy: { createdAt: 'asc' },
              select: { path: true, title: true },
            },
          },
        });
        if (visitorSession?.pageViews) {
          visitedProducts = visitorSession.pageViews
            .filter((pv) => pv.title && pv.path?.startsWith('/tour'))
            .map((pv) => pv.title!);
        }
      } catch (err) {
        this.logger.warn(
          `Failed to fetch visitor browsing history: ${err.message}`,
        );
      }
    }

    // 관리자 + 고객 이메일 병렬 발송
    const adminEmail = this.chatbotService.getAdminEmail();

    const travelDateStr = flow.travelDate
      ? new Date(flow.travelDate).toLocaleDateString('en-US', {
          month: '2-digit',
          day: '2-digit',
          year: 'numeric',
        })
      : '';

    const labels = this.chatbotService.resolveLabels(flow);
    const adminUrl =
      this.configService.get<string>('CLIENT_URL') || 'http://localhost:3000';

    const emailPromises: Promise<void>[] = [];

    // 관리자 이메일
    emailPromises.push(
      this.emailService
        .sendEmail({
          to: adminEmail,
          subject: `[New Inquiry] ${flow.customerName || 'Customer'} - ${flow.tourType || 'Tour'} Request`,
          html: chatbotInquiryAdminTemplate({
            customerName: flow.customerName ?? '-',
            customerEmail: flow.customerEmail ?? '-',
            customerPhone: flow.customerPhone ?? '-',
            nationality: flow.nationality ?? '-',
            ipAddress: flow.ipAddress ?? '-',
            countryName: flow.countryName ?? '',
            country: flow.country ?? '',
            tourType: flow.tourType ?? '',
            needsPickup: flow.needsPickup ?? false,
            isFirstVisit: flow.isFirstVisit ?? false,
            travelDate: travelDateStr,
            duration: flow.duration ?? 0,
            budgetRange: flow.budgetRange ?? '',
            adultsCount: flow.adultsCount ?? 0,
            childrenCount: flow.childrenCount ?? 0,
            infantsCount: flow.infantsCount ?? 0,
            seniorsCount: flow.seniorsCount ?? 0,
            ageRange: flow.ageRange ?? '',
            interestLabels: labels.interestLabels,
            attractionLabels: labels.attractionLabels,
            region: flow.region ?? '',
            regionLabel: labels.regionLabel,
            tourTypeLabel: labels.tourTypeLabel,
            budgetLabel: labels.budgetLabel,
            additionalNotes: flow.additionalNotes ?? '',
            needsGuide: flow.needsGuide ?? false,
            hasPlan: flow.hasPlan ?? null,
            planDetails: flow.planDetails ?? '',
            visitedProducts,
            sessionId,
            adminUrl,
          }),
        })
        .then(() => {
          notificationResults.adminEmail.sent = true;
          this.logger.log(`Admin email sent for session: ${sessionId}`);
        })
        .catch((error) => {
          notificationResults.adminEmail.error = error.message;
          this.logger.error(`Failed to send admin email: ${error.message}`);
        }),
    );

    // 고객 확인 이메일
    if (flow.customerEmail) {
      const surveySummary = this.stepResponseService.buildSurveySummary(
        flow as Parameters<ChatbotStepResponseService['buildSurveySummary']>[0],
      );
      emailPromises.push(
        this.emailService
          .sendContactConfirmation({
            to: flow.customerEmail,
            customerName: flow.customerName || 'Customer',
            message: surveySummary,
          })
          .then(() => {
            notificationResults.customerEmail.sent = true;
            this.logger.log(
              `Confirmation email sent to customer: ${flow.customerEmail}`,
            );
          })
          .catch((error) => {
            notificationResults.customerEmail.error = error.message;
            this.logger.error(
              `Failed to send customer email: ${error.message}`,
            );
          }),
      );
    } else {
      notificationResults.customerEmail.skipped = true;
    }

    await Promise.all(emailPromises);

    return notificationResults;
  }

  /**
   * 전문가 알림 발송 public 래퍼 (컨트롤러에서 finalize 후 체이닝용)
   */
  async triggerExpertNotification(sessionId: string) {
    const flow = await this.chatbotService.getFlow(sessionId, true);
    try {
      await this.notifyExpertSubmission(sessionId, flow);
    } catch (error) {
      this.logger.error(
        `triggerExpertNotification failed for session ${sessionId}: ${error.message}`,
      );
    }
  }

  // 전문가에게 보내기 (견적 없이도 상담 요청 전송 가능)
  async sendToExpert(sessionId: string, userId?: string) {
    const flow = await this.chatbotService.getFlow(sessionId, true);

    // 소유자 검증 (userId가 주어지고 flow에도 userId가 있으면 일치해야 함)
    if (userId && flow.userId && flow.userId !== userId) {
      throw new ForbiddenException(
        'You do not have permission to submit this session.',
      );
    }

    // Atomic 멱등성 가드: isCompleted=false → true (TOCTOU 레이스 방지)
    const lockResult = await this.prisma.chatbotFlow.updateMany({
      where: { sessionId, isCompleted: false },
      data: { isCompleted: true },
    });
    if (lockResult.count === 0) {
      // 이미 완료됨 — 이메일 재발송 방지
      return {
        success: true,
        alreadySent: true,
        message: flow.estimateId
          ? 'Already sent to expert for review.'
          : 'Inquiry already submitted.',
        estimateId: flow.estimateId ?? null,
        status: ESTIMATE_STATUS.PENDING,
      };
    }

    // 알림/이메일 발송
    const notificationResults = await this.notifyExpertSubmission(
      sessionId,
      flow,
    );

    // 견적이 있으면 상태 업데이트
    let estimateStatus: string | null = ESTIMATE_STATUS.PENDING;
    if (flow.estimateId) {
      const estimate = await this.estimateService.updateAIStatus(
        flow.estimateId,
        ESTIMATE_STATUS.PENDING,
      );
      estimateStatus = estimate.statusAi || ESTIMATE_STATUS.PENDING;
    }

    // 알림 실패 여부 체크
    const hasNotificationFailure =
      !notificationResults.pushNotification.sent ||
      !notificationResults.adminEmail.sent ||
      (!notificationResults.customerEmail.sent &&
        !notificationResults.customerEmail.skipped);

    // 응답 생성
    const response = {
      success: true, // 핵심 작업(플로우 완료)은 성공
      message: flow.estimateId
        ? 'Sent to expert for review.'
        : 'Inquiry submitted. Our expert will contact you soon.',
      estimateId: flow.estimateId ?? null,
      status: estimateStatus,
      notifications: notificationResults,
      ...(hasNotificationFailure && {
        warning:
          'Some notifications could not be sent. Our team has been notified.',
      }),
    };

    // 알림 실패 시 관리자에게 경고 로그 (모니터링용)
    if (hasNotificationFailure) {
      this.logger.warn(
        `Partial notification failure for session ${sessionId}:`,
        notificationResults,
      );
    }

    return response;
  }

  // 고객 응답 (승인/수정요청)
  async respondToEstimate(
    sessionId: string,
    response: 'approved' | 'declined',
    modificationRequest?: string,
    revisionDetails?: {
      items?: Array<{
        itemIndex: number;
        action: 'keep' | 'remove' | 'replace';
        preference?: string;
      }>;
      dateChange?: string;
      durationChange?: number;
      groupChange?: { adults?: number; children?: number; infants?: number };
      budgetChange?: string;
      note?: string;
    },
    userId?: string,
  ) {
    const flow = await this.chatbotService.getFlow(sessionId);

    if (!flow.estimateId) {
      throw new NotFoundException('Estimate not found.');
    }

    // 소유자 검증
    if (userId && flow.userId && flow.userId !== userId) {
      throw new ForbiddenException(
        'You do not have permission to respond to this estimate.',
      );
    }

    // 상태 전이 검증 — sent 또는 pending 상태에서만 응답 가능
    const currentEstimate = await this.prisma.estimate.findUnique({
      where: { id: flow.estimateId },
      select: {
        statusAi: true,
        requestContent: true,
        customerName: true,
        revisionHistory: true,
      },
    });
    const respondableStates: string[] = [
      ESTIMATE_STATUS.SENT,
      ESTIMATE_STATUS.PENDING,
    ];
    if (!respondableStates.includes(currentEstimate?.statusAi || '')) {
      throw new BadRequestException(
        `Cannot respond in current state: ${currentEstimate?.statusAi}`,
      );
    }

    // 수정 요청이 있으면 revisionRequested 플래그 활성화 및 상태를 pending으로 변경
    if (modificationRequest || revisionDetails) {
      const existingContent = currentEstimate?.requestContent || '';
      const freeText = modificationRequest || revisionDetails?.note || '';
      const updatedContent = existingContent
        ? `${existingContent}\n\n--- Modification Request ---\n${freeText}`
        : freeText;

      // Build revision history entry
      const existingHistory = Array.isArray(currentEstimate?.revisionHistory)
        ? (currentEstimate.revisionHistory as Array<Record<string, unknown>>)
        : [];
      const newEntry = {
        revisionNumber: existingHistory.length + 1,
        requestedAt: new Date().toISOString(),
        details: revisionDetails || null,
        freeTextNote: modificationRequest || null,
        status: 'pending',
      };

      await this.prisma.estimate.update({
        where: { id: flow.estimateId },
        data: {
          requestContent: updatedContent,
          revisionRequested: true,
          revisionNote: freeText,
          revisedAt: new Date(),
          revisionHistory: [
            ...existingHistory,
            newEntry,
          ] as unknown as Prisma.InputJsonValue,
          statusAi: ESTIMATE_STATUS.PENDING,
        },
      });

      // 관리자에게 수정 요청 알림 전송 (DB 알림 + 이메일)
      try {
        await this.notificationService.notifyModificationRequest({
          estimateId: flow.estimateId,
          sessionId: sessionId,
          customerName:
            currentEstimate?.customerName || flow.customerName || undefined,
          requestContent: freeText,
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Failed to send modification request notification: ${errorMessage}`,
        );
      }

      // 관리자 이메일 발송
      try {
        const adminEmail = this.chatbotService.getAdminEmail();
        const adminUrl =
          this.configService.get<string>('CLIENT_URL') ||
          'http://localhost:3000';

        await this.emailService.sendEmail({
          to: adminEmail,
          subject: `[수정 요청] ${currentEstimate?.customerName || flow.customerName || '고객'}님 - 견적 #${flow.estimateId}`,
          html: modificationRequestTemplate({
            customerName:
              currentEstimate?.customerName || flow.customerName || '고객',
            customerEmail: flow.customerEmail || '-',
            estimateId: flow.estimateId,
            requestContent: freeText,
            sessionId: sessionId,
            adminUrl,
          }),
        });
        this.logger.log(
          `Modification request email sent for estimate #${flow.estimateId}`,
        );
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Failed to send modification request email: ${errorMessage}`,
        );
      }

      return {
        success: true,
        message:
          'Modification request submitted. Our expert will review and contact you.',
        status: ESTIMATE_STATUS.PENDING,
      };
    }

    // 거절인 경우 cancelled로
    if (response === 'declined') {
      const estimate = await this.estimateService.updateAIStatus(
        flow.estimateId,
        ESTIMATE_STATUS.CANCELLED,
      );
      return {
        success: true,
        message: 'Estimate declined.',
        status: estimate.statusAi,
      };
    }

    // 승인인 경우 approved로 (결제 대기)
    const estimate = await this.estimateService.updateAIStatus(
      flow.estimateId,
      ESTIMATE_STATUS.APPROVED,
    );

    return {
      success: true,
      message: 'Estimate approved. Please proceed to payment.',
      status: estimate.statusAi,
    };
  }

  // ============================================================================
  // 이벤트 핸들러
  // ============================================================================

  /**
   * 견적 발송 이벤트 핸들러
   * EstimateService에서 견적 발송 시 호출됨
   */
  @OnEvent(ESTIMATE_EVENTS.SENT)
  async handleEstimateSent(event: EstimateSentEvent) {
    try {
      await this.chatbotMessageService.saveMessage(event.chatSessionId, {
        role: 'bot',
        content: `🎉 Your personalized travel quotation is ready!\n\nPlease review the details and let us know if you'd like any modifications. You can click "Request Modification" to make changes, or "Accept" to confirm your booking.`,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to save chat message for estimate ${event.estimateId}: ${errorMessage}`,
      );
    }
  }

  // ============ 관리자용: 견적 생성 ============

  // 챗봇 플로우에서 견적 생성 (관리자)
  async createEstimateFromFlow(sessionId: string, title?: string) {
    const flow = await this.chatbotService.getFlow(sessionId);

    // 이미 견적이 연결되어 있으면 에러
    if (flow.estimateId) {
      throw new BadRequestException(
        '이 세션에는 이미 견적이 연결되어 있습니다.',
      );
    }

    // 견적 제목 생성
    const estimateTitle =
      title ||
      (flow.customerName
        ? `${flow.customerName}님 견적`
        : `상담 #${flow.id} 견적`);

    // 여행 날짜 계산
    let startDate: Date | null = null;
    let endDate: Date | null = null;
    if (flow.travelDate) {
      startDate = new Date(flow.travelDate);
      if (flow.duration && flow.duration > 1) {
        endDate = new Date(flow.travelDate);
        endDate.setDate(endDate.getDate() + flow.duration - 1);
      } else {
        endDate = startDate;
      }
    }

    // 관심사 배열 병합
    const interests = [
      ...(flow.interestMain || []),
      ...(flow.interestSub || []),
    ];

    // 질문 응답 내역 전체를 requestContent로 구성
    const requestContentParts: string[] = [];

    // Step 1: 투어 타입
    if (flow.tourType) {
      const tourTypeLabels: Record<string, string> = {
        private: '프라이빗 투어',
        car_only: '차량만',
        group: '그룹 투어',
        custom: '커스텀 투어',
      };
      requestContentParts.push(
        `[투어 타입] ${tourTypeLabels[flow.tourType] || flow.tourType}`,
      );
    }

    // Step 2: 첫 방문 여부
    if (flow.isFirstVisit !== null) {
      requestContentParts.push(
        `[한국 첫 방문] ${flow.isFirstVisit ? '예' : '아니오'}`,
      );
    }

    // Step 3: 계획 유무
    if (flow.hasPlan !== null) {
      requestContentParts.push(
        `[계획 유무] ${flow.hasPlan ? '계획 있음' : '계획 없음'}`,
      );
      if (flow.hasPlan && flow.isFlexible !== null) {
        requestContentParts.push(
          `[계획 수정 가능] ${flow.isFlexible ? '수정 가능' : '수정 불가'}`,
        );
      }
      if (flow.hasPlan && flow.planDetails) {
        requestContentParts.push(`[계획 상세]\n${flow.planDetails}`);
      }
    }

    // Step 4: 관심사
    if (flow.interestMain?.length || flow.interestSub?.length) {
      const allInterests = [
        ...(flow.interestMain || []),
        ...(flow.interestSub || []),
      ];
      requestContentParts.push(`[관심사] ${allInterests.join(', ')}`);
    }

    // Step 5: 지역
    if (flow.region) {
      requestContentParts.push(`[지역] ${flow.region}`);
    }

    // Step 6: 폼 입력 정보
    requestContentParts.push(`\n--- 여행 정보 ---`);
    if (flow.travelDate) {
      requestContentParts.push(
        `[여행일] ${formatDateKR(flow.travelDate)}`,
      );
    }
    if (flow.duration) {
      requestContentParts.push(`[기간] ${flow.duration}일`);
    }

    const totalPax =
      (flow.adultsCount || 0) +
      (flow.childrenCount || 0) +
      (flow.infantsCount || 0) +
      (flow.seniorsCount || 0);
    requestContentParts.push(
      `[인원] 총 ${totalPax}명 (성인 ${flow.adultsCount || 0}, 아동 ${flow.childrenCount || 0}, 유아 ${flow.infantsCount || 0}, 시니어 ${flow.seniorsCount || 0})`,
    );

    if (flow.budgetRange) {
      requestContentParts.push(`[예산] ${flow.budgetRange}`);
    }
    if (flow.needsPickup !== null) {
      requestContentParts.push(
        `[공항 픽업] ${flow.needsPickup ? '필요' : '불필요'}`,
      );
    }

    // 추가 요청사항
    if (flow.additionalNotes) {
      requestContentParts.push(`\n[추가 요청사항]\n${flow.additionalNotes}`);
    }

    const requestContent = requestContentParts.join('\n');

    // 견적 생성
    const estimate = await this.estimateService.createEstimate({
      title: estimateTitle,
      source: EstimateSource.AI,
      statusAi: EstimateStatusAi.DRAFT,
      customerName: flow.customerName ?? undefined,
      customerEmail: flow.customerEmail ?? undefined,
      customerPhone: flow.customerPhone ?? undefined,
      nationality: flow.nationality ?? undefined,
      startDate: startDate?.toISOString() ?? undefined,
      endDate: endDate?.toISOString() ?? undefined,
      travelDays: flow.duration || 1,
      adultsCount: flow.adultsCount || 1,
      childrenCount: flow.childrenCount || 0,
      infantsCount: flow.infantsCount || 0,
      regions: flow.region ? [flow.region] : [],
      interests,
      items: [],
      subtotal: 0,
      totalAmount: 0,
      currency: 'USD',
      chatSessionId: sessionId,
      requestContent,
    });

    // 챗봇 플로우에 견적 ID 연결
    await this.prisma.chatbotFlow.update({
      where: { sessionId },
      data: { estimateId: estimate.id },
    });

    return {
      estimateId: estimate.id,
      shareHash: estimate.shareHash,
    };
  }
}
