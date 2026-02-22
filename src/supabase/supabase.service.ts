import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient, User } from '@supabase/supabase-js';
import { CACHE_TTL } from '../common/constants/cache';
import { MemoryCache } from '../common/utils/memory-cache';

// 사용자 프로필 타입
interface UserProfile {
  id: string;
  email: string;
  name?: string;
  phone?: string;
  avatar_url?: string;
  role?: 'user' | 'admin' | 'agent';
  is_active?: boolean;
  email_verified?: boolean;
  last_login_at?: string;
  created_at?: string;
  updated_at?: string;
}

@Injectable()
export class SupabaseService {
  private authClient: SupabaseClient;
  private authAnonClient: SupabaseClient; // signUp용 (이메일 발송 O)
  private adminClient: SupabaseClient;

  // 토큰 검증 캐시 & 프로필 캐시 (MemoryCache로 통합)
  private tokenCache = new MemoryCache(CACHE_TTL.TOKEN, 100);
  private profileCache = new MemoryCache(CACHE_TTL.PROFILE, 100);

  constructor(private configService: ConfigService) {
    // AUTH Supabase Client (tumakrguide - 인증용, Service Key)
    this.authClient = createClient(
      this.configService.get<string>('SUPABASE_AUTH_URL') || '',
      this.configService.get<string>('SUPABASE_AUTH_SERVICE_KEY') || '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );

    // AUTH Anon Client (signUp용 - 이메일 발송 O)
    this.authAnonClient = createClient(
      this.configService.get<string>('SUPABASE_AUTH_URL') || '',
      this.configService.get<string>('SUPABASE_AUTH_ANON_KEY') || '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );

    // ADMIN Supabase Client (데이터용 - RLS 우회)
    this.adminClient = createClient(
      this.configService.get<string>('SUPABASE_ADMIN_URL') || '',
      this.configService.get<string>('SUPABASE_ADMIN_SERVICE_KEY') || '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );
  }

  // AUTH 클라이언트 (인증 관련 - Service Key)
  getAuthClient(): SupabaseClient {
    return this.authClient;
  }

  // AUTH Anon 클라이언트 (signUp용 - 이메일 발송)
  getAuthAnonClient(): SupabaseClient {
    return this.authAnonClient;
  }

  // ADMIN 클라이언트 (데이터 관련)
  getAdminClient(): SupabaseClient {
    return this.adminClient;
  }

  // JWT 토큰으로 사용자 정보 가져오기 (캐싱 적용)
  async getUserFromToken(token: string): Promise<User | null> {
    const cached = this.tokenCache.get<User | null>(token);
    if (cached !== null) return cached;

    const {
      data: { user },
      error,
    } = await this.authClient.auth.getUser(token);

    const result = error ? null : user;
    this.tokenCache.set(token, result);

    return result;
  }

  // 사용자 프로필 조회 (캐싱 적용)
  async getUserProfile(userId: string) {
    const cached = this.profileCache.get<UserProfile>(userId);
    if (cached !== null) return cached;

    const { data, error } = await this.authClient
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    const result = error ? null : data;
    this.profileCache.set(userId, result);

    return result;
  }

  // 캐시 무효화 (프로필 업데이트 시 호출)
  invalidateProfileCache(userId: string) {
    this.profileCache.delete(userId);
  }

  // 토큰 캐시 무효화 (로그아웃 시 호출)
  invalidateTokenCache(token: string) {
    this.tokenCache.delete(token);
  }
}
