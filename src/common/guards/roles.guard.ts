import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { UserRole, ROLE_HIERARCHY, toUserRole } from '../types';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // @Public() 데코레이터가 있으면 접근 허용
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    // @Roles() 데코레이터에서 필요한 역할 가져오기
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // @Roles() 데코레이터가 없으면 접근 허용
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // 인증되지 않은 경우 (AuthGuard 이후에 실행되므로 보통 발생하지 않음)
    if (!user) {
      throw new ForbiddenException('인증이 필요합니다');
    }

    // AuthGuard에서 이미 설정한 role 사용 (중복 DB 조회 제거)
    const userRole = toUserRole(user.role);
    const userRoleLevel = ROLE_HIERARCHY[userRole];

    // 역할 계층 확인: 상위 역할은 하위 역할의 권한 포함
    // 예: admin은 agent, user 권한도 가짐
    const hasRole = requiredRoles.some(
      (role) => userRoleLevel >= ROLE_HIERARCHY[role],
    );

    if (!hasRole) {
      throw new ForbiddenException('이 작업을 수행할 권한이 없습니다.');
    }

    return true;
  }
}
