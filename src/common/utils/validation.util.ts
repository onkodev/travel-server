/**
 * UUID 형식 검증
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isValidUUID = (str: string): boolean => UUID_REGEX.test(str);

/**
 * 검색어 길이 제한 (DoS 방지)
 */
const MAX_SEARCH_LENGTH = 100;

export function sanitizeSearch(search: string | undefined): string | undefined {
  if (!search) return undefined;
  return search.trim().slice(0, MAX_SEARCH_LENGTH);
}
