/**
 * Supabase users 테이블의 snake_case 프로필을 camelCase로 변환.
 * AuthService.getMe()와 UserService.mapUserToCamelCase()에서 공통 사용.
 */

export interface SupabaseProfileRaw {
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
  // 그 외 필드 허용
  [key: string]: unknown;
}

export interface SupabaseProfileCamelCase {
  id: string;
  email: string;
  name?: string;
  phone?: string;
  avatarUrl?: string;
  role: 'user' | 'admin' | 'agent';
  isActive: boolean;
  emailVerified: boolean;
  lastLoginAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export function supabaseProfileToCamelCase(
  profile: SupabaseProfileRaw,
): SupabaseProfileCamelCase {
  return {
    id: profile.id,
    email: profile.email,
    name: profile.name,
    phone: profile.phone,
    avatarUrl: profile.avatar_url,
    role: profile.role || 'user',
    isActive: profile.is_active ?? true,
    emailVerified: profile.email_verified ?? false,
    lastLoginAt: profile.last_login_at,
    createdAt: profile.created_at,
    updatedAt: profile.updated_at,
  };
}
