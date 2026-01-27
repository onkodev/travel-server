/**
 * 공통 타입 정의
 */

// ============================================================================
// Supabase 관련 타입
// ============================================================================

/**
 * Supabase 에러 타입
 */
export interface SupabaseError {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
  stack?: string;
}

/**
 * Supabase 에러인지 확인하는 타입 가드
 */
export function isSupabaseError(error: unknown): error is SupabaseError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as SupabaseError).message === 'string'
  );
}

// ============================================================================
// 사용자 관련 타입
// ============================================================================

/**
 * 사용자 역할 열거형 (타입 안전 RBAC)
 */
export enum UserRole {
  ADMIN = 'admin',
  AGENT = 'agent',
  USER = 'user',
}

/**
 * 역할 계층 (상위 역할은 하위 역할의 권한 포함)
 * admin > agent > user
 */
export const ROLE_HIERARCHY: Record<UserRole, number> = {
  [UserRole.ADMIN]: 100,
  [UserRole.AGENT]: 50,
  [UserRole.USER]: 10,
};

/**
 * 인증된 사용자 정보 (request.user에 저장)
 */
export interface AuthenticatedUser {
  id: string;
  email?: string;
  role: UserRole;
  [key: string]: unknown;
}

/**
 * 역할 문자열을 UserRole로 변환
 */
export function toUserRole(role: string | null | undefined): UserRole {
  if (role === UserRole.ADMIN) return UserRole.ADMIN;
  if (role === UserRole.AGENT) return UserRole.AGENT;
  return UserRole.USER;
}

/**
 * 사용자 투어 정보 (통계 계산용)
 */
export interface UserTourData {
  id: number;
  userId: string;
  tourId: number;
  tours?: {
    regionId?: string;
    tags?: string[];
  };
}

/**
 * 리뷰 정보 (통계 계산용)
 */
export interface ReviewData {
  id: number;
  userId: string;
  rating: number;
}

// ============================================================================
// 견적 아이템 관련 타입
// ============================================================================

/**
 * 아이템 정보 (견적 아이템에 포함되는 상세 정보)
 */
export interface EstimateItemInfo {
  nameKor?: string;
  nameEng?: string;
  descriptionEng?: string;
  images?: Array<{ url: string; alt?: string }>;
  lat?: number;
  lng?: number;
  addressEnglish?: string;
}

/**
 * 견적 아이템 타입
 */
export interface EstimateItem {
  id: string;
  type: string;
  itemId?: number;
  itemName?: string;
  name?: string;
  nameEng?: string;
  quantity?: number;
  unitPrice?: number;
  subtotal?: number;
  dayNumber: number;
  orderIndex: number;
  isTbd?: boolean;
  note?: string;
  itemInfo?: EstimateItemInfo;
}

// ============================================================================
// 캐시 관련 타입
// ============================================================================

/**
 * 캐시 엔트리
 */
export interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

// ============================================================================
// 유틸리티 타입
// ============================================================================

/**
 * Record 타입 확인 타입 가드
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Prisma Decimal 타입 (toNumber 메서드를 가진 객체)
 */
export interface PrismaDecimal {
  toNumber(): number;
}

/**
 * Prisma Decimal인지 확인하는 타입 가드
 */
export function isPrismaDecimal(value: unknown): value is PrismaDecimal {
  return (
    typeof value === 'object' &&
    value !== null &&
    'toNumber' in value &&
    typeof (value as PrismaDecimal).toNumber === 'function'
  );
}
