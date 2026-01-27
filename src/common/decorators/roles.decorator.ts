import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../types';

export const ROLES_KEY = 'roles';

/**
 * 역할 기반 접근 제어 데코레이터
 * @param roles 허용할 역할 목록 (UserRole enum 사용)
 *
 * @example
 * // Admin만 접근 가능
 * @Roles(UserRole.ADMIN)
 *
 * // Admin 또는 Agent 접근 가능
 * @Roles(UserRole.ADMIN, UserRole.AGENT)
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
