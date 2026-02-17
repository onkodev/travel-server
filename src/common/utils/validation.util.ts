/**
 * UUID 형식 검증
 */
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isValidUUID = (str: string): boolean => UUID_REGEX.test(str);

/**
 * 검색어 길이 제한 (DoS 방지)
 */
const MAX_SEARCH_LENGTH = 100;

export function sanitizeSearch(search: string | undefined): string | undefined {
  if (!search) return undefined;
  return search
    .trim()
    .slice(0, MAX_SEARCH_LENGTH)
    .replace(/[\\%_]/g, '\\$&');
}

/**
 * Supabase .or() 쿼리용 검색어 이스케이프
 * PostgREST ilike 필터에서 특수문자 이스케이프
 */
export function sanitizeSupabaseSearch(search: string | undefined): string | undefined {
  if (!search) return undefined;
  return search
    .trim()
    .slice(0, MAX_SEARCH_LENGTH)
    // PostgREST 필터 구문에서 특수문자 제거
    .replace(/[\\%_().,"']/g, '');
}
