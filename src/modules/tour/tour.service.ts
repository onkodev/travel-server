import { Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { toCamelCase, toSnakeCase } from '../../common/utils/case.util';
import { CreateTourDto, UpdateTourDto } from './dto';

@Injectable()
export class TourService {
  constructor(private supabaseService: SupabaseService) {}

  // DB 선택 헬퍼 (auth = tumakrguide, admin = tumakr)
  private getClient(source?: string) {
    if (source === 'auth') {
      return this.supabaseService.getAuthClient();
    }
    return this.supabaseService.getAdminClient();
  }

  // 투어 목록 조회 (공개용) - source에 따라 다른 스키마 사용
  async getPublicTours(params: {
    page?: number;
    limit?: number;
    category?: string;
    tags?: string[];
    search?: string;
    regionId?: string;
    source?: string; // 'auth' = tumakrguide (onlinetour), 'admin' = tumakr (history/group)
  }) {
    const {
      page = 1,
      limit = 20,
      category,
      tags,
      search,
      regionId,
      source,
    } = params;
    const offset = (page - 1) * limit;
    const supabase = this.getClient(source);

    // source에 따라 다른 필드 선택
    const selectFields =
      source === 'auth'
        ? 'id, title, title_i18n, thumbnail_url, duration_minutes, price, currency, tags, region_id'
        : 'id, title, thumbnail_url, duration_minutes, price, currency, category, tags';

    let query = supabase
      .from('tours')
      .select(selectFields, { count: 'exact' })
      .eq('status', 'published');

    if (category && source !== 'auth') {
      query = query.eq('category', category);
    }

    if (regionId && source === 'auth') {
      query = query.eq('region_id', regionId);
    }

    if (tags && tags.length > 0) {
      query = query.overlaps('tags', tags);
    }

    if (search) {
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
    }

    query = query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data, count, error } = await query;

    if (error) {
      throw error;
    }

    return {
      data: toCamelCase(data || []),
      meta: {
        total: count || 0,
        page,
        limit,
        totalPages: Math.ceil((count || 0) / limit),
      },
    };
  }

  // 투어 목록 조회 (관리자용) - admin 프로젝트 전용
  async getTours(params: {
    page?: number;
    limit?: number;
    status?: string;
    search?: string;
  }) {
    const { page = 1, limit = 20, status, search } = params;
    const offset = (page - 1) * limit;
    const supabase = this.supabaseService.getAdminClient();

    let query = supabase
      .from('tours')
      .select(
        'id, title, thumbnail_url, status, category, price, currency, view_count, review_count, average_rating, created_at, updated_at',
        { count: 'exact' },
      );

    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    if (search) {
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
    }

    query = query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data, count, error } = await query;

    if (error) {
      throw error;
    }

    return {
      data: toCamelCase(data || []),
      meta: {
        total: count || 0,
        page,
        limit,
        totalPages: Math.ceil((count || 0) / limit),
      },
    };
  }

  // 투어 상세 조회 - source에 따라 다른 스키마 사용
  async getTour(id: number, source?: string) {
    const supabase = this.getClient(source);

    // 둘 다 전체 필드 조회 (스키마가 다르므로 * 사용)
    const selectFields = '*';

    const { data: tour, error } = await supabase
      .from('tours')
      .select(selectFields)
      .eq('id', id)
      .single();

    if (error || !tour) {
      throw new NotFoundException('투어를 찾을 수 없습니다');
    }

    // 조회수 증가
    await supabase
      .from('tours')
      .update({ view_count: (tour.view_count || 0) + 1 })
      .eq('id', id);

    return toCamelCase(tour);
  }

  // 투어 생성 - admin 프로젝트 전용
  async createTour(data: CreateTourDto) {
    const supabase = this.supabaseService.getAdminClient();
    const snakeCaseData = toSnakeCase(data);

    const { data: tour, error } = await supabase
      .from('tours')
      .insert(snakeCaseData)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return toCamelCase(tour);
  }

  // 투어 업데이트 - admin 프로젝트 전용
  async updateTour(id: number, data: UpdateTourDto) {
    const supabase = this.supabaseService.getAdminClient();
    const snakeCaseData = toSnakeCase<Record<string, unknown>>(data);

    const { data: tour, error } = await supabase
      .from('tours')
      .update({ ...snakeCaseData, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return toCamelCase(tour);
  }

  // 투어 삭제 - admin 프로젝트 전용
  async deleteTour(id: number) {
    const supabase = this.supabaseService.getAdminClient();

    const { error } = await supabase.from('tours').delete().eq('id', id);

    if (error) {
      throw error;
    }

    return { success: true };
  }

  // 카테고리 목록 조회 - admin 프로젝트 전용
  async getCategories() {
    const supabase = this.supabaseService.getAdminClient();

    const { data, error } = await supabase
      .from('tours')
      .select('category')
      .eq('status', 'published');

    if (error) {
      throw error;
    }

    const categories = [...new Set((data || []).map((t) => t.category))];
    return categories;
  }

  // 태그 목록 조회
  async getTags() {
    const supabase = this.supabaseService.getAdminClient();

    const { data, error } = await supabase
      .from('tours')
      .select('tags')
      .eq('status', 'published');

    if (error) {
      throw error;
    }

    const allTags = (data || []).flatMap((t) => t.tags || []);
    return [...new Set(allTags)];
  }
}
