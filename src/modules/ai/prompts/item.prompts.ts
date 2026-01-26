/**
 * 아이템 관련 프롬프트
 */

export const ITEM_TYPE_LABELS: Record<string, string> = {
  place: '여행지/관광명소',
  accommodation: '숙소/호텔',
  transportation: '교통수단',
  contents: '체험/액티비티',
};

export interface ItemContentParams {
  nameKor: string;
  nameEng: string;
  typeLabel: string;
}

export const ITEM_CONTENT_PROMPT = (params: ItemContentParams): string =>
  `당신은 한국 여행 전문가입니다. 아래 ${params.typeLabel}에 대해 키워드와 설명(한글/영문)을 생성해주세요.

장소명 (한글): ${params.nameKor}
장소명 (영문): ${params.nameEng || '없음'}
타입: ${params.typeLabel}

다음 JSON 형식으로만 응답해주세요 (다른 텍스트 없이):
{
  "keyword": "쉼표로 구분된 관련 키워드 5-8개 (예: 서울, 고궁, 역사, 전통문화, 포토스팟)",
  "description": "외국인 관광객을 위한 한글 설명 500자 이내. 장소의 설명, 특징, 볼거리, 추천 이유를 포함.",
  "descriptionEng": "English description for foreign tourists within 500 characters. Include description, features, attractions, and reasons to visit."
}`;

export const ITEM_CONTENT_CONFIG = {
  temperature: 0.7,
  maxOutputTokens: 2048,
};
