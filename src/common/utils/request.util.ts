import type { Request } from 'express';

/**
 * Express 요청에서 클라이언트 IP 주소 추출
 */
export function extractIpAddress(req: Request): string | undefined {
  return (
    (req.headers['x-forwarded-for'] as string)?.split(',')[0] ||
    req.ip ||
    req.socket.remoteAddress ||
    undefined
  );
}

/**
 * 쿼리 파라미터 문자열을 boolean으로 변환
 * 'true' → true, 'false' → false, 나머지 → undefined
 */
export function parseBooleanQuery(value?: string): boolean | undefined {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}
