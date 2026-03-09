# AI 견적 생성 개선 계획

> 작성일: 2026-03-09
> 상태: 구현 예정

## 현재 문제점

현재 견적 생성(`ai-estimate.service.ts`)은 **Gemini 단독 판단** 구조임:
1. Email RAG로 유사 이메일/견적 검색
2. DB 장소 목록 로드
3. 이 데이터를 프롬프트에 넣어서 Gemini가 일정 전체를 생성
4. Gemini가 뱉은 장소명을 DB에서 매칭 (4-tier: geminiId → exact → partial → fuzzy)

**문제:** 여행사의 운영 노하우(동선, 시간 배분, 고객 유형별 패턴)가 코드에 없음. Gemini 품질에 전적으로 의존.

---

## 개선안 1: 템플릿 기반 일정 생성 (핵심)

### 개념
- 어드민이 검증된 일정 템플릿을 미리 등록 (region, duration, interests 조건 태그 포함)
- 고객 설문 완료 시 **서버가 조건 매칭**으로 템플릿 자동 선택 (LLM 불필요)
- 템플릿의 각 slot에 맞는 구체적 장소를 DB에서 채움
- 매칭 템플릿 0개면 기존 RAG 방식 폴백

### DB 스키마 (예시)

```sql
-- 일정 템플릿
CREATE TABLE itinerary_templates (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,           -- "서울 3일 문화+맛집 첫방문"
  region VARCHAR(50) NOT NULL,          -- "seoul"
  duration INT NOT NULL,                -- 3
  tour_type VARCHAR(50),                -- "private"
  interest_tags TEXT[] DEFAULT '{}',    -- ["culture", "food"]
  is_first_visit BOOLEAN,              -- true
  budget_range VARCHAR(50),            -- "mid"
  priority INT DEFAULT 0,             -- 높을수록 우선
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 템플릿 슬롯 (일정 뼈대)
CREATE TABLE template_slots (
  id SERIAL PRIMARY KEY,
  template_id INT REFERENCES itinerary_templates(id) ON DELETE CASCADE,
  day_number INT NOT NULL,
  order_index INT NOT NULL,
  time_of_day VARCHAR(20),             -- "Morning", "Lunch", "Afternoon", "Dinner"
  category VARCHAR(50),                -- "palace", "food", "culture", "nature"
  area_cluster VARCHAR(100),           -- "종로", "강남", "명동"
  fixed_item_id INT REFERENCES items(id), -- NULL이면 자동 선택, 값 있으면 고정
  note TEXT,                           -- "시장은 오전 10시 이후"
  UNIQUE(template_id, day_number, order_index)
);
```

### 매칭 로직

```typescript
function findBestTemplate(flow: ChatbotFlow): Template | null {
  return templates
    .filter(t => t.region === flow.region)
    .filter(t => t.duration === flow.duration)
    .filter(t => t.isFirstVisit === null || t.isFirstVisit === flow.isFirstVisit)
    .map(t => ({
      template: t,
      score: interestOverlap(t.interestTags, flow.interestMain) * 50
           + (t.tourType === flow.tourType ? 20 : 0)
           + (t.budgetRange === flow.budgetRange ? 15 : 0)
           + t.priority * 10
    }))
    .sort((a, b) => b.score - a.score)
    [0]?.template || null;
}
```

### 슬롯 채우기 로직

```typescript
for (const slot of template.slots) {
  if (slot.fixedItemId) {
    items.push(getItem(slot.fixedItemId));
  } else {
    const candidates = await prisma.item.findMany({
      where: {
        category: 'place',
        aiEnabled: true,
        categories: { hasSome: [slot.category] },
        area: { contains: slot.areaCluster },
        id: { notIn: alreadyUsedIds },
      },
      orderBy: { rating: 'desc' },
      take: 5,
    });
    items.push(pickBest(candidates, flow));  // scoring 또는 LLM
  }
}
```

### 어드민 UI
- 템플릿 CRUD (이름, 조건 태그, 활성화)
- 슬롯 편집 (일차별 타임라인, 드래그앤드롭)
- 고정 장소 지정 (Item 검색 → 선택)
- 미리보기 (시뮬레이션)

---

## 개선안 2: 비즈니스 규칙 엔진

Gemini가 모르는 운영 현실을 코드로 강제:

```typescript
const RULES = [
  // 첫 방문자
  { condition: (flow) => flow.isFirstVisit && flow.region === 'seoul',
    action: 'must_include', targets: ['경복궁'] },

  // 아동 동반
  { condition: (flow) => (flow.childrenCount || 0) > 0,
    action: 'exclude_categories', targets: ['nightlife', 'bar'] },
  { condition: (flow) => (flow.childrenCount || 0) > 0,
    action: 'prefer_categories', targets: ['theme_park', 'aquarium'] },

  // 예산
  { condition: (flow) => flow.budgetRange === 'budget',
    action: 'max_paid_per_day', value: 2 },

  // 시간
  { condition: (slot) => slot.timeOfDay === 'Morning',
    action: 'exclude_categories', targets: ['market'] },  // 시장은 아침에 안 열림
];
```

---

## 개선안 3: 지리적 클러스터링

Item 테이블의 lat/lng 활용하여 동선 최적화:

```typescript
// 장소를 반경 3km 클러스터로 묶기
const clusters = clusterByDistance(dbPlaces, maxDistanceKm: 3);
// 하루 일정 = 1~2개 인접 클러스터 내에서만 선택
// 클러스터 간 이동 순서 최적화 (TSP 근사)
```

---

## 개선안 4: Scoring 기반 장소 선택

```typescript
function scorePlace(item, flow, dayContext) {
  let score = 0;
  score += interestOverlap(item.categories, flow.interestMain) * 30;  // 관심사
  score += proximityScore(item, dayContext.otherPlaces) * 25;          // 지리적 근접
  score += (item.rating || 0) * 10;                                     // 인기도
  score += budgetFit(item.price, flow.budgetRange) * 15;               // 예산
  score -= categoryDuplication(item, dayContext) * 20;                  // 다양성
  return score;
}
```

---

## 개선안 5: 과거 견적 직접 복사 (가장 빠른 적용)

현재 `searchSimilarEstimates`로 과거 견적을 찾지만 프롬프트 참고만 함.
유사도 0.9 이상이면 아이템을 직접 복사하고 사용자 attractions만 반영:

```typescript
if (bestEstimate.similarity >= 0.9) {
  // Gemini 호출 없이 직접 복사
  items = cloneEstimateItems(bestEstimate);
  items = applyUserAttractions(items, flow);
  return items;
}
```

---

## 구현 우선순위

| 순위 | 방안 | 난이도 | 효과 | 비고 |
|:---:|---|:---:|:---:|---|
| 1 | 과거 견적 직접 복사 | 낮음 | 즉시 품질 보장 | 기존 코드 수정만으로 가능 |
| 2 | 비즈니스 규칙 엔진 | 낮음 | 운영 노하우 반영 | 규칙 목록 정리 필요 |
| 3 | 지리적 클러스터링 | 중간 | 동선 현실성 | lat/lng 데이터 품질 확인 필요 |
| 4 | 템플릿 기반 일정 | 중간 | 상품화 가능 | DB 스키마 + 어드민 UI 필요 |
| 5 | Scoring 기반 선택 | 높음 | AI 의존도 최소화 | 가중치 튜닝 필요 |

---

## 관련 파일

- `src/modules/chatbot/ai-estimate.service.ts` — 견적 생성 메인 (1255줄)
- `src/modules/email-rag/email-rag.service.ts` — RAG 파이프라인 (1193줄)
- `src/modules/item/place-matcher.service.ts` — 4-tier 장소 매칭
- `src/modules/ai-prompt/prompt-registry.ts` — EMAIL_RAG_DRAFT 프롬프트
- `src/modules/chatbot/conversational-estimate.service.ts` — Step 7 대화형 수정
