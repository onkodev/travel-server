import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { EmailService } from '../email/email.service';
import {
  CreateContactDto,
  ContactQueryDto,
  ContactListDto,
} from './dto/contact.dto';
import { calculateSkip } from '../../common/dto/pagination.dto';

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(
    private prisma: PrismaService,
    private notificationService: NotificationService,
    private emailService: EmailService,
  ) {}

  async createContact(dto: CreateContactDto) {
    this.logger.log(`New contact from ${dto.name} (${dto.email})`);

    // DB에 저장
    const contact = await this.prisma.contact.create({
      data: {
        name: dto.name,
        email: dto.email,
        message: dto.message,
      },
    });

    // 관리자에게 알림 생성
    await this.notificationService.createNotification({
      type: 'general_inquiry',
      recipientAgentId: 1,
      title: '새로운 일반 문의',
      message: `${dto.name}님(${dto.email})이 문의를 남겼습니다: ${dto.message.substring(0, 100)}${dto.message.length > 100 ? '...' : ''}`,
      metadata: {
        contactId: contact.id,
        name: dto.name,
        email: dto.email,
      },
    });

    // 이메일 발송 (비동기로 처리, 실패해도 문의 접수는 성공)
    this.sendContactEmails(contact.id, dto).catch((error) => {
      this.logger.error('Failed to send contact emails:', error);
    });

    return contact;
  }

  /**
   * 문의 접수 시 이메일 발송 (관리자 알림 + 고객 확인)
   */
  private async sendContactEmails(contactId: number, dto: CreateContactDto) {
    // 관리자에게 알림 이메일
    await this.emailService.sendNewContactNotification({
      contactId,
      name: dto.name,
      email: dto.email,
      message: dto.message,
    });

    // 고객에게 접수 확인 이메일
    await this.emailService.sendContactConfirmation({
      to: dto.email,
      customerName: dto.name,
      message: dto.message,
    });
  }

  async getContacts(query: ContactQueryDto): Promise<ContactListDto> {
    const { page = 1, limit = 20, status } = query;
    const skip = calculateSkip(page, limit);

    const where = status ? { status } : {};

    const [contacts, total] = await Promise.all([
      this.prisma.contact.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.contact.count({ where }),
    ]);

    return { contacts, total };
  }

  async getContact(id: number) {
    return this.prisma.contact.findUnique({ where: { id } });
  }

  async replyToContact(id: number, reply: string, repliedBy: string) {
    // 먼저 문의 내용 조회
    const contact = await this.prisma.contact.findUnique({
      where: { id },
    });

    if (!contact) {
      throw new NotFoundException(`문의 ID ${id}를 찾을 수 없습니다`);
    }

    // DB 업데이트
    const updatedContact = await this.prisma.contact.update({
      where: { id },
      data: {
        reply,
        repliedBy,
        repliedAt: new Date(),
        status: 'replied',
      },
    });

    // 이메일 발송
    const emailSent = await this.emailService.sendContactReply({
      to: contact.email,
      customerName: contact.name,
      originalMessage: contact.message,
      reply,
    });

    if (!emailSent) {
      this.logger.warn(`Failed to send reply email for contact ${id}`);
    }

    return updatedContact;
  }

  async updateStatus(id: number, status: string) {
    return this.prisma.contact.update({
      where: { id },
      data: { status },
    });
  }

  async deleteContact(id: number) {
    return this.prisma.contact.delete({ where: { id } });
  }
}
