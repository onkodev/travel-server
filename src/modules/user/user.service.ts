import {
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';

export interface UserListItem {
  id: string;
  email: string;
  name?: string;
  phone?: string;
  avatarUrl?: string;
  role: 'user' | 'admin' | 'agent';
  isActive: boolean;
  emailVerified: boolean;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface UserListParams {
  page?: number;
  limit?: number;
  keyword?: string;
  isActive?: boolean;
  sortColumn?: string;
  sortDirection?: 'asc' | 'desc';
}

export interface UserStats {
  total: number;
  active: number;
  inactive: number;
}

// Supabase users 테이블의 raw 데이터 타입
interface SupabaseUserRow {
  id: string;
  email: string;
  name?: string;
  phone?: string;
  avatar_url?: string;
  role?: 'user' | 'admin' | 'agent';
  is_active?: boolean;
  email_verified?: boolean;
  last_login_at?: string;
  created_at: string;
  updated_at?: string;
}

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(private supabaseService: SupabaseService) {}

  // Supabase 에러를 NestJS 예외로 변환
  private handleSupabaseError(error: any, context: string): never {
    this.logger.error(`${context}: ${error.message}`, error.stack);
    throw new InternalServerErrorException(`${context} 처리 중 오류가 발생했습니다`);
  }

  async getUserList(params: UserListParams) {
    const supabase = this.supabaseService.getAuthClient();
    const page = params.page || 1;
    const limit = params.limit || 10;
    const offset = (page - 1) * limit;

    let query = supabase.from('users').select('*', { count: 'exact' });

    // 키워드 검색
    if (params.keyword) {
      query = query.or(
        `name.ilike.%${params.keyword}%,email.ilike.%${params.keyword}%`,
      );
    }

    // 활성 상태 필터
    if (params.isActive !== undefined) {
      query = query.eq('is_active', params.isActive);
    }

    // 정렬
    const sortColumn = params.sortColumn || 'created_at';
    const ascending = params.sortDirection === 'asc';
    query = query.order(sortColumn, { ascending });

    // 페이지네이션
    query = query.range(offset, offset + limit - 1);

    const { data, count, error } = await query;

    if (error) {
      this.handleSupabaseError(error, '사용자 목록 조회');
    }

    // camelCase로 변환
    const users = (data || []).map(this.mapUserToCamelCase);

    return {
      data: users,
      meta: {
        total: count || 0,
        page,
        limit,
        totalPages: Math.ceil((count || 0) / limit),
      },
    };
  }

  async getUserStats(): Promise<UserStats> {
    const supabase = this.supabaseService.getAuthClient();

    // 병렬 쿼리로 성능 개선
    const [totalResult, activeResult, inactiveResult] = await Promise.all([
      supabase.from('users').select('*', { count: 'exact', head: true }),
      supabase.from('users').select('*', { count: 'exact', head: true }).eq('is_active', true),
      supabase.from('users').select('*', { count: 'exact', head: true }).eq('is_active', false),
    ]);

    return {
      total: totalResult.count || 0,
      active: activeResult.count || 0,
      inactive: inactiveResult.count || 0,
    };
  }

  async getUserById(id: string): Promise<UserListItem> {
    const supabase = this.supabaseService.getAuthClient();

    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      throw new NotFoundException('사용자를 찾을 수 없습니다');
    }

    return this.mapUserToCamelCase(data);
  }

  async updateUserStatus(id: string, isActive: boolean) {
    const supabase = this.supabaseService.getAuthClient();

    const { error } = await supabase
      .from('users')
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      this.handleSupabaseError(error, '사용자 상태 변경');
    }

    return { success: true };
  }

  async updateUserRole(id: string, role: 'user' | 'admin' | 'agent') {
    const supabase = this.supabaseService.getAuthClient();

    const { error } = await supabase
      .from('users')
      .update({ role, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      this.handleSupabaseError(error, '사용자 역할 변경');
    }

    return { success: true };
  }

  private mapUserToCamelCase(user: SupabaseUserRow): UserListItem {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      avatarUrl: user.avatar_url,
      role: user.role || 'user',
      isActive: user.is_active ?? true,
      emailVerified: user.email_verified ?? false,
      lastLoginAt: user.last_login_at,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
    };
  }

  // 사용자가 구매한 투어 목록 조회
  async getMyTours(userId: string) {
    // user_tours 테이블이 아직 구현되지 않음 - 빈 배열 반환
    this.logger.log(`getMyTours called for userId: ${userId} - feature not yet implemented`);
    return [];
  }

  // 사용자 통계 조회 (여행한 도시 수, 리뷰 평균 점수, 선호 테마)
  async getMyStats(userId: string) {
    // user_tours 테이블이 아직 구현되지 않음 - 기본값 반환
    this.logger.log(`getMyStats called for userId: ${userId} - feature not yet implemented`);
    return {
      cityCount: 0,
      averageRating: 0,
      preferredTheme: '전체',
      reviewCount: 0,
      tourCount: 0,
    };
  }

  // 통계 계산 헬퍼
  private calculateStats(userTours: any[], reviews: any[]) {
    // 1. 여행한 도시 수 (regions 고유 개수)
    const uniqueRegionIds = new Set(
      userTours.map((ut) => ut.tours?.regionId).filter(Boolean),
    );
    const cityCount = uniqueRegionIds.size;

    // 2. 리뷰 평균 점수
    const averageRating =
      reviews.length > 0
        ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
        : 0;

    // 3. 선호 테마 (tags 집계)
    const tagCounts: Record<string, number> = {};
    userTours.forEach((ut) => {
      ut.tours?.tags?.forEach((tag: string) => {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      });
    });

    const preferredTheme =
      Object.entries(tagCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '전체';

    return {
      cityCount,
      averageRating: parseFloat(averageRating.toFixed(1)),
      preferredTheme,
      reviewCount: reviews.length,
      tourCount: userTours.length,
    };
  }
}
