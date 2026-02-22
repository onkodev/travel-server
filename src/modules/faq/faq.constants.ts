// ============================================================================
// FAQ Constants — 매직 넘버 중앙 관리
// ============================================================================

/**
 * 유사도 임계값 (cosine similarity thresholds)
 */
export const FAQ_SIMILARITY = {
  /** FAQ 직접 답변 임계값 */
  DIRECT_THRESHOLD: 0.75,
  /** 제안 질문 최소 유사도 */
  SUGGESTION_THRESHOLD: 0.45,
  /** 소스 필터 최소 유사도 (chatWithFaq, regenerateAnswer) */
  SOURCE_FILTER: 0.4,
  /** 투어 검색 최소 유사도 */
  TOUR_SEARCH: 0.45,
  /** searchSimilar 기본 최소 유사도 */
  MIN_SEARCH: 0.35,
  /** 카테고리 분류 저신뢰도 임계값 */
  LOW_CONFIDENCE: 0.3,
} as const;

/**
 * 배치 처리 크기
 */
export const FAQ_BATCH = {
  /** 임베딩 배치 크기 (regenerateAll, backfill) */
  EMBEDDING: 100,
  /** 임베딩 동시 처리 수 */
  EMBEDDING_CONCURRENCY: 5,
  /** Gemini 리뷰 청크 크기 */
  GEMINI_REVIEW_CHUNK: 25,
  /** 임베딩 backfill 배치 크기 */
  BACKFILL: 100,
  /** Gemini 카테고리 분류 배치 크기 */
  GEMINI_CATEGORIZE: 50,
  /** 중복 스캔 배치 크기 */
  DUPLICATE_SCAN: 500,
} as const;

/**
 * 대화 이력을 Gemini history 형식으로 변환
 */
export function toGeminiHistory(
  history?: Array<{ role: 'user' | 'assistant'; content: string }>,
): Array<{ role: string; parts: Array<{ text: string }> }> | undefined {
  return history?.map((h) => ({
    role: h.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: h.content }],
  }));
}
