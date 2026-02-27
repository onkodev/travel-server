/**
 * 날짜 관련 유틸리티 함수
 */

/**
 * 문자열을 ISO-8601 DateTime으로 변환
 * - null/undefined → null
 * - "2026-01-15T00:00:00.000Z" → Date 객체
 * - "2026-01-15" → Date 객체 (00:00:00.000Z 추가)
 */
export function toDateTime(dateStr: Date | string | null | undefined): Date | null {
  if (!dateStr) return null;
  if (dateStr instanceof Date) return dateStr;
  // 이미 ISO-8601 형식이면 그대로 파싱
  if (dateStr.includes('T')) return new Date(dateStr);
  // YYYY-MM-DD 형식이면 시간 추가
  return new Date(`${dateStr}T00:00:00.000Z`);
}

/**
 * 한국어 날짜 문자열 반환 (예: "2026. 2. 26.")
 * - toLocaleString('ko-KR') 패턴 통일
 */
export function formatDateKR(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('ko-KR');
}

/**
 * 한국어 날짜+시간 문자열 반환 (예: "2026. 2. 26. 오후 3:00:00")
 * - toLocaleString('ko-KR') 패턴 통일
 */
export function formatDateTimeKR(date?: Date | string): string {
  const d = date ? (typeof date === 'string' ? new Date(date) : date) : new Date();
  return d.toLocaleString('ko-KR');
}

/**
 * KST 기준 YYYY-MM-DD 문자열 반환
 * - toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }) 패턴 통일
 */
export function formatDateKST(date?: Date): string {
  const d = date ?? new Date();
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}

/**
 * ISO 날짜 문자열 반환 (YYYY-MM-DD)
 * - toISOString().split('T')[0] 패턴 통일
 */
export function formatDateISO(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toISOString().split('T')[0];
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
