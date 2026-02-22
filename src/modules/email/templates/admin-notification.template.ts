import { escapeHtml } from '../../../common/utils/html.util';

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
