# FAQ 챗봇 응답 로직

> 사용자가 채팅창에 질문을 입력하면, 어떤 과정을 거쳐 답변이 만들어지는지 처음부터 끝까지 설명합니다.

## 전체 흐름 한눈에 보기

```
사용자 질문 입력
      │
      ▼
┌─────────────────────┐
│ 1. 임베딩 생성 (1회) │  ← 질문 텍스트 → 768차원 숫자 벡터
└─────────┬───────────┘
          │
          ▼
┌─────────────────────────────────────┐
│ 2. 병렬 실행 (3가지 동시에)          │
│                                     │
│  ┌─────────────┐  ┌──────────────┐  │
│  │ 의도 분류    │  │ FAQ 검색     │  │
│  │ (company?   │  │ (벡터+BM25   │  │
│  │  tour?      │  │  하이브리드)  │  │
│  │  travel?)   │  │              │  │
│  └──────┬──────┘  └──────┬───────┘  │
│         │                │          │
│  ┌──────┴──────────────┐ │          │
│  │ 투어 검색            │ │          │
│  │ (odk_tours 벡터검색) │ │          │
│  └──────┬──────────────┘ │          │
└─────────┼────────────────┼──────────┘
          │                │
          ▼                ▼
┌─────────────────────────────────────┐
│ 3. 의도 + 유사도 조합 → 분기 결정    │
│                                     │
│  tour_recommend → 투어 추천 답변     │
│  company + 고유사도 → RAG 답변       │
│  company + 저유사도 → no_match       │
│  travel → 일반 여행정보 답변          │
└─────────┬───────────────────────────┘
          │
          ▼
┌─────────────────────┐
│ 4. 로그 저장 + 응답  │
└─────────────────────┘
```

---

## Step 1: 임베딩 생성

**파일**: `src/modules/ai/core/embedding.service.ts`

사용자가 입력한 텍스트를 **768차원 숫자 벡터**로 변환합니다.

```
"refund policy" → [0.023, -0.156, 0.891, ..., 0.034]  (768개 숫자)
```

- **모델**: Gemini Embedding API (`gemini-embedding-001`)
- **1회만 생성**: 이 벡터를 FAQ 검색, 투어 검색, 의도 분류에 모두 재사용
- **최대 8,000자**: 초과 시 자동 잘림
- API 실패 시 최대 5회 재시도 (exponential backoff)

### 왜 임베딩을 쓰나요?

텍스트를 숫자 벡터로 바꾸면 **의미적 유사도**를 수학적으로 계산할 수 있습니다.
"refund policy"와 "What is your refund policy?"는 단어가 다르지만, 벡터 공간에서 가까운 위치에 놓입니다.

---

## Step 2: 병렬 실행 (3가지 동시)

임베딩이 생성되면 3가지 작업을 **동시에** 실행합니다 (성능 최적화).

### 2-A. 의도 분류 (Intent Classification)

**파일**: `src/modules/faq/faq-chat.service.ts` → `classifyIntent()`

사용자 질문이 어떤 **카테고리**에 속하는지 판단합니다. LLM 호출 없이, 미리 준비된 레퍼런스 문장과의 코사인 유사도로 분류합니다.

| 의도 | 설명 | 레퍼런스 문장 예시 |
|------|------|-------------------|
| `company` | 회사/서비스 관련 질문 | "What is your refund policy?", "How do I cancel?" |
| `tour_recommend` | 투어 추천 요청 | "Recommend a tour for me", "Best day trips?" |
| `travel` | 일반 한국 여행 정보 | "Best time to visit Korea?", "How does the subway work?" |

**작동 원리**: 각 의도별 10개 레퍼런스 문장의 임베딩과 사용자 질문 임베딩의 코사인 유사도를 비교 → 가장 높은 점수의 의도를 선택

### 2-B. FAQ 하이브리드 검색

**파일**: `src/modules/faq/faq-embedding.service.ts` → `searchSimilarByVector()`

DB에 저장된 FAQ들 중 사용자 질문과 가장 유사한 것들을 찾습니다.

#### 검색 방식: 영문 쿼리 vs 비영문 쿼리

| 조건 | 검색 방식 | 이유 |
|------|----------|------|
| 영문 텍스트 포함 (`/[a-zA-Z]{2,}/`) | **하이브리드** (벡터 + BM25 + RRF) | BM25가 영어 stemming 지원 ("refunding" → "refund") |
| 한국어/비영문만 | **벡터 전용** + Title Boost | BM25 english config로는 한국어 매칭 불가 |

#### 하이브리드 검색 파이프라인 (영문 쿼리)

6단계 SQL CTE로 구성됩니다:

```
① vector_candidates
   HNSW 인덱스로 벡터 유사도 상위 N개 후보 추출

② bm25_candidates
   GIN 인덱스로 키워드 매칭 (PostgreSQL Full-Text Search)
   "refund policy" → "refund" & "policy" 단어 포함 FAQ 찾기

③ all_faq_ids
   ①과 ②의 FAQ ID 합집합 (UNION)

④ faq_scores
   FAQ별 최대 벡터/BM25 점수 계산
   + Title Boost: primary/primary_ko variant는 점수 × 1.10

⑤ ranked
   벡터 순위와 BM25 순위 각각 매기기

⑥ rrf_scored
   RRF 점수 = 0.7/(60+벡터순위) + 0.3/(60+BM25순위)
```

**핵심 설계**:
- **필터링** (이 FAQ를 보여줄까?): `boosted_vec_sim >= 임계값` → 기존 임계값 체계와 호환
- **랭킹** (어떤 FAQ가 1위?): `hybrid_score (RRF)` → 키워드+의미 복합 순위

#### Title Boost란?

FAQ는 여러 variant(변형)로 저장됩니다:

| variant | 예시 | Boost |
|---------|------|-------|
| `primary` | "What is your refund policy?" | **×1.10** |
| `primary_ko` | "환불 정책은 어떻게 되나요?" | **×1.10** |
| `alternative_0` | "Can I get my money back?" | ×1.00 |
| `alternative_1` | "How do refunds work?" | ×1.00 |

제목(primary) 질문과 직접 매칭되면 10% 점수 보너스 → 제목이 정확히 일치하는 FAQ가 자연스럽게 상위 랭킹

#### RRF (Reciprocal Rank Fusion)란?

벡터 유사도와 BM25 점수는 스케일이 완전히 다릅니다 (벡터: 0~1, BM25: 0~∞). 직접 합산하면 BM25가 지배하게 됩니다.

RRF는 **점수 대신 순위**를 사용해 이 문제를 해결합니다:

```
RRF(d) = w₁/(k + rank_vector) + w₂/(k + rank_bm25)

w₁ = 0.7  (벡터 가중치, 의미적 유사도 중심)
w₂ = 0.3  (BM25 가중치, 키워드 매칭 보조)
k  = 60   (smoothing 상수, IR 분야 표준값)
```

### 2-C. 투어 검색

**파일**: `src/modules/faq/faq-chat.service.ts` → `searchOdkToursByVector()`

`odk_tours` 테이블에서 벡터 유사도 기반으로 관련 투어를 찾습니다. 최소 유사도 0.45 이상인 활성 투어만 반환.

---

## Step 3: 분기 결정 (Response Tier)

의도 분류 결과와 FAQ 검색 유사도를 조합하여 5가지 응답 전략 중 하나를 선택합니다.

```
                    ┌─ tour_recommend intent
                    │   └─ 투어 있음? ─── Yes → [tour_recommend] 투어 추천 답변
                    │                  └─ No  → [general] 일반 여행 답변
                    │
의도 분류 결과 ──────┼─ company intent
                    │   └─ 유사도 ≥ 0.65? ── Yes → [rag] 가이드라인 기반 AI 답변
                    │                      └─ No  → [no_match] 매칭 실패 + 제안 질문
                    │
                    └─ travel intent
                        └─ [general] 일반 여행 답변
```

### 각 분기 상세

#### `rag` — 가이드라인 기반 AI 답변 (가장 중요)

**조건**: company 인텐트 + 최고 유사도 ≥ 0.65

1. 유사도 ≥ 0.65인 FAQ를 최대 3개 선택
2. 각 FAQ의 `guideline`(답변 가이드라인)과 `reference`(참고 자료)를 LLM에 전달
3. Gemini가 가이드라인을 바탕으로 자연스러운 답변 생성
4. 유사도 ≥ 0.95면 답변을 30분간 캐시

```
사용자: "refund policy"
  ↓
검색 결과:
  FAQ #12 "What is your refund policy?" (similarity: 0.92)
  FAQ #8  "Can I cancel my booking?"     (similarity: 0.71)
  ↓
두 FAQ의 guideline + reference를 Gemini에 전달
  ↓
Gemini가 종합 답변 생성
```

#### `no_match` — 매칭 실패

**조건**: company 인텐트 + 최고 유사도 < 0.65

- 미리 설정된 no-match 메시지 반환
- 유사도 ≥ 0.45인 FAQ가 있으면 **제안 질문** (최대 3개) 함께 반환

```json
{
  "responseTier": "no_match",
  "answer": "I don't have that info in the FAQ...",
  "suggestedQuestions": [
    { "id": 12, "question": "What is your refund policy?" },
    { "id": 8,  "question": "Can I cancel my booking?" }
  ]
}
```

#### `tour_recommend` — 투어 추천

**조건**: tour_recommend 인텐트 + 관련 투어 존재

Gemini가 검색된 투어 정보(이름, 가격, 지역, 평점)를 바탕으로 추천 답변을 생성합니다.

#### `general` — 일반 여행 정보

**조건**: travel 인텐트, 또는 tour_recommend인데 투어가 없을 때

한국 여행 일반 정보(교통, 날씨, 음식 등)에 대해 Gemini가 답변합니다.

---

## Step 4: 로그 저장 + 응답 반환

### 로그 저장 (`faq_chat_logs` 테이블)

모든 채팅은 DB에 기록됩니다:

| 필드 | 설명 |
|------|------|
| `message` | 사용자 원문 질문 |
| `answer` | 생성된 답변 |
| `matched_faq_ids` | 매칭된 FAQ ID 배열 |
| `matched_similarities` | 각 FAQ의 유사도 점수 |
| `top_similarity` | 최고 유사도 |
| `no_match` | 매칭 실패 여부 |
| `response_tier` | 응답 분기 (rag/no_match/general/tour_recommend) |
| `visitor_id` | 방문자 식별자 (선택) |

### 부가 처리 (비동기)

- 매칭된 FAQ의 `viewCount` 1 증가 (fire-and-forget)

### 최종 응답 구조

```json
{
  "answer": "Our refund policy allows...",
  "sources": [
    { "id": 12, "question": "What is your refund policy?" }
  ],
  "noMatch": false,
  "responseTier": "rag",
  "suggestedQuestions": null,
  "tourRecommendations": null,
  "chatLogId": 456
}
```

---

## 유사도 임계값 정리

**파일**: `src/modules/faq/faq.constants.ts`

| 상수 | 값 | 용도 |
|------|-----|------|
| `DIRECT_THRESHOLD` | 0.65 | 이 이상이면 RAG 답변 생성 |
| `SUGGESTION_THRESHOLD` | 0.45 | 이 이상이면 제안 질문으로 표시 |
| `SOURCE_FILTER` | 0.40 | 이 이상이면 응답에 source로 포함 |
| `TOUR_SEARCH` | 0.45 | 투어 벡터 검색 최소 유사도 |
| `MIN_SEARCH` | 0.35 | searchSimilar 기본 최소값 |

---

## API 엔드포인트

```
POST /faq/chat
```

- **인증**: 불필요 (`@Public()`)
- **Rate Limit**: 15회/분 (`@Throttle`)
- **Request Body**:

```json
{
  "message": "What is your refund policy?",
  "history": [
    { "role": "user", "content": "이전 질문" },
    { "role": "assistant", "content": "이전 답변" }
  ],
  "visitorId": "uuid (선택)"
}
```

| 필드 | 필수 | 제한 |
|------|------|------|
| `message` | O | 1~1000자 |
| `history` | X | 최대 10턴 |
| `visitorId` | X | UUID 형식 |

---

## 관련 파일 목록

| 파일 | 역할 |
|------|------|
| `src/modules/faq/faq.controller.ts` | API 라우팅, DTO 검증 |
| `src/modules/faq/faq-chat.service.ts` | 챗봇 핵심 로직 (의도 분류, 분기, LLM 호출) |
| `src/modules/faq/faq-embedding.service.ts` | 임베딩 생성/저장, 하이브리드 검색 (Vector+BM25+RRF) |
| `src/modules/faq/faq.constants.ts` | 임계값, 배치 크기 등 상수 |
| `src/modules/ai/core/embedding.service.ts` | Gemini Embedding API 호출 |
| `src/modules/ai/core/gemini-core.service.ts` | Gemini LLM API 호출 |
| `src/modules/ai-prompt/prompt-registry.ts` | 프롬프트 템플릿 키 등록 |
| `src/modules/ai-prompt/ai-prompt.service.ts` | DB 프롬프트 로드, 변수 치환 |

---

## DB 테이블

| 테이블 | 역할 |
|--------|------|
| `faqs` | FAQ 원본 (question, guideline, reference, tags) |
| `faq_question_embeddings` | FAQ별 멀티벡터 임베딩 (primary, primary_ko, alternative_N) |
| `faq_chat_logs` | 채팅 로그 (질문, 답변, 매칭 정보, 피드백) |
| `odk_tours` | 투어 상품 (이름, 가격, 임베딩) |
| `ai_prompt_templates` | AI 프롬프트 템플릿 |
| `ai_generation_configs` | no-match 응답 등 챗봇 설정 |

### `faq_question_embeddings` 인덱스

| 인덱스 | 타입 | 용도 |
|--------|------|------|
| HNSW (`embedding` 컬럼) | 벡터 근사 최근접 이웃 | 벡터 유사도 검색 |
| GIN (`to_tsvector('english', question)`) | 역인덱스 | BM25 키워드 검색 |
