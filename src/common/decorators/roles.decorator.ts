import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/**
 * 역할 기반 접근 제어 데코레이터
 * @param roles 허용할 역할 목록 ('admin', 'agent', 'user')
 *
 * @example
 * // Admin만 접근 가능
 * @Roles('admin')
 *
 * // Admin 또는 Agent 접근 가능
 * @Roles('admin', 'agent')
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
