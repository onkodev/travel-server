import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SupabaseService } from '../../supabase/supabase.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private supabaseService: SupabaseService,
    private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Public 데코레이터가 있으면 인증 스킵
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    // Public 라우트: 토큰이 있으면 사용자 정보 추출 시도 (실패해도 허용)
    if (isPublic) {
      if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
          const token = authHeader.split(' ')[1];
          const user = await this.supabaseService.getUserFromToken(token);
          if (user) {
            const profile = await this.supabaseService.getUserProfile(user.id);
            request.user = {
              ...user,
              role: profile?.role || 'user',
            };
          }
        } catch {
          // Public 라우트에서는 토큰 검증 실패해도 무시
        }
      }
      return true;
    }

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('인증 토큰이 필요합니다');
    }

    const token = authHeader.split(' ')[1];
    const user = await this.supabaseService.getUserFromToken(token);

    if (!user) {
      throw new UnauthorizedException('유효하지 않은 토큰입니다');
    }

    // 프로필에서 role 정보 가져오기
    const profile = await this.supabaseService.getUserProfile(user.id);

    // 사용자 정보에 role 포함
    request.user = {
      ...user,
      role: profile?.role || 'user',
    };

    return true;
  }
}
