import { escapeHtml } from '../../../common/utils/html.util';

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
