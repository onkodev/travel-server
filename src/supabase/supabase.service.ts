import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient, User } from '@supabase/supabase-js';

// 인메모리 캐시 인터페이스
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

@Injectable()
export class SupabaseService {
  private authClient: SupabaseClient;
  private authAnonClient: SupabaseClient; // signUp용 (이메일 발송 O)
  private adminClient: SupabaseClient;

  // 토큰 검증 캐시
  private tokenCache: Map<string, CacheEntry<User | null>> = new Map();
  // 프로필 캐시
  private profileCache: Map<string, CacheEntry<any>> = new Map();

  // 캐시 TTL 설정 (보안을 위해 단축)
  private readonly TOKEN_CACHE_TTL = 1 * 60 * 1000; // 1분 (토큰 검증은 더 짧게)
  private readonly PROFILE_CACHE_TTL = 2 * 60 * 1000; // 2분 (프로필은 조금 더 길게)

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
    const now = Date.now();

    // 캐시 확인 (1분 TTL)
    const cached = this.tokenCache.get(token);
    if (cached && now - cached.timestamp < this.TOKEN_CACHE_TTL) {
      return cached.data;
    }

    // Supabase API 호출
    const {
      data: { user },
      error,
    } = await this.authClient.auth.getUser(token);

    const result = error ? null : user;

    // 캐시 저장
    this.tokenCache.set(token, { data: result, timestamp: now });

    // 오래된 캐시 정리 (100개 초과 시)
    if (this.tokenCache.size > 100) {
      this.cleanupTokenCache();
    }

    return result;
  }

  // 사용자 프로필 조회 (캐싱 적용)
  async getUserProfile(userId: string) {
    const now = Date.now();

    // 캐시 확인 (2분 TTL)
    const cached = this.profileCache.get(userId);
    if (cached && now - cached.timestamp < this.PROFILE_CACHE_TTL) {
      return cached.data;
    }

    // Supabase DB 쿼리
    const { data, error } = await this.authClient
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    const result = error ? null : data;

    // 캐시 저장
    this.profileCache.set(userId, { data: result, timestamp: now });

    // 오래된 캐시 정리
    if (this.profileCache.size > 100) {
      this.cleanupProfileCache();
    }

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

  // 토큰 캐시 정리 (1분 TTL 기준)
  private cleanupTokenCache() {
    const now = Date.now();
    for (const [key, entry] of this.tokenCache.entries()) {
      if (now - entry.timestamp >= this.TOKEN_CACHE_TTL) {
        this.tokenCache.delete(key);
      }
    }
  }

  // 프로필 캐시 정리 (2분 TTL 기준)
  private cleanupProfileCache() {
    const now = Date.now();
    for (const [key, entry] of this.profileCache.entries()) {
      if (now - entry.timestamp >= this.PROFILE_CACHE_TTL) {
        this.profileCache.delete(key);
      }
    }
  }
}
