import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private sesClient: SESClient;
  private fromEmail: string;
  private replyToEmail: string;

  constructor(private configService: ConfigService) {
    this.sesClient = new SESClient({
      region: this.configService.get<string>('AWS_SES_REGION') || 'ap-northeast-2',
      credentials: {
        accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY') || '',
        secretAccessKey: this.configService.get<string>('AWS_SECRET_KEY') || '',
      },
    });
    this.fromEmail =
      this.configService.get<string>('AWS_SES_FROM_EMAIL') || 'noreply@tumakr.com';
    this.replyToEmail =
      this.configService.get<string>('AWS_SES_REPLY_TO_EMAIL') || 'info@onedaykorea.com';
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
              Data: this.getReplyEmailTemplate({
                customerName,
                originalMessage,
                reply,
              }),
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
    const adminEmail = this.configService.get<string>('ADMIN_EMAIL') || 'admin@tumakr.com';

    try {
      const { contactId, name, email, message } = params;

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
              Data: this.getAdminNotificationTemplate({ contactId, name, email, message }),
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
              Data: this.getConfirmationEmailTemplate({ customerName, message }),
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
      const clientUrl = this.configService.get<string>('CLIENT_URL') || 'http://localhost:3000';
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
              Data: this.getEstimateEmailTemplate({ ...params, estimateUrl }),
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

  // ==================== Email Templates ====================

  private getAdminNotificationTemplate(params: {
    contactId: number;
    name: string;
    email: string;
    message: string;
  }): string {
    const { contactId, name, email, message } = params;
    const adminUrl = this.configService.get<string>('CLIENT_URL') || 'http://localhost:3000';

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #f97316 0%, #ea580c 100%); padding: 24px 40px;">
              <h1 style="margin: 0; color: #ffffff; font-size: 20px; font-weight: 600;">📬 새로운 문의가 접수되었습니다</h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 32px 40px;">
              <!-- Contact Info -->
              <table width="100%" style="margin-bottom: 24px; border-collapse: collapse;">
                <tr>
                  <td style="padding: 12px 16px; background-color: #f9fafb; border-radius: 8px;">
                    <p style="margin: 0 0 8px; color: #6b7280; font-size: 12px; text-transform: uppercase;">문의자 정보</p>
                    <p style="margin: 0; color: #111827; font-size: 16px; font-weight: 600;">${name}</p>
                    <p style="margin: 4px 0 0; color: #0ea5e9; font-size: 14px;">
                      <a href="mailto:${email}" style="color: #0ea5e9; text-decoration: none;">${email}</a>
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Message -->
              <div style="margin-bottom: 24px;">
                <p style="margin: 0 0 8px; color: #6b7280; font-size: 12px; text-transform: uppercase;">문의 내용</p>
                <div style="background-color: #f9fafb; border-left: 4px solid #f97316; padding: 16px; border-radius: 0 8px 8px 0;">
                  <p style="margin: 0; color: #374151; font-size: 15px; line-height: 1.7; white-space: pre-wrap;">${message}</p>
                </div>
              </div>

              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${adminUrl}/admin/contact" style="display: inline-block; background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 15px; font-weight: 600;">
                      관리자 페이지에서 답변하기
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f9fafb; padding: 16px 40px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; color: #9ca3af; font-size: 12px;">
                문의 ID: #${contactId} | ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim();
  }

  private getConfirmationEmailTemplate(params: {
    customerName: string;
    message: string;
  }): string {
    const { customerName, message } = params;

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%); padding: 30px 40px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600;">Tumakr</h1>
              <p style="margin: 8px 0 0; color: rgba(255,255,255,0.9); font-size: 14px;">Your Korea Travel Partner</p>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              <div style="text-align: center; margin-bottom: 32px;">
                <div style="display: inline-block; background-color: #dcfce7; border-radius: 50%; padding: 16px; margin-bottom: 16px;">
                  <span style="font-size: 32px;">✓</span>
                </div>
                <h2 style="margin: 0; color: #111827; font-size: 20px; font-weight: 600;">Thank you for contacting us!</h2>
              </div>

              <p style="margin: 0 0 20px; color: #374151; font-size: 16px; line-height: 1.6;">
                Dear ${customerName},
              </p>

              <p style="margin: 0 0 24px; color: #374151; font-size: 16px; line-height: 1.6;">
                We have received your inquiry and our team will get back to you within <strong>24-48 hours</strong>.
              </p>

              <!-- Message Summary -->
              <div style="margin-bottom: 24px;">
                <p style="margin: 0 0 8px; color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Your Message:</p>
                <div style="background-color: #f9fafb; padding: 16px; border-radius: 8px; border: 1px solid #e5e7eb;">
                  <p style="margin: 0; color: #6b7280; font-size: 14px; line-height: 1.6; font-style: italic;">${message.length > 200 ? message.substring(0, 200) + '...' : message}</p>
                </div>
              </div>

              <p style="margin: 0; color: #374151; font-size: 16px; line-height: 1.6;">
                In the meantime, feel free to explore our tours and travel guides on our website.
              </p>

              <p style="margin: 24px 0 0; color: #374151; font-size: 16px; line-height: 1.6;">
                Best regards,<br>
                <strong>The Tumakr Team</strong>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f9fafb; padding: 24px 40px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; color: #9ca3af; font-size: 12px;">
                © ${new Date().getFullYear()} Tumakr. All rights reserved.
              </p>
              <p style="margin: 8px 0 0; color: #9ca3af; font-size: 12px;">
                <a href="https://tumakr.com" style="color: #0ea5e9; text-decoration: none;">tumakr.com</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim();
  }

  private getReplyEmailTemplate(params: {
    customerName: string;
    originalMessage: string;
    reply: string;
  }): string {
    const { customerName, originalMessage, reply } = params;

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reply from Tumakr</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%); padding: 30px 40px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600;">Tumakr</h1>
              <p style="margin: 8px 0 0; color: rgba(255,255,255,0.9); font-size: 14px;">Your Korea Travel Partner</p>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 20px; color: #374151; font-size: 16px; line-height: 1.6;">
                Dear ${customerName},
              </p>

              <p style="margin: 0 0 30px; color: #374151; font-size: 16px; line-height: 1.6;">
                Thank you for contacting us. Here is our response to your inquiry:
              </p>

              <!-- Reply Box -->
              <div style="background-color: #f0f9ff; border-left: 4px solid #0ea5e9; padding: 20px; border-radius: 0 8px 8px 0; margin-bottom: 30px;">
                <p style="margin: 0; color: #0369a1; font-size: 15px; line-height: 1.7; white-space: pre-wrap;">${reply}</p>
              </div>

              <!-- Original Message -->
              <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
                <p style="margin: 0 0 10px; color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Your Original Message:</p>
                <p style="margin: 0; color: #9ca3af; font-size: 14px; line-height: 1.6; font-style: italic;">${originalMessage}</p>
              </div>

              <p style="margin: 30px 0 0; color: #374151; font-size: 16px; line-height: 1.6;">
                If you have any further questions, please don't hesitate to reach out.
              </p>

              <p style="margin: 20px 0 0; color: #374151; font-size: 16px; line-height: 1.6;">
                Best regards,<br>
                <strong>The Tumakr Team</strong>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f9fafb; padding: 24px 40px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; color: #9ca3af; font-size: 12px;">
                © ${new Date().getFullYear()} Tumakr. All rights reserved.
              </p>
              <p style="margin: 8px 0 0; color: #9ca3af; font-size: 12px;">
                <a href="https://tumakr.com" style="color: #0ea5e9; text-decoration: none;">tumakr.com</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim();
  }

  private getEstimateEmailTemplate(params: {
    customerName: string;
    estimateTitle: string;
    estimateUrl: string;
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
  }): string {
    const {
      customerName,
      estimateTitle,
      estimateUrl,
      totalAmount,
      currency,
      travelDays,
      startDate,
      endDate,
      adultsCount,
      childrenCount,
    } = params;

    // 날짜 포맷팅
    const formatDate = (date: Date | string | null | undefined): string => {
      if (!date) return '-';
      const d = new Date(date);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    // 금액 포맷팅
    const formatCurrency = (amount: number, curr: string): string => {
      if (!amount || amount === 0) return 'TBD';
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: curr || 'USD',
        minimumFractionDigits: 0,
      }).format(amount);
    };

    // 여행 정보
    const travelers = (adultsCount || 0) + (childrenCount || 0);

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f8fafc;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; padding: 48px 20px;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);">

          <!-- Header -->
          <tr>
            <td style="padding: 32px 40px 24px; text-align: center; border-bottom: 1px solid #f1f5f9;">
              <h1 style="margin: 0; color: #0ea5e9; font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">Tumakr</h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 32px 40px;">
              <p style="margin: 0 0 24px; color: #334155; font-size: 16px; line-height: 1.7;">
                Hi ${customerName},
              </p>

              <p style="margin: 0 0 32px; color: #334155; font-size: 16px; line-height: 1.7;">
                Your travel quotation is ready! Click below to view the full details.
              </p>

              <!-- Summary Card -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; border-radius: 12px; margin-bottom: 32px;">
                <tr>
                  <td style="padding: 24px;">
                    <p style="margin: 0 0 4px; color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Your Trip</p>
                    <h2 style="margin: 0 0 20px; color: #0f172a; font-size: 20px; font-weight: 600;">${estimateTitle}</h2>

                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #e2e8f0;">
                          <span style="color: #64748b; font-size: 14px;">Dates</span>
                        </td>
                        <td style="padding: 8px 0; border-bottom: 1px solid #e2e8f0; text-align: right;">
                          <span style="color: #0f172a; font-size: 14px; font-weight: 500;">${formatDate(startDate)} - ${formatDate(endDate)}</span>
                        </td>
                      </tr>
                      ${travelDays ? `
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #e2e8f0;">
                          <span style="color: #64748b; font-size: 14px;">Duration</span>
                        </td>
                        <td style="padding: 8px 0; border-bottom: 1px solid #e2e8f0; text-align: right;">
                          <span style="color: #0f172a; font-size: 14px; font-weight: 500;">${travelDays} days</span>
                        </td>
                      </tr>
                      ` : ''}
                      ${travelers > 0 ? `
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #e2e8f0;">
                          <span style="color: #64748b; font-size: 14px;">Travelers</span>
                        </td>
                        <td style="padding: 8px 0; border-bottom: 1px solid #e2e8f0; text-align: right;">
                          <span style="color: #0f172a; font-size: 14px; font-weight: 500;">${travelers} ${travelers > 1 ? 'people' : 'person'}</span>
                        </td>
                      </tr>
                      ` : ''}
                      <tr>
                        <td style="padding: 12px 0 0;">
                          <span style="color: #64748b; font-size: 14px;">Total</span>
                        </td>
                        <td style="padding: 12px 0 0; text-align: right;">
                          <span style="color: #0ea5e9; font-size: 24px; font-weight: 700;">${formatCurrency(totalAmount, currency)}</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${estimateUrl}" style="display: inline-block; background-color: #0ea5e9; color: #ffffff; text-decoration: none; padding: 16px 48px; border-radius: 8px; font-size: 16px; font-weight: 600;">
                      View Quotation
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 24px 0 0; color: #94a3b8; font-size: 13px; text-align: center;">
                <a href="${estimateUrl}" style="color: #94a3b8; text-decoration: underline;">${estimateUrl}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px; text-align: center; border-top: 1px solid #f1f5f9;">
              <p style="margin: 0 0 8px; color: #94a3b8; font-size: 13px;">
                Questions? Contact us at <a href="mailto:info@onedaykorea.com" style="color: #0ea5e9; text-decoration: none;">info@onedaykorea.com</a>
              </p>
              <p style="margin: 0; color: #cbd5e1; font-size: 12px;">
                © ${new Date().getFullYear()} Tumakr
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim();
  }
}
