import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SupabaseService } from '../../supabase/supabase.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { toUserRole, AuthenticatedUser } from '../types';

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

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
    const token = this.extractToken(request);

    // Public 라우트: 토큰이 있으면 사용자 정보 추출 시도 (실패해도 허용)
    if (isPublic) {
      if (token) {
        try {
          const user = await this.supabaseService.getUserFromToken(token);
          if (user) {
            const profile = await this.supabaseService.getUserProfile(user.id);
            request.user = {
              ...user,
              role: toUserRole(profile?.role),
            } as AuthenticatedUser;
          }
        } catch (error) {
          // Public 라우트에서는 토큰 검증 실패해도 무시하되 로깅
          if (error instanceof Error && !error.message?.includes('invalid')) {
            this.logger.warn(`Token verification failed: ${error.message}`);
          }
        }
      }
      return true;
    }

    if (!token) {
      throw new UnauthorizedException('인증 토큰이 필요합니다');
    }
    const user = await this.supabaseService.getUserFromToken(token);

    if (!user) {
      throw new UnauthorizedException('유효하지 않은 토큰입니다');
    }

    // 프로필에서 role 정보 가져오기
    const profile = await this.supabaseService.getUserProfile(user.id);

    if (!profile) {
      this.logger.warn(`프로필 없는 사용자 접근: ${user.id}`);
    }

    // 사용자 정보에 role 포함 (타입 안전)
    request.user = {
      ...user,
      role: toUserRole(profile?.role),
    } as AuthenticatedUser;

    return true;
  }

  /**
   * 토큰 추출 (우선순위: Authorization 헤더 > 쿠키 > query parameter)
   *
   * EventSource(SSE)는 커스텀 헤더를 보낼 수 없고,
   * cross-origin에서는 SameSite=Lax 쿠키도 전송되지 않으므로
   * query parameter ?token= 폴백이 SSE/WebSocket 인증의 표준 패턴.
   */
  private extractToken(request: any): string | null {
    // 1. Authorization: Bearer 헤더 (일반 API 호출)
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.split(' ')[1];
    }

    // 2. 쿠키 (same-origin 요청)
    const cookies =
      request.cookies || this.parseCookieHeader(request.headers.cookie);
    if (cookies?.access_token) return cookies.access_token;

    // 3. Query parameter (SSE EventSource — cross-origin 인증용)
    if (request.query?.token) return request.query.token as string;

    return null;
  }

  private parseCookieHeader(
    cookieHeader?: string,
  ): Record<string, string> | null {
    if (!cookieHeader) return null;
    const cookies: Record<string, string> = {};
    for (const pair of cookieHeader.split(';')) {
      const [key, ...rest] = pair.trim().split('=');
      if (key) cookies[key] = rest.join('=');
    }
    return cookies;
  }
}
