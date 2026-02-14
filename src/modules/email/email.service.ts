import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import {
  adminNotificationTemplate,
  confirmationTemplate,
  replyTemplate,
  estimateTemplate,
} from './email-templates';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private sesClient: SESClient;
  private fromEmail: string;
  private replyToEmail: string;

  constructor(private configService: ConfigService) {
    const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY');
    const secretAccessKey = this.configService.get<string>('AWS_SECRET_KEY');
    if (!accessKeyId || !secretAccessKey) {
      this.logger.warn('AWS credentials not configured — email sending will fail.');
    }
    this.sesClient = new SESClient({
      region:
        this.configService.get<string>('AWS_SES_REGION') || 'ap-northeast-2',
      credentials: {
        accessKeyId: accessKeyId || '',
        secretAccessKey: secretAccessKey || '',
      },
    });
    this.fromEmail =
      this.configService.get<string>('AWS_SES_FROM_EMAIL') ||
      'noreply@tumakr.com';
    this.replyToEmail =
      this.configService.get<string>('AWS_SES_REPLY_TO_EMAIL') ||
      'info@onedaykorea.com';
  }

  async sendContactReply(params: {
    to: string;
    customerName: string;
    originalMessage: string;
    reply: string;
  }): Promise<boolean> {
    try {
      const { to, customerName, originalMessage, reply } = params;

      const command = new SendEmailCommand({
        Source: `Tumakr <${this.fromEmail}>`,
        Destination: {
          ToAddresses: [to],
        },
        ReplyToAddresses: [this.replyToEmail],
        Message: {
          Subject: {
            Charset: 'UTF-8',
            Data: 'Re: Your inquiry to Tumakr',
          },
          Body: {
            Html: {
              Charset: 'UTF-8',
              Data: replyTemplate({ customerName, originalMessage, reply }),
            },
          },
        },
      });

      await this.sesClient.send(command);
      this.logger.log(`Email sent successfully to ${to}`);
      return true;
    } catch (error) {
      this.logger.error('Email sending failed:', error);
      return false;
    }
  }

  /**
   * 일반 이메일 발송
   */
  async sendEmail(params: {
    to: string | string[];
    subject: string;
    html: string;
    text?: string;
  }): Promise<boolean> {
    try {
      const { to, subject, html, text } = params;
      const toAddresses = Array.isArray(to) ? to : [to];

      const command = new SendEmailCommand({
        Source: `Tumakr <${this.fromEmail}>`,
        Destination: {
          ToAddresses: toAddresses,
        },
        ReplyToAddresses: [this.replyToEmail],
        Message: {
          Subject: {
            Charset: 'UTF-8',
            Data: subject,
          },
          Body: {
            Html: {
              Charset: 'UTF-8',
              Data: html,
            },
            ...(text && {
              Text: {
                Charset: 'UTF-8',
                Data: text,
              },
            }),
          },
        },
      });

      await this.sesClient.send(command);
      this.logger.log(`Email sent successfully to ${toAddresses.join(', ')}`);
      return true;
    } catch (error) {
      this.logger.error('Email sending failed:', error);
      return false;
    }
  }

  /**
   * 새 문의 접수 시 관리자에게 알림 이메일 발송
   */
  async sendNewContactNotification(params: {
    contactId: number;
    name: string;
    email: string;
    message: string;
  }): Promise<boolean> {
    const adminEmail =
      this.configService.get<string>('ADMIN_EMAIL') || 'admin@tumakr.com';

    try {
      const { contactId, name, email, message } = params;
      const adminUrl =
        this.configService.get<string>('CLIENT_URL') || 'http://localhost:3000';

      const command = new SendEmailCommand({
        Source: `Tumakr System <${this.fromEmail}>`,
        Destination: {
          ToAddresses: [adminEmail],
        },
        ReplyToAddresses: [this.replyToEmail],
        Message: {
          Subject: {
            Charset: 'UTF-8',
            Data: `[새 문의] ${name}님의 문의가 접수되었습니다`,
          },
          Body: {
            Html: {
              Charset: 'UTF-8',
              Data: adminNotificationTemplate({
                contactId,
                name,
                email,
                message,
                adminUrl,
              }),
            },
          },
        },
      });

      await this.sesClient.send(command);
      this.logger.log(`Admin notification sent for contact #${contactId}`);
      return true;
    } catch (error) {
      this.logger.error('Admin notification email failed:', error);
      return false;
    }
  }

  /**
   * 문의 접수 확인 이메일 (고객에게)
   */
  async sendContactConfirmation(params: {
    to: string;
    customerName: string;
    message: string;
  }): Promise<boolean> {
    try {
      const { to, customerName, message } = params;

      const command = new SendEmailCommand({
        Source: `Tumakr <${this.fromEmail}>`,
        Destination: {
          ToAddresses: [to],
        },
        ReplyToAddresses: [this.replyToEmail],
        Message: {
          Subject: {
            Charset: 'UTF-8',
            Data: 'We received your inquiry - Tumakr',
          },
          Body: {
            Html: {
              Charset: 'UTF-8',
              Data: confirmationTemplate({ customerName, message }),
            },
          },
        },
      });

      await this.sesClient.send(command);
      this.logger.log(`Confirmation email sent to ${to}`);
      return true;
    } catch (error) {
      this.logger.error('Confirmation email failed:', error);
      return false;
    }
  }

  /**
   * 견적서 이메일 발송 (고객에게)
   */
  async sendEstimate(params: {
    to: string;
    customerName: string;
    estimateTitle: string;
    shareHash: string;
    items: Array<{
      name: string;
      type?: string;
      price: number;
      quantity: number;
      date?: string;
    }>;
    totalAmount: number;
    currency: string;
    travelDays?: number;
    startDate?: Date | string | null;
    endDate?: Date | string | null;
    adultsCount?: number;
    childrenCount?: number;
  }): Promise<boolean> {
    try {
      const { to, customerName, estimateTitle, shareHash } = params;
      const clientUrl =
        this.configService.get<string>('CLIENT_URL') || 'http://localhost:3000';
      const estimateUrl = `${clientUrl}/quotation/${shareHash}`;

      const command = new SendEmailCommand({
        Source: `Tumakr <${this.fromEmail}>`,
        Destination: {
          ToAddresses: [to],
        },
        ReplyToAddresses: [this.replyToEmail],
        Message: {
          Subject: {
            Charset: 'UTF-8',
            Data: `Your Travel Quotation is Ready - ${estimateTitle}`,
          },
          Body: {
            Html: {
              Charset: 'UTF-8',
              Data: estimateTemplate({ ...params, estimateUrl }),
            },
          },
        },
      });

      await this.sesClient.send(command);
      this.logger.log(`Estimate email sent successfully to ${to}`);
      return true;
    } catch (error) {
      this.logger.error('Estimate email sending failed:', error);
      return false;
    }
  }
}
