import { escapeHtml } from '../../../common/utils/html.util';

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
