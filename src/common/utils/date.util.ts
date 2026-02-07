/**
 * 날짜 관련 유틸리티 함수
 */

/**
 * 문자열을 ISO-8601 DateTime으로 변환
 * - null/undefined → null
 * - "2026-01-15T00:00:00.000Z" → Date 객체
 * - "2026-01-15" → Date 객체 (00:00:00.000Z 추가)
 */
export function toDateTime(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  // 이미 ISO-8601 형식이면 그대로 파싱
  if (dateStr.includes('T')) return new Date(dateStr);
  // YYYY-MM-DD 형식이면 시간 추가
  return new Date(`${dateStr}T00:00:00.000Z`);
}

/**
 * 객체에서 특정 키들을 제외한 새 객체 반환
 */
export function omit<T extends Record<string, unknown>, K extends keyof T>(
  obj: T,
  keys: K[],
): Omit<T, K> {
  const result = { ...obj };
  keys.forEach((key) => delete result[key]);
  return result;
}
