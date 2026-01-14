import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SupabaseService } from '../../supabase/supabase.service';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private supabaseService: SupabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // @Roles() 데코레이터에서 필요한 역할 가져오기
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
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

    // 프로필에서 역할 가져오기
    const profile = await this.supabaseService.getUserProfile(user.id);
    const userRole = profile?.role || 'user';

    // request에 역할 정보 추가 (컨트롤러에서 사용 가능)
    request.userRole = userRole;

    // 역할 확인
    const hasRole = requiredRoles.includes(userRole);

    if (!hasRole) {
      throw new ForbiddenException(
        `이 작업을 수행할 권한이 없습니다. 필요한 역할: ${requiredRoles.join(', ')}`,
      );
    }

    return true;
  }
}
