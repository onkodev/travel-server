import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { Response, Request } from 'express';

@Injectable()
export class NoCacheInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    // 인증된 요청(Authorization 헤더 존재)이거나 쿠키에 세션 토큰이 있다면 동적 데이터로 간주하고 캐시 비활성화
    // 퍼블릭 리스트 조회 등 헤더가 없는 요청은 이 로직을 패스하여 CDN 캐시(Nginx 등)의 혜택을 받음
    const hasAuthToken = !!request.headers['authorization'];
    const hasCookieToken = request.cookies && (request.cookies['sb-access-token'] || Object.keys(request.cookies).some(k => k.includes('supabase')));
    
    // 어드민 전용 도메인/경로이거나 헤더에 토큰이 있을 경우 캐시 무효화
    const isAdminPath = request.path?.includes('/admin/');
    
    if (hasAuthToken || hasCookieToken || isAdminPath) {
      response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      response.setHeader('Pragma', 'no-cache');
      response.setHeader('Expires', '0');
      response.setHeader('Surrogate-Control', 'no-store');
    }

    return next.handle();
  }
}
