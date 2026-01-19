import {
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';

/**
 * 로그인 필수 파라미터 데코레이터
 * 사용자 ID를 추출하고, 없으면 ForbiddenException을 던집니다.
 *
 * @example
 * // 사용 전 (중복 코드)
 * async updateStep7(@CurrentUser('id') userId: string) {
 *   if (!userId) {
 *     throw new ForbiddenException('로그인이 필요합니다.');
 *   }
 *   // ...
 * }
 *
 * // 사용 후 (간결)
 * async updateStep7(@RequireUserId() userId: string) {
 *   // userId가 보장됨
 *   // ...
 * }
 */
export const RequireUserId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    const userId = request.user?.id;

    if (!userId) {
      throw new ForbiddenException(
        '로그인이 필요합니다. Please sign in to continue.',
      );
    }

    return userId;
  },
);
