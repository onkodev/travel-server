import { escapeHtml } from '../../../common/utils/html.util';

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
