/**
 * 노이즈 이메일 패턴 + 견적 임베딩 텍스트 빌더
 */

// 시스템 알림, 예약확인, 자동발송 등 RAG에 불필요한 이메일 subject 패턴
export const NOISE_SUBJECT_PATTERNS: RegExp[] = [
  /^(re:\s*)*delivery status notification/i,
  /^(re:\s*)*auto[- ]?reply/i,
  /^(re:\s*)*automatic reply/i,
  /^(re:\s*)*out of office/i,
  /^(re:\s*)*undeliverable/i,
  /^(re:\s*)*mail delivery (failed|subsystem)/i,
  /^(re:\s*)*returned mail/i,
  /^(re:\s*)*failure notice/i,
  /booking confirmation/i,
  /reservation confirmed/i,
  /payment (receipt|confirmation|received)/i,
  /order confirmation/i,
  /your (receipt|invoice|order)/i,
  /newsletter/i,
  /subscription/i,
  /verify your (email|account)/i,
  /password reset/i,
  /security alert/i,
  /login notification/i,
  /two[- ]?factor/i,
  /verification code/i,
  /no[- ]?reply/i,
  /do[- ]?not[- ]?reply/i,
];

// 시스템/자동 발송 이메일 sender 패턴
export const NOISE_SENDER_PATTERNS: RegExp[] = [
  /noreply@/i,
  /no-reply@/i,
  /donotreply@/i,
  /do-not-reply@/i,
  /mailer-daemon@/i,
  /postmaster@/i,
  /notifications?@/i,
  /alerts?@/i,
  /system@/i,
  /automated@/i,
  /@googlemail\.com$/i,
  /@accounts\.google\.com$/i,
  /support@(paypal|stripe|square)\./i,
  /@(booking|agoda|expedia|airbnb|hotels)\./i,
  /@(mailchimp|sendgrid|mailgun|amazonaws)\./i,
];

/**
 * 이메일이 노이즈인지 판별
 */
export function isNoiseEmail(
  subject: string | null,
  fromEmail: string | null,
): boolean {
  if (subject) {
    for (const pattern of NOISE_SUBJECT_PATTERNS) {
      if (pattern.test(subject)) return true;
    }
  }
  if (fromEmail) {
    for (const pattern of NOISE_SENDER_PATTERNS) {
      if (pattern.test(fromEmail)) return true;
    }
  }
  return false;
}

/**
 * 견적 데이터를 임베딩용 텍스트로 변환
 * 검색 시 고객 요청과 매칭되도록 주요 정보를 구조화
 */
export function buildEstimateEmbeddingText(estimate: {
  title: string;
  regions: string[];
  interests: string[];
  travelDays: number;
  tourType: string | null;
  adultsCount: number | null;
  childrenCount: number | null;
  priceRange: string | null;
  requestContent: string | null;
  items: unknown;
}): string {
  const parts: string[] = [];

  // 기본 정보
  parts.push(`Trip: ${estimate.title}`);
  if (estimate.regions.length > 0) {
    parts.push(`Region: ${estimate.regions.join(', ')}`);
  }
  parts.push(`Duration: ${estimate.travelDays} days`);

  if (estimate.tourType) {
    parts.push(`Tour type: ${estimate.tourType}`);
  }

  // 인원
  const pax: string[] = [];
  if (estimate.adultsCount) pax.push(`${estimate.adultsCount} adults`);
  if (estimate.childrenCount) pax.push(`${estimate.childrenCount} children`);
  if (pax.length > 0) parts.push(`Group: ${pax.join(', ')}`);

  // 관심사
  if (estimate.interests.length > 0) {
    parts.push(`Interests: ${estimate.interests.join(', ')}`);
  }

  if (estimate.priceRange) {
    parts.push(`Budget: ${estimate.priceRange}`);
  }

  // 고객 요청사항
  if (estimate.requestContent) {
    parts.push(`Request: ${estimate.requestContent.slice(0, 500)}`);
  }

  // 일정 아이템 (장소명 추출)
  if (estimate.items && Array.isArray(estimate.items)) {
    const placeNames = (estimate.items as Array<Record<string, unknown>>)
      .filter((item) => !item.isTbd && item.itemInfo)
      .map((item) => {
        const info = item.itemInfo as Record<string, unknown>;
        return info.nameEng || info.nameKor || item.itemName || '';
      })
      .filter(Boolean);

    if (placeNames.length > 0) {
      parts.push(`Places: ${placeNames.join(', ')}`);
    }
  }

  return parts.join('\n').slice(0, 8000);
}
