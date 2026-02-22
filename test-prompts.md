# Gemini 속도 테스트 프롬프트 (3개)

설정: gemini-2.5-flash, temperature=0.7, maxOutputTokens=8192, thinkingBudget=0

복사 방법: 각 테스트의 ``` 안쪽 텍스트만 전체 복사 → Google Workspace Gemini에 붙여넣기

---

## 테스트 1: 서울 3일 — 첫 방문 커플

```
You are a Korea travel itinerary expert. Search my emails for similar past itineraries as reference, then create a PERSONALIZED day-by-day itinerary based on the customer profile below.

## CUSTOMER PROFILE
- Region: Seoul
- Duration: 3 days
- Group: 2 adult(s)
- Interests: culture, food
  → Specifically looking for: Korean traditional culture, K-pop landmarks, street food, fine dining
- Tour type: private
- Budget: mid
- First visit to Korea: Yes
- Nationality: American
- Special requests: We love trying local food and want to see both modern and traditional Seoul

## RULES
- The itinerary MUST reflect the customer's stated interests above all else.
- At least 60% of places must directly relate to their primary interest categories.
- Each day must include at least 1 place from their primary interest.
- Create 3 days with 3-5 places per day.
- Focus on PLACE type items only (no accommodation or transport).
- Use real Korean place names in both English and Korean.
- Prioritize must-see landmarks for first-time visitors.
- Match the mid budget level in place selection.
- Include a brief reason why each place is recommended.

Respond ONLY with valid JSON (no markdown):
{
  "items": [
    {
      "placeName": "English name",
      "placeNameKor": "한글 이름",
      "dayNumber": 1,
      "orderIndex": 0,
      "reason": "Why this place is recommended"
    }
  ]
}
```

---

## 테스트 2: 제주 2일 — 재방문 가족

```
You are a Korea travel itinerary expert. Search my emails for similar past itineraries as reference, then create a PERSONALIZED day-by-day itinerary based on the customer profile below.

## CUSTOMER PROFILE
- Region: Jeju
- Duration: 2 days
- Group: 2 adult(s), 2 child(ren)
- Interests: nature, activity
  → Specifically looking for: hiking trails, ocean views, family-friendly outdoor activities, unique natural formations
- Tour type: private
- Budget: high
- First visit to Korea: No
- Nationality: Japanese
- Special requests: Children are 8 and 10 years old. We visited Seoul last year. Looking for outdoor adventures.

## RULES
- The itinerary MUST reflect the customer's stated interests above all else.
- At least 60% of places must directly relate to their primary interest categories.
- Each day must include at least 1 place from their primary interest.
- Create 2 days with 3-5 places per day.
- Focus on PLACE type items only (no accommodation or transport).
- Use real Korean place names in both English and Korean.
- Include hidden gems and local favorites for returning visitors.
- Match the high budget level in place selection.
- Include a brief reason why each place is recommended.

Respond ONLY with valid JSON (no markdown):
{
  "items": [
    {
      "placeName": "English name",
      "placeNameKor": "한글 이름",
      "dayNumber": 1,
      "orderIndex": 0,
      "reason": "Why this place is recommended"
    }
  ]
}
```

---

## 테스트 3: 부산 4일 — 시니어 그룹

```
You are a Korea travel itinerary expert. Search my emails for similar past itineraries as reference, then create a PERSONALIZED day-by-day itinerary based on the customer profile below.

## CUSTOMER PROFILE
- Region: Busan
- Duration: 4 days
- Group: 4 adult(s)
- Interests: history, nature, food
  → Specifically looking for: Korean War history, temple visits, coastal scenery, traditional Korean cuisine, local seafood markets
- Tour type: group
- Budget: low
- First visit to Korea: Yes
- Nationality: British
- Special requests: All members are 60+. Please avoid steep climbs. We are history enthusiasts and love fresh seafood.
- MUST include these attractions: Gamcheon Culture Village, Jagalchi Fish Market

## RULES
- The itinerary MUST reflect the customer's stated interests above all else.
- At least 60% of places must directly relate to their primary interest categories.
- Each day must include at least 1 place from their primary interest.
- Create 4 days with 3-5 places per day.
- Focus on PLACE type items only (no accommodation or transport).
- Use real Korean place names in both English and Korean.
- Prioritize must-see landmarks for first-time visitors.
- Match the low budget level in place selection.
- If specific attractions are listed, they MUST appear in the itinerary.
- Include a brief reason why each place is recommended.

Respond ONLY with valid JSON (no markdown):
{
  "items": [
    {
      "placeName": "English name",
      "placeNameKor": "한글 이름",
      "dayNumber": 1,
      "orderIndex": 0,
      "reason": "Why this place is recommended"
    }
  ]
}
```
