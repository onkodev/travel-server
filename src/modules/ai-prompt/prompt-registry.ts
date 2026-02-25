/**
 * AI 프롬프트 레지스트리 — 18개 프롬프트 키 + 기본값 정의
 */

export enum PromptKey {
  // estimate
  ESTIMATE_ANALYSIS = 'estimate_analysis',
  // email-rag
  EMAIL_RAG_DRAFT = 'email_rag_draft',
  PLACE_EXTRACTION = 'place_extraction',
  // faq-ai
  FAQ_EXTRACTION = 'faq_extraction',
  // item
  ITEM_CONTENT = 'item_content',
  // conversation
  TRAVEL_ASSISTANT = 'travel_assistant',
  RANK_RECOMMENDATIONS = 'rank_recommendations',
  // itinerary
  MODIFICATION_INTENT = 'modification_intent',
  SELECT_BEST_ITEM = 'select_best_item',
  SELECT_MULTIPLE_ITEMS = 'select_multiple_items',
  DAY_TIMELINE = 'day_timeline',
  // faq chat
  FAQ_CLASSIFY_INTENT = 'faq_classify_intent',
  FAQ_TOUR_RECOMMENDATION = 'faq_tour_recommendation',
  FAQ_GENERAL_TRAVEL = 'faq_general_travel',
  FAQ_AUTO_REVIEW = 'faq_auto_review',
  FAQ_CLASSIFY_CATEGORIES = 'faq_classify_categories',
  FAQ_NO_MATCH_RESPONSE = 'faq_no_match_response',
  FAQ_GUIDELINE_ANSWER = 'faq_guideline_answer',
  FAQ_AUTO_ENRICH = 'faq_auto_enrich',
}

export interface PromptDefinition {
  key: PromptKey;
  name: string;
  description: string;
  category: string;
  defaultText: string;
  variables: string[];
  defaultTemperature: number;
  defaultMaxOutputTokens: number;
}

export const PROMPT_REGISTRY: Record<PromptKey, PromptDefinition> = {
  [PromptKey.ESTIMATE_ANALYSIS]: {
    key: PromptKey.ESTIMATE_ANALYSIS,
    name: '견적 분석',
    description:
      '견적 요청 시 고객 메시지와 아이템 목록을 받아 지역/관심사/키워드/그룹유형/예산/특이사항을 JSON으로 추출합니다. 결과는 일정 생성의 기초 데이터로 사용됩니다.',
    category: 'estimate',
    variables: ['requestContent', 'itemsSummary'],
    defaultTemperature: 0.3,
    defaultMaxOutputTokens: 2048,
    defaultText: `Extract travel preferences from the request and matched items.

## Request
{{requestContent}}

## Matched Key Items
{{itemsSummary}}

## Rules
- **regions**: Target cities (Seoul, Busan, etc.)
- **interests**: Themes (history, food, k-pop, nature)
- **keywords**: Specific entities mentioned
- **tourType**: private | package | group | custom | null
- **travelerType**: solo | couple | family | friends | group | null
- **priceRange**: budget | mid | premium | null
- **specialNeeds**: dietary, accessibility, pickup, etc.
- **NOTE**: Use primitive null (not "null" string) for missing values.

Respond ONLY with valid JSON:
{
  "regions": ["Seoul"],
  "interests": ["history"],
  "keywords": ["Bibimbap"],
  "tourType": "private",
  "travelerType": "family",
  "priceRange": "mid",
  "specialNeeds": []
}`,
  },

  [PromptKey.EMAIL_RAG_DRAFT]: {
    key: PromptKey.EMAIL_RAG_DRAFT,
    name: '일정 생성 (메인)',
    description:
      'RAG 기반 맞춤 여행 일정 생성의 핵심 프롬프트입니다. 고객 선호도·참고 이메일·DB 장소를 가공하여 고품질의 day-by-day JSON을 배출합니다. 이번 버전부터 강력한 지리적 동선(지리 인접성)과 시간적 흐름(Morning/Lunch/Afternoon/Dinner) 제약이 포함되어 있습니다.',
    category: 'estimate',
    variables: [
      'region',
      'duration',
      'groupDescription',
      'interestMain',
      'interestSub',
      'interestDetail',
      'tourType',
      'budgetRange',
      'isFirstVisit',
      'nationalityLine',
      'additionalNotesLine',
      'attractionsLine',
      'pickupLine',
      'availablePlacesSection',
      'emailContext',
      'estimateContext',
      'placesPerDayRange',
      'visitorTip',
      'customPromptAddon',
    ],
    defaultTemperature: 0.4,
    defaultMaxOutputTokens: 8192,
    defaultText: `Generate a detailed day-by-day itinerary JSON.

## Profile
- Region: {{region}}
- Duration: {{duration}} days
- Group: {{groupDescription}}
- Interests: {{interestMain}}, {{interestSub}}
- Budget: {{budgetRange}}
{{nationalityLine}}
{{attractionsLine}}

## References (Follow this style)
{{emailContext}}
{{estimateContext}}

## Database Places (Use ID/Name from here)
{{availablePlacesSection}}

## Instructions
1. **Flow**: Group nearby places. Morning -> Lunch -> Afternoon -> Dinner.
2. **Count**: Approx {{placesPerDayRange}} places/day.
3. **Must-haves**: Include {{attractionsLine}}.
4. **Output**: Only PLACE/ACTIVITY items (no hotels/transport unless critical).
{{customPromptAddon}}

Respond ONLY with valid JSON:
{
  "items": [
    {
      "placeName": "Name",
      "placeNameKor": "한글명",
      "dayNumber": 1,
      "orderIndex": 0,
      "timeOfDay": "Morning",
      "expectedDurationMins": 90,
      "reason": "Brief reason",
      "itemId": 123
    }
  ]
}`,
  },

  [PromptKey.PLACE_EXTRACTION]: {
    key: PromptKey.PLACE_EXTRACTION,
    name: '장소 추출',
    description:
      '이메일 본문에서 고유 장소명을 추출하여 DB 매칭에 활용합니다. 이메일 RAG 파이프라인의 전처리 단계로, 결과는 유사도 검색의 입력이 됩니다.',
    category: 'estimate',
    variables: ['emailContent'],
    defaultTemperature: 0.3,
    defaultMaxOutputTokens: 2048,
    defaultText: `Extract unique named places.

## Content
{{emailContent}}

## Rules
- Target: Attraction, Restaurant, Cafe, Shopping, Accommodation.
- Ignore: Generic terms (e.g. "a museum", "nice cafe").
- Region: Infer from context (Seoul, Jeju, etc.).

Respond ONLY with valid JSON:
{
  "places": [
    { "name": "Namsan Tower", "nameKor": "남산타워", "type": "attraction", "region": "Seoul" }
  ]
}`,
  },

  [PromptKey.FAQ_EXTRACTION]: {
    key: PromptKey.FAQ_EXTRACTION,
    name: 'FAQ 추출',
    description:
      'Gmail 동기화 시 이메일 스레드에서 고객 Q&A 쌍을 추출합니다. 추출된 FAQ는 pending 상태로 등록되어 자동/수동 리뷰 후 챗봇 응답에 활용됩니다.',
    category: 'faq',
    variables: ['subject', 'emailBody'],
    defaultTemperature: 0.3,
    defaultMaxOutputTokens: 4096,
    defaultText: `Extract Q&A pairs from email thread.

## Metadata
Subject: {{subject}}

## Body
{{emailBody}}

## Rules
- Extract only if Customer asked & Agent replied.
- Ignore generic greetings/layouts.
- Anonymize personal info.

Respond ONLY with valid JSON:
[
  {
    "question": "English Q",
    "questionKo": "Korean Q",
    "answer": "English A",
    "answerKo": "Korean A",
    "tags": ["tag1"],
    "category": "booking",
    "confidence": 0.9
  }
]`,
  },

  [PromptKey.ITEM_CONTENT]: {
    key: PromptKey.ITEM_CONTENT,
    name: '아이템 설명 생성',
    description:
      '장소/숙박/교통 등 아이템의 키워드와 한영 설명을 자동 생성합니다. 관리자가 아이템을 등록할 때 "AI 생성" 버튼으로 호출됩니다.',
    category: 'item',
    variables: ['typeLabel', 'nameKor', 'nameEng'],
    defaultTemperature: 0.7,
    defaultMaxOutputTokens: 2048,
    defaultText: `Generate promotional keywords and descriptions.

Item: {{nameEng}} ({{nameKor}})
Type: {{typeLabel}}

Respond ONLY with valid JSON:
{
  "keyword": "5-8 keywords (e.g. scenic, historical, photo-op)",
  "description": "Korean description (max 300 chars). Key highlights.",
  "descriptionEng": "English description (max 300 chars). Key highlights."
}`,
  },

  [PromptKey.TRAVEL_ASSISTANT]: {
    key: PromptKey.TRAVEL_ASSISTANT,
    name: '여행 어시스턴트',
    description:
      '일정 확인 화면의 대화형 AI 어시스턴트 system prompt입니다. 사용자 질문에 답변하고, 일정 수정 의도를 JSON으로 분류합니다. 응답 끝에 intent JSON 블록이 포함됩니다.',
    category: 'conversation',
    variables: ['contextInfo'],
    defaultTemperature: 0.7,
    defaultMaxOutputTokens: 800,
    defaultText: `Role: Korea Travel Assistant.
1. Answer questions (concise, friendly).
2. Detect intent (question vs modification).

Context:
{{contextInfo}}

## Classification
- **modification**: Add/Remove/Replace item, Regenerate day.
- **question**: General info.
- **feedback**: "Great", "Thanks".
- **other**: Off-topic.

## Output Structure
Reply with natural text (Answer), followed by JSON block.
**CRITICAL**: Use EXACTLY the schema below for the JSON block. Do not invent new keys (like "items" or "itemsToInclude").

Example:
"Sure, Namsan Tower is great for sunsets!"
\`\`\`json
{
  "intent": "modification",
  "modificationData": {
    "action": "add_item",
    "dayNumber": 2,
    "itemName": "Namsan Tower",
    "category": null
  }
}
\`\`\``,
  },

  [PromptKey.RANK_RECOMMENDATIONS]: {
    key: PromptKey.RANK_RECOMMENDATIONS,
    name: '장소 추천 순위',
    description:
      '사용자 질문에 관련된 장소를 DB 아이템 목록에서 선별하여 추천 순위로 반환합니다. 일정 어시스턴트가 장소 관련 질문을 받았을 때 호출됩니다.',
    category: 'conversation',
    variables: ['userRequest', 'interests', 'itemList', 'limit'],
    defaultTemperature: 0.3,
    defaultMaxOutputTokens: 1024,
    defaultText: `Rank TOP {{limit}} places matching request.

Request: "{{userRequest}}"
Interests: {{interests}}

## Candidates
{{itemList}}

Respond ONLY with valid JSON array:
[
  { "id": 123, "name": "Name", "reason": "Match reason" }
]`,
  },

  [PromptKey.MODIFICATION_INTENT]: {
    key: PromptKey.MODIFICATION_INTENT,
    name: '수정 의도 파악',
    description:
      '사용자의 일정 수정 요청을 분석하여 수행할 작업(일차 재생성/장소 추가/삭제/교체 등)을 결정합니다. 결과에 따라 서버가 자동으로 일정을 수정합니다.',
    category: 'itinerary',
    variables: ['itineraryText', 'interests', 'region', 'userMessage'],
    defaultTemperature: 0.2,
    defaultMaxOutputTokens: 1024,
    defaultText: `Determine action for itinerary modification.

Context: {{itineraryText}}
Request: "{{userMessage}}"

## Actions
- regenerate_day (Re-plan specific day)
- add_item (Add specific place)
- remove_item (Delete place)
- replace_item (Swap place)
- general_feedback (No action)

Respond ONLY with valid JSON:
{
  "action": "add_item",
  "dayNumber": 2,
  "itemName": "Namsan Tower",
  "category": null,
  "confidence": 0.95
}`,
  },

  [PromptKey.SELECT_BEST_ITEM]: {
    key: PromptKey.SELECT_BEST_ITEM,
    name: '최적 장소 선택',
    description:
      '일정 수정 시 DB 아이템 후보 목록에서 사용자 요청에 가장 적합한 단일 장소를 선택합니다. add_item/replace_item 액션에서 호출됩니다.',
    category: 'itinerary',
    variables: ['userRequest', 'interests', 'context', 'itemList'],
    defaultTemperature: 0.3,
    defaultMaxOutputTokens: 512,
    defaultText: `Select the single best place matching user request.

User request: "{{userRequest}}"
Interests: {{interests}}
{{context}}

## Candidates
{{itemList}}

Respond ONLY with valid JSON description:
{
  "selectedId": <ID number>,
  "reason": "brief matching reason"
}`,
  },

  [PromptKey.SELECT_MULTIPLE_ITEMS]: {
    key: PromptKey.SELECT_MULTIPLE_ITEMS,
    name: '다중 장소 선택',
    description:
      'regenerate_day 액션에서 호출되어 특정 일차의 장소를 DB 후보 목록에서 새로 선택합니다. 동선·다양성·관심사를 고려하여 최적 조합을 반환합니다.',
    category: 'itinerary',
    variables: ['dayNumber', 'region', 'interests', 'count', 'itemList'],
    defaultTemperature: 0.5,
    defaultMaxOutputTokens: 1024,
    defaultText: `Select {{count}} places for Day {{dayNumber}} in {{region}}.

Interests: {{interests}}

## Candidates
{{itemList}}

## Criteria
- Logical visiting order (nearby places).
- Mix of types (culture, food, nature).
- Align with interests.

Respond ONLY with valid JSON array:
[
  { "selectedId": <ID>, "reason": "brief reason" }
]`,
  },

  [PromptKey.DAY_TIMELINE]: {
    key: PromptKey.DAY_TIMELINE,
    name: '일정 타임라인',
    description:
      '확정된 일차의 장소 목록을 자연스러운 일정 설명(타임라인)으로 변환합니다. 각 장소에 대한 짧은 활동 설명이 포함되며, 견적서의 일정 설명 텍스트로 사용됩니다.',
    category: 'itinerary',
    variables: ['dayNumber', 'itemList'],
    defaultTemperature: 0.7,
    defaultMaxOutputTokens: 0,
    defaultText: `Create a concise timeline for Day {{dayNumber}}.

## Items
{{itemList}}

## Format
- English.
- "[Place] – [Activity (max 6 words)]"
- No description for Pickup/Dropoff.

Example:
- Pick up at Hotel
- Gyeongbokgung – Palace tour and guard ceremony
- Insadong – Cultural street and tea
- Drop off at Hotel

Timeline:`,
  },

  [PromptKey.FAQ_CLASSIFY_INTENT]: {
    key: PromptKey.FAQ_CLASSIFY_INTENT,
    name: '의도 분류',
    description:
      'FAQ 챗봇의 첫 단계로, 사용자 질문을 company(회사/예약)/tour_recommend(투어 추천)/travel(일반 여행) 3가지로 분류합니다. 분류 결과에 따라 다른 응답 파이프라인이 실행됩니다.',
    category: 'faq',
    variables: ['message'],
    defaultTemperature: 0,
    defaultMaxOutputTokens: 128,
    defaultText: `Classify intention into ONE category.

## Categories
- **company**: Booking, refund, agency info, guide, driver.
- **tour_recommend**: "Recommend a tour", "Where to go", booking inquiry.
- **travel**: General Korea info (weather, transport, food).

Question: "{{message}}"

Respond ONLY with one word: company | tour_recommend | travel`,
  },

  [PromptKey.FAQ_TOUR_RECOMMENDATION]: {
    key: PromptKey.FAQ_TOUR_RECOMMENDATION,
    name: '투어 추천 응답',
    description:
      '의도가 tour_recommend로 분류된 경우, 매칭된 투어 정보를 기반으로 자연스러운 추천 답변을 생성합니다. 투어 카드 UI와 함께 표시되므로 URL은 포함하지 않습니다.',
    category: 'faq',
    variables: ['tourInfo'],
    defaultTemperature: 0.7,
    defaultMaxOutputTokens: 400,
    defaultText: `Recommend tours based on request.

## Matches
{{tourInfo}}

## Guidelines
- Sales-friendly tone ("I recommend...").
- Explain *why* it fits.
- NO URLs (Cards will be shown).
- Suggest "Tour Inquiry" for custom needs.
- Keep it under 300 characters.`,
  },

  [PromptKey.FAQ_GENERAL_TRAVEL]: {
    key: PromptKey.FAQ_GENERAL_TRAVEL,
    name: '일반 여행 응답',
    description:
      '의도가 travel로 분류된 경우의 system prompt입니다. 한국 여행 일반 정보(날씨, 교통, 음식, 비자 등)에 대해 Gemini가 직접 답변합니다. FAQ DB를 사용하지 않습니다.',
    category: 'faq',
    variables: [],
    defaultTemperature: 0.7,
    defaultMaxOutputTokens: 512,
    defaultText: `Answer general Korea travel question.

## Guidelines
- Friendly, concise (max 3 sentences).
- If unsure, suggest official inspection.
- For prices, say "Contact info@onedaykorea.com".

Question: "{{userMessage}}" // (Note: Variable injection handled by context usually, checking usage)
(Actually logic uses context history, prompt is system instruction)
System Instruction:
Answer correctly. If asking about tour prices, refer to email.
Example: "Seoul is very safe. Subway runs until midnight."`,
  },

  [PromptKey.FAQ_AUTO_REVIEW]: {
    key: PromptKey.FAQ_AUTO_REVIEW,
    name: '자동 리뷰',
    description:
      'Gmail에서 추출한 pending FAQ를 AI가 일괄 평가합니다. approve(승인)/reject(거절)/review(수동 확인 필요) 결정과 confidence 점수를 반환하여 FAQ 품질을 자동 관리합니다.',
    category: 'faq',
    variables: ['faqList'],
    defaultTemperature: 0,
    defaultMaxOutputTokens: 8192,
    defaultText: `Review FAQ candidates.

## List
{{faqList}}

## Decision
- APPROVE: Clear, helpful, generic.
- REJECT: Spam, personal info, too specific.
- REVIEW: Unsure.

Respond ONLY with valid JSON array:
[{"id":1, "decision":"approve", "confidence":90, "reason":"good generic Q"}]`,
  },

  [PromptKey.FAQ_CLASSIFY_CATEGORIES]: {
    key: PromptKey.FAQ_CLASSIFY_CATEGORIES,
    name: '카테고리 분류',
    description:
      '승인된 FAQ를 카테고리(booking, tour, payment, transportation 등)별로 자동 분류합니다. 챗봇의 유사도 검색 정확도를 높이기 위한 메타데이터로 활용됩니다.',
    category: 'faq',
    variables: ['categories', 'faqList'],
    defaultTemperature: 0,
    defaultMaxOutputTokens: 4096,
    defaultText: `Classify FAQ category.

Categories: {{categories}}
FAQs: {{faqList}}

Respond ONLY with valid JSON array:
[{"id":1, "category":"booking"}]`,
  },

  [PromptKey.FAQ_NO_MATCH_RESPONSE]: {
    key: PromptKey.FAQ_NO_MATCH_RESPONSE,
    name: '매칭 없음 응답',
    description:
      '회사 관련 질문이지만 유사한 FAQ가 없을 때 반환하는 고정 응답 텍스트입니다. 변수 치환이 없는 단순 텍스트이며, maxOutputTokens는 사용되지 않습니다.',
    category: 'faq',
    variables: [],
    defaultTemperature: 0,
    defaultMaxOutputTokens: 0,
    defaultText: `I don't have that info in the FAQ. For tour pricing or bookings, please start a **tour inquiry** or email **info@onedaykorea.com**.`,
  },

  [PromptKey.FAQ_GUIDELINE_ANSWER]: {
    key: PromptKey.FAQ_GUIDELINE_ANSWER,
    name: '가이드라인 기반 FAQ 응답',
    description:
      '단일 FAQ 매칭 후, guideline과 reference를 참고하여 자연스러운 답변을 생성합니다.',
    category: 'faq',
    variables: ['faqQuestion', 'faqGuideline'],
    defaultTemperature: 0.5,
    defaultMaxOutputTokens: 512,
    defaultText: `Answer using FAQ.

Q: {{faqQuestion}}
Guide: {{faqGuideline}}

## Rules
- Language: MUST reply ONLY in {{userLanguage}}. (Ignore language of the example).
- Tone: Friendly, concise.
- Pricing: Use ranges ($10-20), or contact email.

Example:
"Tipping isn't required but appreciated ($10-20)."`,
  },

  [PromptKey.FAQ_AUTO_ENRICH]: {
    key: PromptKey.FAQ_AUTO_ENRICH,
    name: 'FAQ 자동 보강',
    description:
      'FAQ 등록/수정 시 질문과 답변을 분석하여 한국어 번역, 카테고리 분류, 태그 추출을 자동으로 수행합니다.',
    category: 'faq',
    variables: ['question', 'answer'],
    defaultTemperature: 0.3,
    defaultMaxOutputTokens: 1024,
    defaultText: `Analyze FAQ entry. Provide translation, category, tags.

## FAQ
Q: {{question}}
A: {{answer}}

## Rules
- Translate naturally (English <-> Korean).
- Category: general, booking, tour, payment, transportation, accommodation, visa, other.
- Tags: 2-5 lowercase English keywords.

Respond ONLY with valid JSON:
{"questionKo": "한글 질문", "answerKo": "한글 답변", "category": "booking", "tags": ["tag1"]}`,
  },
};
