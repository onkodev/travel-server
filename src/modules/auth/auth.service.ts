import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../../supabase/supabase.service';

@Injectable()
export class AuthService {
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

    return {
      user: data.user,
      session: data.session,
    };
  }

  // 회원가입
  async signUp(email: string, password: string, username: string) {
    const authClient = this.supabaseService.getAuthClient();

    // 1. Supabase Auth로 계정 생성
    const { data: authData, error: authError } = await authClient.auth.signUp({
      email,
      password,
    });

    if (authError) {
      throw new UnauthorizedException(authError.message);
    }

    // 2. users 테이블에 프로필 생성
    if (authData.user) {
      const { error: profileError } = await authClient.from('users').insert({
        id: authData.user.id,
        username,
        name: username,
      });

      if (profileError) {
        console.error('프로필 생성 실패:', profileError);
      }
    }

    return {
      user: authData.user,
      session: authData.session,
    };
  }

  // 로그아웃
  async signOut(token: string) {
    // Supabase에서는 클라이언트 측에서 세션을 삭제하면 됨
    // 서버에서는 특별한 처리가 필요 없음
    return { success: true };
  }

  // 현재 사용자 정보 조회
  async getMe(userId: string) {
    const profile = await this.supabaseService.getUserProfile(userId);
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
    const authClient = this.supabaseService.getAuthClient();

    const { data, error } = await authClient.auth.signInWithOAuth({
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
    const authClient = this.supabaseService.getAuthClient();

    const { data, error } = await authClient.auth.exchangeCodeForSession(code);

    if (error) {
      throw new UnauthorizedException(error.message);
    }

    // users 테이블에 프로필이 없으면 생성
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
          provider: 'google',
        });
      }
    }

    return {
      user: data.user,
      session: data.session,
    };
  }

  // 비밀번호 재설정 이메일 발송
  async forgotPassword(email: string, redirectTo: string) {
    const authClient = this.supabaseService.getAuthClient();

    const { error } = await authClient.auth.resetPasswordForEmail(email, {
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
  async updateProfile(userId: string, data: { name?: string; phone?: string }) {
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

    // 업데이트된 프로필 반환
    return this.getMe(userId);
  }

  // 비밀번호 변경 (로그인된 사용자)
  async updatePassword(userId: string, newPassword: string) {
    const authClient = this.supabaseService.getAuthClient();

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
    const authClient = this.supabaseService.getAuthClient();

    const { error } = await authClient.auth.resend({
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
}
