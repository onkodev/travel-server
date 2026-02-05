/**
 * 챗봇 서비스 공통 유틸리티
 */

// ============================================================================
// 인원 계산
// ============================================================================

interface PaxCounts {
  adultsCount?: number | null;
  childrenCount?: number | null;
  infantsCount?: number | null;
  seniorsCount?: number | null;
}

/**
 * 총 인원 계산 (성인 + 아동 + 유아)
 * 시니어는 별도 카운트가 필요한 경우에만 포함
 */
export function calculateTotalPax(counts: PaxCounts, includeSeniors = false): number {
  const adults = counts.adultsCount || 1; // 최소 1명
  const children = counts.childrenCount || 0;
  const infants = counts.infantsCount || 0;
  const seniors = includeSeniors ? (counts.seniorsCount || 0) : 0;
  return adults + children + infants + seniors;
}

/**
 * 인원 정보 문자열 생성
 */
export function formatPaxString(counts: PaxCounts, locale: 'ko' | 'en' = 'ko'): string {
  const adults = counts.adultsCount || 1;
  const children = counts.childrenCount || 0;
  const infants = counts.infantsCount || 0;
  const seniors = counts.seniorsCount || 0;
  const total = adults + children + infants + seniors;

  if (locale === 'ko') {
    return `총 ${total}명 (성인 ${adults}, 아동 ${children}, 유아 ${infants}${seniors > 0 ? `, 시니어 ${seniors}` : ''})`;
  }
  return `Total ${total} (Adults: ${adults}, Children: ${children}, Infants: ${infants}${seniors > 0 ? `, Seniors: ${seniors}` : ''})`;
}

// ============================================================================
// 라벨 상수 및 변환
// ============================================================================

/**
 * 투어 타입 라벨 매핑
 */
export const TOUR_TYPE_LABELS: Record<string, string> = {
  private: 'Private Tour',
  group: 'Group Tour',
  guided: 'Guided Tour',
  self: 'Self-Guided',
};

/**
 * 지역 라벨 매핑
 */
export const REGION_LABELS: Record<string, string> = {
  seoul: 'Seoul',
  busan: 'Busan',
  jeju: 'Jeju Island',
  gyeongju: 'Gyeongju',
  jeonju: 'Jeonju',
  gangwon: 'Gangwon Province',
  incheon: 'Incheon',
};

/**
 * 관심사 라벨 매핑
 */
export const INTEREST_LABELS: Record<string, string> = {
  culture: 'Culture & History',
  nature: 'Nature & Scenery',
  food: 'Food & Culinary',
  shopping: 'Shopping',
  kpop: 'K-Pop & Entertainment',
  temple: 'Temple Stay',
  adventure: 'Adventure',
  relaxation: 'Relaxation & Wellness',
};

/**
 * 예산 라벨 매핑
 */
export const BUDGET_LABELS: Record<string, string> = {
  budget: 'Budget',
  moderate: 'Moderate',
  premium: 'Premium',
  luxury: 'Luxury',
};

/**
 * 상수 키를 라벨로 변환
 */
export function resolveLabel(
  key: string | null | undefined,
  type: 'tourType' | 'region' | 'interest' | 'budget',
): string {
  if (!key) return '';

  const normalizedKey = key.toLowerCase().trim();

  switch (type) {
    case 'tourType':
      return TOUR_TYPE_LABELS[normalizedKey] || key;
    case 'region':
      return REGION_LABELS[normalizedKey] || key;
    case 'interest':
      return INTEREST_LABELS[normalizedKey] || key;
    case 'budget':
      return BUDGET_LABELS[normalizedKey] || key;
    default:
      return key;
  }
}

/**
 * 관심사 배열을 라벨 배열로 변환
 */
export function resolveInterestLabels(interests: string[] | null | undefined): string[] {
  if (!interests || interests.length === 0) return [];
  return interests.map((i) => resolveLabel(i, 'interest'));
}

/**
 * 플로우 데이터에서 라벨 일괄 변환
 */
export interface FlowLabels {
  tourTypeLabel: string;
  regionLabel: string;
  budgetLabel: string;
  interestLabels: string[];
  attractionLabels: string[];
}

export function resolveFlowLabels(flow: {
  tourType?: string | null;
  region?: string | null;
  budgetRange?: string | null;
  interests?: string[] | null;
  attractions?: string[] | null;
}): FlowLabels {
  return {
    tourTypeLabel: resolveLabel(flow.tourType, 'tourType'),
    regionLabel: resolveLabel(flow.region, 'region'),
    budgetLabel: resolveLabel(flow.budgetRange, 'budget'),
    interestLabels: resolveInterestLabels(flow.interests),
    attractionLabels: flow.attractions || [],
  };
}

// ============================================================================
// 아이템 ID 생성
// ============================================================================

/**
 * 견적 아이템 고유 ID 생성
 */
export function generateEstimateItemId(): string {
  return `item-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
