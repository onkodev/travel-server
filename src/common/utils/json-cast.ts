/**
 * Prisma JSON 필드를 타입 안전하게 캐스팅하는 유틸리티.
 * 런타임 검증 없이 타입 어서션만 수행 (as unknown as 패턴 대체).
 * 향후 Zod 등 런타임 검증 추가 가능.
 */
export function jsonCast<T>(value: unknown): T {
  return value as T;
}
