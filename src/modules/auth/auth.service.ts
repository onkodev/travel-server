import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../../supabase/supabase.service';
import { supabaseProfileToCamelCase } from '../../common/utils';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private supabaseService: SupabaseService,
    private configService: ConfigService,
  ) {}

  // 이메일/비밀번호 로그인 (Supabase Auth 프로젝트 사용)
  async signIn(email: string, password: string) {
    const { data, error } = await this.supabaseService
      .getAuthClient()
      .auth.signInWithPassword({
        email,
        password,
      });

    if (error) {
      throw new UnauthorizedException(error.message);
    }

    // 이메일 인증 안 된 경우
    if (data.user && !data.user.email_confirmed_at) {
      throw new UnauthorizedException({
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Please verify your email before signing in.',
        email: data.user.email,
      });
    }

    // users 테이블 업데이트: last_login_at, email_verified 동기화
    const authClient = this.supabaseService.getAuthClient();
    await authClient
      .from('users')
      .update({
        last_login_at: new Date().toISOString(),
        email_verified: !!data.user.email_confirmed_at,
      })
      .eq('id', data.user.id);

    // 캐시 무효화 (업데이트된 값 반영)
    this.supabaseService.invalidateProfileCache(data.user.id);

    // users 테이블에서 프로필 조회 (role 포함)
    const profile = await this.getMe(data.user.id, data.user);

    return {
      user: profile || data.user,
      session: data.session,
    };
  }

  // 회원가입
  async signUp(
    email: string,
    password: string,
    username: string,
    redirectTo?: string,
  ) {
    // Anon Client 사용 (이메일 발송 O)
    const anonClient = this.supabaseService.getAuthAnonClient();
    const authClient = this.supabaseService.getAuthClient();

    // 1. Supabase Auth로 계정 생성 (Anon Key로 호출해야 이메일 발송됨)
    const { data: authData, error: authError } = await anonClient.auth.signUp({
      email,
      password,
      options: redirectTo ? { emailRedirectTo: redirectTo } : undefined,
    });

    if (authError) {
      throw new UnauthorizedException(authError.message);
    }

    // 2. users 테이블에 프로필 생성
    if (authData.user) {
      const { error: profileError } = await authClient.from('users').insert({
        id: authData.user.id,
        email: authData.user.email,
        name: username,
        email_verified: false, // 회원가입 시 이메일 미인증 상태
      });

      if (profileError) {
        this.logger.error('프로필 생성 실패:', profileError);
      }
    }

    return {
      user: authData.user,
      session: authData.session,
    };
  }

  // 매직링크 로그인
  async sendMagicLink(email: string, redirectTo?: string) {
    const anonClient = this.supabaseService.getAuthAnonClient();

    const { error } = await anonClient.auth.signInWithOtp({
      email,
      options: redirectTo ? { emailRedirectTo: redirectTo } : undefined,
    });

    if (error) {
      throw new BadRequestException(error.message);
    }

    return {
      success: true,
      message: '매직링크가 이메일로 발송되었습니다.',
    };
  }

  // 로그아웃
  async signOut(token: string) {
    try {
      // 1. 토큰에서 사용자 정보 가져오기
      const user = await this.supabaseService.getUserFromToken(token);

      if (user) {
        // 2. Supabase Admin API로 사용자의 모든 세션 종료
        const authClient = this.supabaseService.getAuthClient();
        await authClient.auth.admin.signOut(user.id, 'global');

        // 3. 프로필 캐시도 무효화
        this.supabaseService.invalidateProfileCache(user.id);
      }

      // 4. 서버 캐시에서 토큰 무효화
      this.supabaseService.invalidateTokenCache(token);

      return { success: true };
    } catch (error) {
      // 로그아웃 실패해도 클라이언트 측에서는 토큰 삭제됨
      this.logger.error('로그아웃 처리 중 오류:', error);
      return { success: true };
    }
  }

  // 현재 사용자 정보 조회 (프로필 없으면 자동 생성)
  async getMe(
    userId: string,
    authUser?: {
      email?: string;
      user_metadata?: { full_name?: string; avatar_url?: string };
    },
  ) {
    let profile = await this.supabaseService.getUserProfile(userId);

    // 프로필이 없으면 자동 생성 (OAuth 로그인 시 발생 가능)
    if (!profile && authUser) {
      const authClient = this.supabaseService.getAuthClient();

      const { error: insertError } = await authClient.from('users').insert({
        id: userId,
        email: authUser.email,
        name:
          authUser.user_metadata?.full_name || authUser.email?.split('@')[0],
        avatar_url: authUser.user_metadata?.avatar_url,
      });

      if (!insertError) {
        // 캐시 무효화 후 새로 생성된 프로필 조회
        this.supabaseService.invalidateProfileCache(userId);
        profile = await this.supabaseService.getUserProfile(userId);
      }
    }

    // snake_case → camelCase 변환
    if (profile) {
      return supabaseProfileToCamelCase(profile);
    }

    return profile;
  }

  // 토큰 갱신
  async refreshToken(refreshToken: string) {
    const { data, error } = await this.supabaseService
      .getAuthClient()
      .auth.refreshSession({ refresh_token: refreshToken });

    if (error) {
      throw new UnauthorizedException('토큰 갱신 실패');
    }

    return {
      session: data.session,
    };
  }

  // 이메일 중복 체크
  async checkEmail(email: string) {
    const authClient = this.supabaseService.getAuthClient();

    const { data, error } = await authClient
      .from('users')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (error) {
      throw new BadRequestException(error.message);
    }

    return {
      available: !data,
      email,
    };
  }

  // Google OAuth URL 생성
  async getGoogleOAuthUrl(redirectTo: string) {
    // Anon Client 사용 (OAuth는 Anon Key로 호출해야 함)
    const anonClient = this.supabaseService.getAuthAnonClient();

    const { data, error } = await anonClient.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        skipBrowserRedirect: true,
      },
    });

    if (error) {
      throw new BadRequestException(error.message);
    }

    return {
      url: data.url,
    };
  }

  // Google OAuth 콜백 처리 (code로 세션 교환)
  async handleGoogleCallback(code: string) {
    // Anon Client로 code 교환 (OAuth 흐름)
    const anonClient = this.supabaseService.getAuthAnonClient();
    const authClient = this.supabaseService.getAuthClient();

    const { data, error } = await anonClient.auth.exchangeCodeForSession(code);

    if (error) {
      throw new UnauthorizedException(error.message);
    }

    // users 테이블에 프로필이 없으면 생성, 있으면 로그인 시간 업데이트
    if (data.user) {
      const { data: existingUser } = await authClient
        .from('users')
        .select('id')
        .eq('id', data.user.id)
        .maybeSingle();

      if (!existingUser) {
        await authClient.from('users').insert({
          id: data.user.id,
          email: data.user.email,
          name:
            data.user.user_metadata?.full_name ||
            data.user.email?.split('@')[0],
          avatar_url: data.user.user_metadata?.avatar_url,
          email_verified: !!data.user.email_confirmed_at,
          last_login_at: new Date().toISOString(),
        });
      } else {
        // 기존 사용자: 로그인 시간 및 이메일 인증 상태 업데이트
        await authClient
          .from('users')
          .update({
            last_login_at: new Date().toISOString(),
            email_verified: !!data.user.email_confirmed_at,
          })
          .eq('id', data.user.id);

        // 캐시 무효화
        this.supabaseService.invalidateProfileCache(data.user.id);
      }
    }

    return {
      user: data.user,
      session: data.session,
    };
  }

  // 비밀번호 재설정 이메일 발송
  async forgotPassword(email: string, redirectTo: string) {
    // Anon Client 사용 (이메일 발송 필요)
    const anonClient = this.supabaseService.getAuthAnonClient();

    const { error } = await anonClient.auth.resetPasswordForEmail(email, {
      redirectTo,
    });

    if (error) {
      throw new BadRequestException(error.message);
    }

    return {
      success: true,
      message: '비밀번호 재설정 이메일이 발송되었습니다.',
    };
  }

  // 비밀번호 재설정 (토큰으로)
  async resetPassword(accessToken: string, newPassword: string) {
    const authClient = this.supabaseService.getAuthClient();

    // 토큰으로 사용자 검증 후 비밀번호 변경
    const {
      data: { user },
      error: userError,
    } = await authClient.auth.getUser(accessToken);

    if (userError || !user) {
      throw new UnauthorizedException('유효하지 않은 토큰입니다.');
    }

    const { error } = await authClient.auth.admin.updateUserById(user.id, {
      password: newPassword,
    });

    if (error) {
      throw new BadRequestException(error.message);
    }

    return {
      success: true,
      message: '비밀번호가 변경되었습니다.',
    };
  }

  // 프로필 업데이트
  async updateProfile(
    userId: string,
    data: { name?: string; phone?: string; avatar_url?: string },
  ) {
    const authClient = this.supabaseService.getAuthClient();

    const { error } = await authClient
      .from('users')
      .update({
        ...data,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);

    if (error) {
      throw new BadRequestException(error.message);
    }

    // 캐시 무효화 후 업데이트된 프로필 반환
    this.supabaseService.invalidateProfileCache(userId);
    return this.getMe(userId);
  }

  // 비밀번호 변경 (로그인된 사용자) - 현재 비밀번호 확인 필수
  async updatePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const authClient = this.supabaseService.getAuthClient();

    // 1. 사용자 이메일 조회
    const { data: userData } = await authClient
      .from('users')
      .select('email')
      .eq('id', userId)
      .single();

    if (!userData?.email) {
      throw new BadRequestException('사용자 정보를 찾을 수 없습니다');
    }

    // 2. 현재 비밀번호 확인 (로그인 시도)
    const { error: verifyError } = await authClient.auth.signInWithPassword({
      email: userData.email,
      password: currentPassword,
    });

    if (verifyError) {
      throw new BadRequestException('현재 비밀번호가 일치하지 않습니다');
    }

    // 3. 새 비밀번호로 변경
    const { error } = await authClient.auth.admin.updateUserById(userId, {
      password: newPassword,
    });

    if (error) {
      throw new BadRequestException(error.message);
    }

    return {
      success: true,
      message: '비밀번호가 변경되었습니다.',
    };
  }

  // 이메일 재발송
  async resendVerificationEmail(email: string, redirectTo: string) {
    // Anon Client 사용 (이메일 발송 필요)
    const anonClient = this.supabaseService.getAuthAnonClient();

    const { error } = await anonClient.auth.resend({
      type: 'signup',
      email,
      options: {
        emailRedirectTo: redirectTo,
      },
    });

    if (error) {
      throw new BadRequestException(error.message);
    }

    return {
      success: true,
      message: '인증 이메일이 재발송되었습니다.',
    };
  }

  // 로그인 시간 동기화 (OAuth implicit flow용)
  async syncLogin(userId: string, emailConfirmedAt?: string | null) {
    const authClient = this.supabaseService.getAuthClient();

    await authClient
      .from('users')
      .update({
        last_login_at: new Date().toISOString(),
        email_verified: !!emailConfirmedAt,
      })
      .eq('id', userId);

    // 캐시 무효화
    this.supabaseService.invalidateProfileCache(userId);

    return { success: true };
  }
}
