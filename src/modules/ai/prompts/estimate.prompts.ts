/**
 * 견적 분석 관련 프롬프트
 */

export interface EstimateAnalysisParams {
  requestContent: string | null;
  itemsSummary: string;
}

export const ESTIMATE_ANALYSIS_PROMPT = (params: EstimateAnalysisParams): string => `당신은 한국 인바운드 여행 전문가입니다. 고객의 여행 요청 내용과 견적 아이템을 분석해서 여행 정보를 추출해주세요.

## 고객 요청 내용:
${params.requestContent || '내용 없음'}

## 견적 아이템 목록:
${params.itemsSummary}

## 분석 요청:
위 정보를 바탕으로 다음을 추출해주세요:

1. regions: 방문 지역 (예: 서울, 부산, 제주 등)
2. interests: 관심 테마/카테고리 (맛집, 역사, 자연, 쇼핑, K-pop, 문화체험 등)
3. keywords: 구체적인 키워드 (음식명, 장소명, 활동명 등)
4. groupType: 그룹 유형 (solo, couple, family, friends, group 중 하나, 알 수 없으면 null)
5. budgetLevel: 예산 수준 (budget, mid, premium, luxury 중 하나, 알 수 없으면 null)
6. specialNeeds: 특별 요구사항 (wheelchair, vegetarian, halal, infant, pickup 등)

다음 JSON 형식으로만 응답해주세요 (다른 텍스트 없이):
{
  "regions": ["서울", "부산"],
  "interests": ["맛집", "역사"],
  "keywords": ["비빔밥", "경복궁", "한복체험"],
  "groupType": "family",
  "budgetLevel": "mid",
  "specialNeeds": []
}`;

export const ESTIMATE_ANALYSIS_CONFIG = {
  temperature: 0.3,
  maxOutputTokens: 1024,
};
