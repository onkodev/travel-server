import { escapeHtml } from '../../../common/utils/html.util';

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
