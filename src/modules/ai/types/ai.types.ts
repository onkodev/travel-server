/**
 * AI 서비스 공통 타입 정의
 */

/**
 * 선택 가능한 아이템 (AI 선택용)
 */
export interface AvailableItem {
  id: number;
  nameEng: string;
  keyword?: string | null;
  categories?: string[];
  descriptionEng?: string | null;
}

/**
 * 타임라인 아이템
 */
export interface TimelineItem {
  name: string;
  type: string;
  order: number;
}

/**
 * 견적 분석용 아이템
 */
export interface EstimateItemForAnalysis {
  id: string;
  name: string;
  type: string;
  region?: string;
}
