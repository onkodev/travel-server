import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SupabaseError } from '../../common/types';
import {
  handleSupabaseError,
  sanitizeSearch,
  supabaseProfileToCamelCase,
} from '../../common/utils';
import { convertDecimalFields } from '../../common/utils/decimal.util';
import {
  calculateSkip,
  createPaginatedResponse,
} from '../../common/dto/pagination.dto';

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

// SupabaseUserRow는 common/utils/transform.ts의 SupabaseProfileRaw로 대체

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    private supabaseService: SupabaseService,
    private prisma: PrismaService,
  ) {}

  // Supabase 에러를 NestJS 예외로 변환
  private handleSupabaseError(
    error: SupabaseError | unknown,
    context: string,
  ): never {
    handleSupabaseError(this.logger, error, context);
  }

  async getUserList(params: UserListParams) {
    const supabase = this.supabaseService.getAuthClient();
    const page = params.page || 1;
    const limit = params.limit || 10;
    const offset = calculateSkip(page, limit);

    let query = supabase.from('users').select('*', { count: 'exact' });

    // 키워드 검색
    const keyword = sanitizeSearch(params.keyword);
    if (keyword) {
      query = query.or(`name.ilike.%${keyword}%,email.ilike.%${keyword}%`);
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

    return createPaginatedResponse(users, count || 0, page, limit);
  }

  async getUserStats(): Promise<UserStats> {
    const supabase = this.supabaseService.getAuthClient();

    // 병렬 쿼리로 성능 개선
    const [totalResult, activeResult, inactiveResult] = await Promise.all([
      supabase.from('users').select('*', { count: 'exact', head: true }),
      supabase
        .from('users')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true),
      supabase
        .from('users')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', false),
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

    // 프로필 캐시 무효화 (AuthGuard에서 새 role 즉시 반영)
    this.supabaseService.invalidateProfileCache(id);

    return { success: true };
  }

  private mapUserToCamelCase(user: Record<string, unknown>): UserListItem {
    const converted = supabaseProfileToCamelCase(user as import('../../common/utils').SupabaseProfileRaw);
    return converted as UserListItem;
  }

  // 관리자용: 특정 사용자의 견적 목록
  async getUserEstimates(userId: string) {
    const estimates = await this.prisma.estimate.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        statusAi: true,
        totalAmount: true,
        travelDays: true,
        startDate: true,
        customerName: true,
        customerEmail: true,
        createdAt: true,
      },
    });
    return estimates.map(convertDecimalFields);
  }

  // 관리자용: 특정 사용자의 챗봇 상담 목록
  async getUserChatbotFlows(userId: string) {
    return this.prisma.chatbotFlow.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        sessionId: true,
        id: true,
        currentStep: true,
        tourType: true,
        customerName: true,
        customerEmail: true,
        region: true,
        travelDate: true,
        duration: true,
        estimateId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  // 관리자용: 특정 사용자의 결제 목록
  async getUserPayments(userId: string) {
    // 사용자의 견적 ID와 제목을 한 번에 조회
    const estimates = await this.prisma.estimate.findMany({
      where: { userId },
      select: { id: true, title: true },
    });

    if (estimates.length === 0) return [];

    const estimateMap = new Map(estimates.map((e) => [e.id, e.title]));
    const estimateIds = estimates.map((e) => e.id);

    // 결제 조회 (단일 쿼리)
    const payments = await this.prisma.payment.findMany({
      where: { estimateId: { in: estimateIds } },
      orderBy: { createdAt: 'desc' },
    });

    return payments.map((p) => ({
      ...convertDecimalFields(p),
      estimateTitle: p.estimateId ? estimateMap.get(p.estimateId) || null : null,
    }));
  }

  // 사용자의 견적 + 진행중 상담 조회
  async getMyEstimates(userId: string) {
    // 1. 사용자의 ChatbotFlow 조회 (견적 유무 무관)
    const flows = await this.prisma.chatbotFlow.findMany({
      where: { userId },
      select: {
        sessionId: true,
        estimateId: true,
        title: true,
        tourType: true,
        region: true,
        travelDate: true,
        duration: true,
        adultsCount: true,
        childrenCount: true,
        infantsCount: true,
        isCompleted: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const sessionIds = flows.map((f) => f.sessionId);

    // 2. 연결된 Estimate 조회 (userId 직접 매칭 + chatSessionId 매칭)
    const estimates = await this.prisma.estimate.findMany({
      where: {
        source: 'ai',
        OR: [
          { userId },
          ...(sessionIds.length > 0
            ? [{ chatSessionId: { in: sessionIds } }]
            : []),
        ],
      },
      select: {
        id: true,
        shareHash: true,
        title: true,
        statusAi: true,
        startDate: true,
        endDate: true,
        travelDays: true,
        adultsCount: true,
        childrenCount: true,
        infantsCount: true,
        totalAmount: true,
        currency: true,
        regions: true,
        tourType: true,
        chatSessionId: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // 3. 견적이 있는 세션 ID 수집
    const estimateBySession = new Map(
      estimates.filter((e) => e.chatSessionId).map((e) => [e.chatSessionId, e]),
    );
    const estimateIds = new Set(estimates.map((e) => e.id));

    // 4. 통합 결과 생성
    const results: Array<{
      id: number | null;
      shareHash: string | null;
      title: string;
      statusAi: string | null;
      startDate: string | null;
      endDate: string | null;
      travelDays: number;
      adultsCount: number | null;
      childrenCount: number | null;
      infantsCount: number | null;
      totalAmount: number | null;
      currency: string | null;
      regions: string[];
      tourType: string | null;
      createdAt: string | null;
    }> = [];

    // 견적이 있는 것들 추가
    for (const est of estimates.map(convertDecimalFields)) {
      results.push({
        id: est.id,
        shareHash: est.shareHash,
        title: est.title,
        statusAi: est.statusAi,
        startDate: est.startDate ? new Date(est.startDate).toISOString() : null,
        endDate: est.endDate ? new Date(est.endDate).toISOString() : null,
        travelDays: est.travelDays,
        adultsCount: est.adultsCount,
        childrenCount: est.childrenCount,
        infantsCount: est.infantsCount,
        totalAmount: est.totalAmount as number | null,
        currency: est.currency,
        regions: est.regions,
        tourType: est.tourType,
        createdAt: est.createdAt ? new Date(est.createdAt).toISOString() : null,
      });
    }

    // 견적이 아직 없는 진행중 flow도 추가
    for (const flow of flows) {
      if (flow.estimateId && estimateIds.has(flow.estimateId)) continue;
      if (estimateBySession.has(flow.sessionId)) continue;

      results.push({
        id: null,
        shareHash: null,
        title: flow.title || 'Trip Request',
        statusAi: 'pending',
        startDate: flow.travelDate
          ? new Date(flow.travelDate).toISOString()
          : null,
        endDate: null,
        travelDays: flow.duration || 1,
        adultsCount: flow.adultsCount,
        childrenCount: flow.childrenCount,
        infantsCount: flow.infantsCount,
        totalAmount: null,
        currency: null,
        regions: flow.region ? [flow.region] : [],
        tourType: flow.tourType,
        createdAt: flow.createdAt
          ? new Date(flow.createdAt).toISOString()
          : null,
      });
    }

    // 최신순 정렬
    results.sort((a, b) => {
      const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return db - da;
    });

    return results;
  }

}
