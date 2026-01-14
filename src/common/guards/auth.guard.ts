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

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('인증 토큰이 필요합니다');
    }

    const token = authHeader.split(' ')[1];
    const user = await this.supabaseService.getUserFromToken(token);

    if (!user) {
      throw new UnauthorizedException('유효하지 않은 토큰입니다');
    }

    // 프로필은 비동기로 가져오되, 기본 사용자 정보만으로 먼저 진행
    // 프로필이 필요한 엔드포인트에서만 별도로 조회
    request.user = user;

    // 프로필을 비동기로 미리 캐싱 (응답을 기다리지 않음)
    this.supabaseService.getUserProfile(user.id).catch(() => {});

    return true;
  }
}
