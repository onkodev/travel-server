import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SupabaseService } from '../../supabase/supabase.service';
import { NotificationService } from '../notification/notification.service';
import { ChatbotService } from './chatbot.service';
import { ESTIMATE_STATUS } from '../estimate/dto';

@Injectable()
export class ChatbotMessageService {
  private readonly logger = new Logger(ChatbotMessageService.name);

  constructor(
    private prisma: PrismaService,
    private supabaseService: SupabaseService,
    private notificationService: NotificationService,
    private chatbotService: ChatbotService,
  ) {}

  /**
   * 메시지 저장 후 공통 처리:
   * - 첫 사용자 메시지 → 세션 제목 자동 설정
   * - user 메시지 & 견적 sent 상태 → 관리자 알림
   */
  private async processAfterMessageSave(
    sessionId: string,
    savedMessages: Array<{ id: number; role: string; content: string; createdAt: Date }>,
    flow: { estimateId: number | null; customerName: string | null; title: string | null },
  ) {
    const firstUserMsg = savedMessages.find((m) => m.role === 'user');

    // 첫 번째 사용자 메시지로 세션 제목 자동 설정 (이미 title이 있으면 스킵)
    if (firstUserMsg && !flow.title) {
      const existingUserMsgCount = await this.prisma.chatbotMessage.count({
        where: { sessionId, role: 'user' },
      });
      const userMsgsInBatch = savedMessages.filter((m) => m.role === 'user').length;

      if (existingUserMsgCount === userMsgsInBatch) {
        const title =
          firstUserMsg.content.slice(0, 50) +
          (firstUserMsg.content.length > 50 ? '...' : '');
        await this.prisma.chatbotFlow.update({
          where: { sessionId },
          data: { title },
        });
      }

      // 고객이 메시지를 보냈고, 견적이 전송된 상태라면 관리자에게 알림
      if (flow.estimateId) {
        const estimate = await this.prisma.estimate.findUnique({
          where: { id: flow.estimateId },
          select: { statusAi: true, customerName: true },
        });

        if (estimate?.statusAi === 'sent') {
          try {
            await this.notificationService.notifyCustomerMessage({
              sessionId,
              customerName:
                estimate.customerName || flow.customerName || undefined,
              messagePreview: firstUserMsg.content,
            });
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            this.logger.error(
              `Failed to send customer message notification: ${errorMessage}`,
            );
          }
        }
      }
    }
  }

  // 메시지 저장
  async saveMessage(
    sessionId: string,
    data: {
      role: 'bot' | 'user' | 'admin';
      content: string;
      messageType?: 'text' | 'options' | 'form' | 'estimate' | 'quickReply';
      options?: unknown;
    },
  ) {
    const flow = await this.chatbotService.getFlow(sessionId);

    const message = await this.prisma.chatbotMessage.create({
      data: {
        sessionId,
        role: data.role,
        content: data.content,
        messageType: data.messageType || 'text',
        options: (data.options as Prisma.InputJsonValue) || undefined,
      },
    });

    await this.processAfterMessageSave(sessionId, [message], flow);

    return message;
  }

  // 메시지 배치 저장
  async saveMessagesBatch(
    sessionId: string,
    messages: Array<{
      role: 'bot' | 'user' | 'admin';
      content: string;
      messageType?: 'text' | 'options' | 'form' | 'estimate' | 'quickReply';
      options?: unknown;
    }>,
  ) {
    const flow = await this.chatbotService.getFlow(sessionId);

    if (!messages || messages.length === 0) {
      return { count: 0, messages: [] };
    }

    // createMany for single INSERT statement, then fetch created records
    const beforeCount = await this.prisma.chatbotMessage.count({
      where: { sessionId },
    });

    await this.prisma.chatbotMessage.createMany({
      data: messages.map((msg) => ({
        sessionId,
        role: msg.role,
        content: msg.content,
        messageType: msg.messageType || 'text',
        options: (msg.options as Prisma.InputJsonValue) || undefined,
      })),
    });

    const createdMessages = await this.prisma.chatbotMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      skip: beforeCount,
    });

    await this.processAfterMessageSave(sessionId, createdMessages, flow);

    return { count: createdMessages.length, messages: createdMessages };
  }

  // 메시지 목록 조회 (최근 500건)
  async getMessages(sessionId: string) {
    await this.chatbotService.validateSessionExists(sessionId);

    return this.prisma.chatbotMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      take: 500,
      select: {
        id: true,
        sessionId: true,
        role: true,
        content: true,
        messageType: true,
        options: true,
        createdAt: true,
      },
    });
  }

  // 사용자의 세션 목록 조회
  async getUserSessions(userId: string) {
    const flows = await this.prisma.chatbotFlow.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: {
        sessionId: true,
        title: true,
        currentStep: true,
        isCompleted: true,
        estimateId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // 견적 ID가 있는 세션들의 견적 정보 조회 (상태 + shareHash)
    const estimateIds = flows
      .filter((f) => f.estimateId)
      .map((f) => f.estimateId as number);

    const estimates =
      estimateIds.length > 0
        ? await this.prisma.estimate.findMany({
            where: { id: { in: estimateIds } },
            select: { id: true, statusAi: true, shareHash: true },
          })
        : [];

    const estimateMap = new Map(
      estimates.map((e) => [
        e.id,
        { statusAi: e.statusAi, shareHash: e.shareHash },
      ]),
    );

    const sessions = flows.map((flow) => {
      const estimateInfo = flow.estimateId
        ? estimateMap.get(flow.estimateId)
        : null;
      // 견적 없이 완료된 세션은 pending (전문가 검토 대기)
      const estimateStatus = estimateInfo?.statusAi
        || (flow.isCompleted && !flow.estimateId ? ESTIMATE_STATUS.PENDING : null);
      return {
        sessionId: flow.sessionId,
        title: flow.title,
        currentStep: flow.currentStep,
        isCompleted: flow.isCompleted,
        estimateId: flow.estimateId,
        estimateStatus,
        estimateShareHash: estimateInfo?.shareHash || null,
        createdAt: flow.createdAt,
        updatedAt: flow.updatedAt,
      };
    });

    return { sessions };
  }

  // 세션을 사용자에게 연결
  async linkSessionToUser(sessionId: string, userId: string) {
    const flow = await this.chatbotService.getFlow(sessionId);

    // 이미 다른 사용자에게 연결된 세션인지 확인
    if (flow.userId && flow.userId !== userId) {
      this.logger.warn(`Session ${sessionId} already linked to another user`);
      // 이미 다른 사용자 세션이면 조용히 성공 반환 (보안상 에러 노출 안함)
      return { success: true, linked: false };
    }

    // 이미 같은 사용자에게 연결되어 있으면 스킵
    if (flow.userId === userId) {
      return { success: true, linked: false, message: 'Already linked' };
    }

    // 원자적 업데이트 — TOCTOU 레이스 방지 (userId가 null이거나 같은 사용자일 때만 연결)
    const atomicCheck = await this.prisma.chatbotFlow.updateMany({
      where: { sessionId, OR: [{ userId: null }, { userId }] },
      data: { userId },
    });
    if (atomicCheck.count === 0) {
      this.logger.warn(`Session ${sessionId} was linked to another user between read and write`);
      return { success: true, linked: false };
    }

    // 사용자 프로필 조회
    const userProfile = await this.supabaseService.getUserProfile(userId);

    // 비회원 정보와 로그인한 사용자 정보 비교
    const guestName = flow.customerName;
    const guestEmail = flow.customerEmail;
    const loggedInName = userProfile?.name || userProfile?.full_name;
    const loggedInEmail = userProfile?.email;

    const nameMismatch =
      guestName &&
      loggedInName &&
      guestName.toLowerCase() !== loggedInName.toLowerCase();
    const emailMismatch =
      guestEmail &&
      loggedInEmail &&
      guestEmail.toLowerCase() !== loggedInEmail.toLowerCase();
    const hasInfoMismatch = !!(nameMismatch || emailMismatch);

    // 세션을 사용자에게 연결 + 정보 불일치 기록
    await this.prisma.chatbotFlow.update({
      where: { sessionId },
      data: {
        userId,
        infoMismatch: hasInfoMismatch,
        // 불일치 시 게스트 원본 정보 보존 (나중에 어드민이 확인용)
        ...(hasInfoMismatch && guestName && { guestName }),
        ...(hasInfoMismatch && guestEmail && { guestEmail }),
        // 로그인 정보로 고객 정보 업데이트
        ...(loggedInName && { customerName: loggedInName }),
        ...(loggedInEmail && { customerEmail: loggedInEmail }),
      },
    });

    this.logger.log(
      `Session ${sessionId} linked to user ${userId}${hasInfoMismatch ? ' (info mismatch detected)' : ''}`,
    );

    // Estimate도 로그인 정보로 업데이트
    if (flow.estimateId && (loggedInName || loggedInEmail)) {
      await this.prisma.estimate.update({
        where: { id: flow.estimateId },
        data: {
          ...(loggedInName && { customerName: loggedInName }),
          ...(loggedInEmail && { customerEmail: loggedInEmail }),
        },
      });
      this.logger.log(
        `Estimate ${flow.estimateId} updated with logged-in user info`,
      );
    }

    if (nameMismatch || emailMismatch) {
      // 채팅 메시지로 시스템 알림 저장 (어드민이 볼 수 있도록)
      const mismatchDetails: string[] = [];
      if (nameMismatch) {
        mismatchDetails.push(`Name: "${guestName}" → "${loggedInName}"`);
      }
      if (emailMismatch) {
        mismatchDetails.push(`Email: "${guestEmail}" → "${loggedInEmail}"`);
      }

      const systemMessage = `🔔 User logged in with different info:\n${mismatchDetails.join('\n')}\n\nGuest info was provided during the initial inquiry. Please verify with the customer.`;

      // 시스템 메시지 저장 (봇 메시지로)
      await this.saveMessage(sessionId, {
        role: 'bot',
        content: systemMessage,
        messageType: 'text',
      });

      // 어드민에게 알림 생성
      try {
        await this.notificationService.notifyAdmins({
          type: 'user_info_mismatch',
          title: '사용자 정보 불일치',
          message: `${guestName || '고객'}님이 다른 정보로 로그인했습니다. ${mismatchDetails.join(', ')}`,
          relatedSessionId: sessionId,
          relatedEstimateId: flow.estimateId || undefined,
          metadata: {
            guestName,
            guestEmail,
            loggedInName,
            loggedInEmail,
          },
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Failed to send user mismatch notification: ${errorMessage}`,
        );
      }
    }

    return {
      success: true,
      linked: true,
      infoMismatch: nameMismatch || emailMismatch,
    };
  }

  // 세션 제목 업데이트
  async updateSessionTitle(
    sessionId: string,
    title: string,
    userId: string,
    userRole?: string,
  ) {
    const flow = await this.chatbotService.getFlow(sessionId);

    // 관리자가 아니면 소유자만 수정 가능
    const isAdmin = userRole === 'admin';
    if (!isAdmin && flow.userId && flow.userId !== userId) {
      throw new ForbiddenException(
        'You do not have permission to modify this session.',
      );
    }

    return this.prisma.chatbotFlow.update({
      where: { sessionId },
      data: { title },
    });
  }
}
