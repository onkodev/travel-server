# FAQ 챗봇 시스템 문서

## 개요

FAQ 챗봇은 **의도 분류 + 임베딩 유사도 검색 + Gemini AI 생성**을 결합한 하이브리드 시스템입니다.
사용자 질문을 3가지 의도로 분류하고, 의도에 따라 다른 응답 파이프라인을 실행합니다.

---

## 전체 플로우

```
사용자 질문 입력
       │
       ▼
┌──────────────────────────────────┐
│  4개 작업 병렬 실행 (Promise.all) │
├──────────────────────────────────┤
│ 1. 의도 분류 (Gemini)            │
│ 2. FAQ 유사도 검색 (pgvector)    │
│ 3. 제안 질문 검색 (pgvector)     │
│ 4. 투어 검색 (pgvector)         │
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│       의도별 분기 처리            │
├──────────┬───────────┬───────────┤
│ company  │tour_rec   │ travel    │
│          │ommend     │           │
└────┬─────┴─────┬─────┴─────┬─────┘
     │           │           │
     ▼           ▼           ▼
  유사도≥0.7?  투어있음?   일반여행답변
  ├─Yes→ RAG   ├─Yes→투어추천  (Gemini)
  └─No→no_match└─No→일반여행
     │
     ▼
  로그 저장 → 응답 반환
```

---

## API 엔드포인트

| 엔드포인트 | 메서드 | 설명 | Rate Limit |
|-----------|--------|------|-----------|
| `/faq/chat` | POST | 메인 채팅 | 15회/60초 |
| `/faq/search` | GET | 유사 FAQ 검색 | 10회/60초 |
| `/faq/feedback` | POST | 👍/👎 피드백 | 10회/60초 |
| `/faq/regenerate` | POST | 다른 답변 요청 | 10회/60초 |
| `/faq/answer/:id` | GET | 제안 질문 클릭 시 원문 답변 | 15회/60초 |

### 요청/응답 구조

**POST /faq/chat 요청:**
```typescript
{
  message: string;        // 1-1000자
  history?: Array<{       // 최대 10개, 멀티턴 대화
    role: 'user' | 'assistant';
    content: string;
  }>;
  visitorId?: string;     // 익명 추적 UUID
}
```

**응답:**
```typescript
{
  answer: string;
  sources?: Array<{ question: string; id: number }>;
  noMatch: boolean;
  responseTier: 'rag' | 'general' | 'tour_recommend' | 'no_match';
  suggestedQuestions?: Array<{ id: number; question: string }>;
  tourRecommendations?: Array<{ id, name, price, region, ... }>;
  chatLogId?: number;
}
```

---

## Step 1: 의도 분류

**프롬프트 키:** `FAQ_CLASSIFY_INTENT`
**Temperature:** 0 (결정론적)
**maxOutputTokens:** 128

사용자 메시지를 3가지 중 하나로 분류:

| 의도 | 설명 | 예시 |
|-----|------|------|
| `company` | 예약, 취소, 환불, 정책, 가이드, 픽업 등 회사 관련 | "Can I cancel my tour?" |
| `tour_recommend` | 투어 추천, 어떤 투어가 있는지 | "Recommend a tour for families" |
| `travel` | 날씨, 교통, 음식, 비자 등 일반 여행 정보 | "What's the weather like in April?" |

**에러 시:** `travel`로 기본 처리

---

## Step 2: 유사도 검색 (병렬)

### 2a. Top FAQ 검색
- **서비스:** `FaqEmbeddingService.searchSimilar(message, limit=1)`
- **방식:** pgvector cosine similarity
- **최소 유사도:** 0.35 (`FAQ_SIMILARITY.MIN_SEARCH`)
- **대상:** `status='approved'` 인 FAQ만

### 2b. 제안 질문 검색
- **limit:** 3
- **최소 유사도:** 0.45 (`FAQ_SIMILARITY.SUGGESTION_THRESHOLD`)
- **no_match 시에만** 클라이언트에 전달

### 2c. 투어 검색
- **대상:** `odk_tours` 테이블 (임베딩 있는 활성 투어)
- **최소 유사도:** 0.45 (`FAQ_SIMILARITY.TOUR_SEARCH`)
- **limit:** 5
- 현재 메시지 + 최근 3개 사용자 메시지를 합쳐 검색 쿼리 구성

---

## Step 3: 의도별 응답 생성

### 유사도 임계값 정리

```
FAQ_SIMILARITY = {
  DIRECT_THRESHOLD:     0.7   → RAG 답변 트리거
  SUGGESTION_THRESHOLD: 0.45  → 제안 질문 최소 유사도
  SOURCE_FILTER:        0.4   → sources 포함 기준
  TOUR_SEARCH:          0.45  → 투어 검색 최소 유사도
  MIN_SEARCH:           0.35  → FAQ 검색 최소 유사도
}
```

### 응답 티어 (Response Tier)

| 티어 | 조건 | 답변 소스 | 프롬프트 키 |
|-----|------|----------|-----------|
| **rag** | company + 유사도 ≥ 0.7 | FAQ guideline + Gemini | `FAQ_GUIDELINE_ANSWER` |
| **tour_recommend** | tour_recommend + 투어 있음 | 투어 정보 + Gemini | `FAQ_TOUR_RECOMMENDATION` |
| **general** | travel 의도 (또는 투어 없는 tour_recommend) | Gemini 직접 답변 | `FAQ_GENERAL_TRAVEL` |
| **no_match** | company + 유사도 < 0.7 | 고정 메시지 + 제안 질문 | `FAQ_NO_MATCH_RESPONSE` |

### RAG 응답 (`rag`)
1. 매칭된 FAQ의 `guideline` + `reference` 조합
2. `FAQ_GUIDELINE_ANSWER` 프롬프트에 주입
3. Gemini가 가이드라인 기반으로 자연스러운 답변 생성
4. `disableThinking: true` (thinking 비활성화)

### 투어 추천 (`tour_recommend`)
1. 매칭된 투어 정보를 포맷팅 (이름, 가격, 지역, 소요시간)
2. `FAQ_TOUR_RECOMMENDATION` 프롬프트에 주입
3. Gemini가 추천 문구 생성
4. 투어 카드 UI는 별도 표시 (답변에 URL 포함 안 함)

### 일반 여행 (`general`)
1. FAQ 컨텍스트 없이 Gemini가 직접 답변
2. `FAQ_GENERAL_TRAVEL` 프롬프트 사용
3. 관련 투어가 있으면 투어 카드도 함께 표시

### 매칭 없음 (`no_match`)
1. 설정의 `noMatchResponse` 사용 (커스텀 메시지)
2. 없으면 `FAQ_NO_MATCH_RESPONSE` 기본 텍스트
3. 유사도 ≥ 0.45인 제안 질문 최대 3개 표시

---

## Step 4: 로그 및 피드백

### 채팅 로그 저장 (`faqChatLog`)
- message, answer, matchedFaqIds, matchedSimilarities
- topSimilarity, noMatch, responseTier, visitorId
- `chatLogId` 반환 → 피드백/재생성에 사용

### FAQ viewCount 증가
- 매칭된 FAQ가 있으면 `viewCount++` (fire-and-forget)

### 피드백 (`POST /faq/feedback`)
- `chatLogId` + `helpful` (true/false)
- 매칭된 FAQ의 `helpfulCount` 또는 `notHelpfulCount` 증가

### 답변 재생성 (`POST /faq/regenerate`)
1. 원본 로그에서 message + 이미 사용한 FAQ ID 가져옴
2. 유사 FAQ 10개 검색 → 이미 사용한 것 제외
3. 다음 FAQ로 `generateGuidelineAnswer` 실행
4. 새 로그 생성 + `hasMore` 반환 (더 가능한 FAQ 있는지)

---

## 프롬프트 시스템

### 프롬프트 빌드 파이프라인

```
1. 레지스트리 기본값 (prompt-registry.ts)
       │
       ▼
2. DB 오버라이드 (aiPromptTemplate 테이블)
   - promptText: null이면 레지스트리 기본값
   - temperature/maxOutputTokens: null이면 레지스트리 기본값
       │
       ▼
3. FAQ 프리셋 오버라이드 (FAQ 답변 프롬프트만)
   - faqAnswerStyle → temperature 오버라이드
   - faqAnswerLength → maxOutputTokens 오버라이드
   - faqCustomInstructions → 변수로 주입
       │
       ▼
4. 변수 치환 (resolveTemplate)
   - {{변수명}} → 실제 값
   - {{currentDate}} 자동 주입
   - 미사용 {{변수}} 제거
       │
       ▼
5. 최종 { text, temperature, maxOutputTokens }
```

### FAQ 답변 프리셋 (4개 프롬프트에 적용)

적용 대상: `FAQ_RAG_ANSWER`, `FAQ_GENERAL_TRAVEL`, `FAQ_TOUR_RECOMMENDATION`, `FAQ_GUIDELINE_ANSWER`

**답변 스타일 (faqAnswerStyle → temperature):**
| 프리셋 | Temperature | 설명 |
|--------|------------|------|
| precise | 0.2 | 정확하고 일관된 응답 |
| balanced | 0.5 | 균형 잡힌 응답 (기본값) |
| conversational | 0.8 | 대화체, 창의적 |

**답변 길이 (faqAnswerLength → maxOutputTokens):**
| 프리셋 | Tokens | 설명 |
|--------|--------|------|
| concise | 300 | 간결한 응답 |
| standard | 500 | 표준 (기본값) |
| detailed | 800 | 상세한 응답 |

### FAQ 관련 프롬프트 키 (9개)

| 키 | 용도 | 변수 | 기본 Temp | 기본 Tokens |
|----|------|------|----------|------------|
| `FAQ_CLASSIFY_INTENT` | 의도 분류 | message | 0 | 128 |
| `FAQ_GUIDELINE_ANSWER` | 가이드라인 기반 답변 | faqQuestion, faqGuideline | 0.5 | 512 |
| `FAQ_RAG_ANSWER` | 다중 FAQ 기반 답변 | faqContext | 0.5 | 512 |
| `FAQ_GENERAL_TRAVEL` | 일반 여행 답변 | - | 0.7 | 512 |
| `FAQ_TOUR_RECOMMENDATION` | 투어 추천 답변 | tourInfo | 0.7 | 400 |
| `FAQ_NO_MATCH_RESPONSE` | 매칭 없음 메시지 | - | 0 | 0 |
| `FAQ_AUTO_REVIEW` | 자동 리뷰 (관리자) | faqList | 0 | 8192 |
| `FAQ_CLASSIFY_CATEGORIES` | 카테고리 분류 | categories, faqList | 0 | 4096 |
| `FAQ_EXTRACTION` | 이메일 Q&A 추출 | subject, emailBody | 0.3 | 4096 |

---

## 캐시 구조

### 서버 캐시 (MemoryCache, TTL 10분)

| 캐시 키 | 내용 | 무효화 시점 |
|---------|------|-----------|
| `prompt:${key}` | 프롬프트 템플릿 | `updatePrompt()`, `resetPrompt()` 호출 시 즉시 삭제 |
| `faq-config` | FAQ 답변 설정 | `updateFaqChatConfig()` 호출 시 즉시 삭제 |
| `estimate-config` | 견적 설정 | `updateEstimateConfig()` 호출 시 즉시 삭제 |

### 설정 변경 시 반영 시점

**즉시 반영됩니다.** 설정 API를 호출하면:
1. DB 업데이트
2. **해당 캐시 키 즉시 삭제** (`cache.delete()`)
3. 다음 요청 시 DB에서 새 값을 읽어 캐시에 저장

따라서 어드민에서 설정 저장 → 바로 다음 챗봇 질문부터 새 설정이 적용됩니다.

> **참고:** 캐시 TTL 10분은 "같은 값을 10분간 재사용"하는 것이지, "변경 후 10분 뒤에 반영"이 아닙니다.
> 명시적 `cache.delete()` 호출로 즉시 무효화됩니다.

---

## 멀티턴 대화

### 히스토리 변환 (Gemini 형식)

```typescript
// 입력
[{ role: 'user', content: '...' }, { role: 'assistant', content: '...' }]

// Gemini 형식으로 변환
[{ role: 'user', parts: [{ text: '...' }] }, { role: 'model', parts: [{ text: '...' }] }]
```

- `assistant` → `model` (Gemini 명칭)
- 모든 답변 생성 메서드에 history 전달
- 투어 검색 시 최근 3개 사용자 메시지를 쿼리에 추가

---

## Gemini API 호출

- **기본 모델:** `gemini-2.5-flash`
- **Rate Limit 재시도:** 최대 5회, 지수 백오프 (2초 × 2^N + 랜덤)
- **Thinking 비활성화:** FAQ 모든 답변 생성에서 `disableThinking: true`
  - 빠른 응답을 위해 reasoning 단계 생략

---

## 설정값 요약

### aiGenerationConfig 테이블 (FAQ 관련)

| 필드 | 타입 | 기본값 | 설명 |
|-----|------|-------|------|
| `noMatchResponse` | text | null | 매칭 없음 시 커스텀 메시지 |
| `faqAnswerStyle` | string | 'balanced' | temperature 프리셋 |
| `faqAnswerLength` | string | 'standard' | maxOutputTokens 프리셋 |
| `faqCustomInstructions` | text | null | 모든 FAQ 답변 프롬프트에 주입되는 추가 지시 |

### aiPromptTemplate 테이블

| 필드 | 설명 |
|-----|------|
| `key` | 프롬프트 키 (unique) |
| `promptText` | 커스텀 텍스트 (null = 레지스트리 기본값) |
| `temperature` | 커스텀 temperature (null = 레지스트리 기본값) |
| `maxOutputTokens` | 커스텀 토큰 수 (null = 레지스트리 기본값) |
| `isActive` | 활성 여부 |

---

## 파일 위치

| 파일 | 역할 |
|-----|------|
| `modules/faq/faq-chat.service.ts` | 메인 FAQ 채팅 로직 |
| `modules/faq/faq-chat.controller.ts` | FAQ 채팅 API |
| `modules/faq/faq-embedding.service.ts` | 임베딩 생성 + 유사도 검색 |
| `modules/faq/faq.constants.ts` | 유사도 임계값, 배치 크기 |
| `modules/ai-prompt/prompt-registry.ts` | 18개 프롬프트 정의 |
| `modules/ai-prompt/ai-prompt.service.ts` | 프롬프트 빌드 + 캐시 + 설정 관리 |
| `modules/ai-prompt/prompt-resolver.ts` | 템플릿 변수 치환 |
| `modules/ai/core/gemini-core.service.ts` | Gemini API 호출 + 재시도 |
