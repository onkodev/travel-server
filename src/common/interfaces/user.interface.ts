/**
 * 인증된 사용자 인터페이스
 * Supabase Auth에서 반환하는 User 객체와 호환
 */
export interface AuthenticatedUser {
  id: string;
  email?: string;
  phone?: string;
  created_at?: string;
  updated_at?: string;
  app_metadata?: {
    provider?: string;
    providers?: string[];
  };
  user_metadata?: {
    name?: string;
    avatar_url?: string;
    full_name?: string;
  };
  aud?: string;
  role?: string;
}

/**
 * 프로필이 포함된 사용자 정보
 */
export interface UserWithProfile extends AuthenticatedUser {
  profile?: {
    name?: string;
    phone?: string;
    avatarUrl?: string;
    role?: string;
    isActive?: boolean;
  };
}
