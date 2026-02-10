/**
 * 이메일 HTML 템플릿 모음
 * email.service.ts에서 분리하여 유지보수성 향상
 */

import { escapeHtml } from '../../common/utils/html.util';

// ============================================================================
// 관리자 알림 (새 문의 접수)
// ============================================================================

export function adminNotificationTemplate(params: {
  contactId: number;
  name: string;
  email: string;
  message: string;
  adminUrl: string;
}): string {
  const contactId = params.contactId;
  const name = escapeHtml(params.name);
  const email = escapeHtml(params.email);
  const message = escapeHtml(params.message);
  const adminUrl = params.adminUrl;

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

// ============================================================================
// 고객 문의 접수 확인
// ============================================================================

export function confirmationTemplate(params: {
  customerName: string;
  message: string;
}): string {
  const customerName = escapeHtml(params.customerName);
  const message = escapeHtml(params.message);

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

// ============================================================================
// 문의 답변
// ============================================================================

export function replyTemplate(params: {
  customerName: string;
  originalMessage: string;
  reply: string;
}): string {
  const customerName = escapeHtml(params.customerName);
  const originalMessage = escapeHtml(params.originalMessage);
  const reply = escapeHtml(params.reply);

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

// ============================================================================
// 견적서 발송
// ============================================================================

export function estimateTemplate(params: {
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
  const customerName = escapeHtml(params.customerName);
  const estimateTitle = escapeHtml(params.estimateTitle);
  const {
    estimateUrl,
    totalAmount,
    currency,
    travelDays,
    startDate,
    endDate,
    adultsCount,
    childrenCount,
  } = params;

  const formatDate = (date: Date | string | null | undefined): string => {
    if (!date) return '-';
    const d = new Date(date);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatCurrency = (amount: number, curr: string): string => {
    if (!amount || amount === 0) return 'TBD';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: curr || 'USD',
      minimumFractionDigits: 0,
    }).format(amount);
  };

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

              <p style="margin: 0 0 20px; color: #334155; font-size: 16px; line-height: 1.7;">
                Your travel quotation is ready! Click below to view the full details.
              </p>

              <p style="margin: 0 0 32px; color: #64748b; font-size: 14px; line-height: 1.7;">
                Have questions or need changes? You can reply to this email directly or return to our chat to continue the conversation.
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
                      ${
                        travelDays
                          ? `
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #e2e8f0;">
                          <span style="color: #64748b; font-size: 14px;">Duration</span>
                        </td>
                        <td style="padding: 8px 0; border-bottom: 1px solid #e2e8f0; text-align: right;">
                          <span style="color: #0f172a; font-size: 14px; font-weight: 500;">${travelDays} days</span>
                        </td>
                      </tr>
                      `
                          : ''
                      }
                      ${
                        travelers > 0
                          ? `
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #e2e8f0;">
                          <span style="color: #64748b; font-size: 14px;">Travelers</span>
                        </td>
                        <td style="padding: 8px 0; border-bottom: 1px solid #e2e8f0; text-align: right;">
                          <span style="color: #0f172a; font-size: 14px; font-weight: 500;">${travelers} ${travelers > 1 ? 'people' : 'person'}</span>
                        </td>
                      </tr>
                      `
                          : ''
                      }
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

// ============================================================================
// 챗봇 상담 접수 관리자 알림
// ============================================================================

// ============================================================================
// 수정 요청 알림 (관리자)
// ============================================================================

export function modificationRequestTemplate(params: {
  customerName: string;
  customerEmail: string;
  estimateId: number;
  requestContent: string;
  sessionId: string;
  adminUrl: string;
}): string {
  const customerName = escapeHtml(params.customerName);
  const customerEmail = escapeHtml(params.customerEmail);
  const requestContent = escapeHtml(params.requestContent);
  const { estimateId, sessionId, adminUrl } = params;

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
            <td style="background: linear-gradient(135deg, #eab308 0%, #ca8a04 100%); padding: 24px 40px;">
              <h1 style="margin: 0; color: #ffffff; font-size: 20px; font-weight: 600;">✏️ 견적 수정 요청</h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 32px 40px;">
              <!-- Customer Info -->
              <table width="100%" style="margin-bottom: 24px; border-collapse: collapse;">
                <tr>
                  <td style="padding: 12px 16px; background-color: #fefce8; border-radius: 8px;">
                    <p style="margin: 0 0 8px; color: #6b7280; font-size: 12px; text-transform: uppercase;">고객 정보</p>
                    <p style="margin: 0; color: #111827; font-size: 16px; font-weight: 600;">${customerName}</p>
                    <p style="margin: 4px 0 0; color: #0ea5e9; font-size: 14px;">
                      <a href="mailto:${customerEmail}" style="color: #0ea5e9; text-decoration: none;">${customerEmail}</a>
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Estimate Info -->
              <div style="margin-bottom: 16px;">
                <p style="margin: 0 0 8px; color: #6b7280; font-size: 12px; text-transform: uppercase;">견적 번호</p>
                <p style="margin: 0; color: #111827; font-size: 16px; font-weight: 600;">#${estimateId}</p>
              </div>

              <!-- Request Content -->
              <div style="margin-bottom: 24px;">
                <p style="margin: 0 0 8px; color: #6b7280; font-size: 12px; text-transform: uppercase;">수정 요청 내용</p>
                <div style="background-color: #fefce8; border-left: 4px solid #eab308; padding: 16px; border-radius: 0 8px 8px 0;">
                  <p style="margin: 0; color: #374151; font-size: 15px; line-height: 1.7; white-space: pre-wrap;">${requestContent}</p>
                </div>
              </div>

              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${adminUrl}/admin/chatbot/${sessionId}" style="display: inline-block; background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 15px; font-weight: 600;">
                      관리자 페이지에서 확인
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
                견적 #${estimateId} | ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
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

export function chatbotInquiryAdminTemplate(params: {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  nationality: string;
  ipAddress: string;
  countryName: string;
  country: string;
  tourType: string;
  needsPickup: boolean;
  isFirstVisit: boolean;
  travelDate: string;
  duration: number;
  budgetRange: string;
  adultsCount: number;
  childrenCount: number;
  infantsCount: number;
  seniorsCount: number;
  ageRange: string;
  interestLabels: string[];
  attractionLabels: string[];
  region: string;
  regionLabel: string;
  tourTypeLabel: string;
  budgetLabel: string;
  additionalNotes: string;
  needsGuide: boolean;
  hasPlan: boolean | null;
  planDetails: string;
  visitedProducts: string[];
  sessionId: string;
  adminUrl: string;
}): string {
  const p = {
    ...params,
    customerName: escapeHtml(params.customerName),
    customerEmail: escapeHtml(params.customerEmail),
    customerPhone: escapeHtml(params.customerPhone),
    nationality: escapeHtml(params.nationality),
    additionalNotes: escapeHtml(params.additionalNotes),
    planDetails: escapeHtml(params.planDetails),
  };

  // 인원 요약
  const groupParts: string[] = [];
  if (p.adultsCount) groupParts.push(`${p.adultsCount} Adult(s)`);
  if (p.childrenCount) groupParts.push(`${p.childrenCount} Child(ren)`);
  if (p.infantsCount) groupParts.push(`${p.infantsCount} Infant(s)`);
  if (p.seniorsCount) groupParts.push(`${p.seniorsCount} Senior(s)`);
  const groupSummary = groupParts.length > 0 ? groupParts.join(', ') : '-';

  const travelDateStr = p.travelDate || '-';
  const durationStr = p.duration ? `${p.duration}D${p.duration - 1}N` : '-';
  const ipInfo = p.ipAddress
    ? `${p.ipAddress}${p.countryName ? ` (${p.countryName} / ${p.country})` : ''}`
    : '-';

  const visitedStr =
    (p.visitedProducts || []).length > 0 ? p.visitedProducts.join(', ') : '';

  const l = (label: string, value: string) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#888;white-space:nowrap;vertical-align:top;">${label}</td><td style="padding:4px 0;color:#222;">${value}</td></tr>`;

  const section = (title: string) =>
    `<tr><td colspan="2" style="padding:16px 0 6px;font-size:12px;font-weight:600;color:#f97316;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #eee;">${title}</td></tr>`;

  const rows: string[] = [];

  // Customer Info
  rows.push(section('Customer Info'));
  rows.push(l('Name', p.customerName));
  rows.push(
    l(
      'E-Mail',
      `<a href="mailto:${p.customerEmail}" style="color:#0ea5e9;text-decoration:none;">${p.customerEmail}</a>`,
    ),
  );
  if (p.customerPhone && p.customerPhone !== '-')
    rows.push(l('Phone', p.customerPhone));
  rows.push(l('Nationality', p.nationality || '-'));
  rows.push(l('IP', ipInfo));

  // Tour Details
  rows.push(section('Tour Details'));
  rows.push(l('Looking for', p.tourTypeLabel));
  rows.push(
    l(
      'First Time in Korea',
      p.isFirstVisit ? 'Yes' : p.isFirstVisit === false ? 'No' : '-',
    ),
  );
  rows.push(l('Tour Date', travelDateStr));
  rows.push(l('Duration', durationStr));
  rows.push(l('Price Range', p.budgetLabel));

  // Group
  rows.push(section('Group'));
  rows.push(l('Travelers', groupSummary));

  // Services
  rows.push(section('Services'));
  rows.push(l('Airport Transfer', p.needsPickup ? 'Yes' : 'No'));
  if (p.needsGuide !== null && p.needsGuide !== undefined) {
    rows.push(l('Guide', p.needsGuide ? 'Yes' : 'No'));
  }

  // Interests & Locations
  if (
    p.interestLabels.length > 0 ||
    p.attractionLabels.length > 0 ||
    p.region
  ) {
    rows.push(section('Interests & Locations'));
    if (p.interestLabels.length > 0)
      rows.push(l('Interested in', p.interestLabels.join(', ')));
    if (p.region) rows.push(l('Region', p.regionLabel));
  }

  // Plan
  if (p.hasPlan !== null && p.hasPlan !== undefined) {
    rows.push(section('Plan'));
    rows.push(l('Has Plan', p.hasPlan ? 'Yes' : 'No'));
    if (p.planDetails) rows.push(l('Details', p.planDetails));
  }

  // Additional Notes
  if (p.additionalNotes) {
    rows.push(section('Additional Notes'));
    rows.push(
      `<tr><td colspan="2" style="padding:6px 0;color:#222;">${p.additionalNotes}</td></tr>`,
    );
  }

  // Visited Products
  if (visitedStr) {
    rows.push(section('Visited Products'));
    rows.push(
      `<tr><td colspan="2" style="padding:6px 0;color:#222;">${visitedStr}</td></tr>`,
    );
  }

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
        <tr><td style="background:#f97316;padding:16px 24px;">
          <span style="color:#fff;font-size:16px;font-weight:600;">New Chat Inquiry</span>
          <span style="color:rgba(255,255,255,0.8);font-size:13px;float:right;">${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</span>
        </td></tr>
        <tr><td style="padding:8px 24px 24px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.6;">
            ${rows.join('\n            ')}
          </table>
        </td></tr>
        <tr><td style="padding:0 24px 24px;" align="center">
          <a href="${p.adminUrl}/admin/chatbot/${p.sessionId}" style="display:inline-block;background:#0ea5e9;color:#fff;text-decoration:none;padding:10px 28px;border-radius:6px;font-size:14px;font-weight:600;">관리자 페이지에서 확인</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();
}
