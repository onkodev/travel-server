import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedUser } from '../types';

/**
 * 사용자 정보 추출 데코레이터
 *
 * @example
 * // 전체 사용자 객체
 * @CurrentUser() user: AuthenticatedUser
 *
 * // 특정 필드만
 * @CurrentUser('id') userId: string
 * @CurrentUser('role') role: UserRole
 * @CurrentUser('email') email: string | undefined
 */
export const CurrentUser = createParamDecorator(
  <K extends keyof AuthenticatedUser>(
    data: K | undefined,
    ctx: ExecutionContext,
  ): AuthenticatedUser | AuthenticatedUser[K] | undefined => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser | undefined;

    if (data) {
      return user?.[data];
    }

    return user;
  },
);
