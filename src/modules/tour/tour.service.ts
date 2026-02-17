import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { toCamelCase, toSnakeCase } from '../../common/utils/case.util';
import { SupabaseError } from '../../common/types';
import { CreateTourDto, UpdateTourDto } from './dto';
import {
  MemoryCache,
  handleSupabaseError,
  sanitizeSearch,
  sanitizeSupabaseSearch,
} from '../../common/utils';
import { CACHE_TTL } from '../../common/constants/cache';
import {
  calculateSkip,
  createPaginatedResponse,
} from '../../common/dto/pagination.dto';

@Injectable()
export class TourService {
  private readonly logger = new Logger(TourService.name);
  private cache = new MemoryCache(CACHE_TTL.TOUR);
  private readonly STATIC_CACHE_TTL = CACHE_TTL.ITEM; // 1시간 (카테고리, 태그)

  constructor(private supabaseService: SupabaseService) {}

  // Supabase 에러를 NestJS 예외로 변환
  private handleSupabaseError(
    error: SupabaseError | unknown,
    context: string,
  ): never {
    handleSupabaseError(this.logger, error, context);
  }

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

    // 캐시 키 생성 (검색어가 없는 경우만 캐싱)
    const cacheKey = !search
      ? `public_tours_${source || 'admin'}_${page}_${limit}_${category || ''}_${regionId || ''}_${(tags || []).join(',')}`
      : null;

    if (cacheKey) {
      const cached =
        this.cache.get<ReturnType<typeof createPaginatedResponse>>(cacheKey);
      if (cached) return cached;
    }

    const offset = calculateSkip(page, limit);
    const supabase = this.getClient(source);

    // source에 따라 다른 필드 선택 (* 로 전체 조회해서 디버깅)
    const selectFields =
      source === 'auth'
        ? '*'
        : 'id, title, thumbnail_url, duration_minutes, price, currency, category, tags, review_count, average_rating';

    let query = supabase
      .from('tours')
      .select(selectFields, { count: 'exact' })
      .eq('status', 'published');

    // tumakrguide(auth)는 삭제되지 않은 투어만 조회
    if (source === 'auth') {
      query = query.eq('delete_yn', false);
    }

    if (category && source !== 'auth') {
      query = query.eq('category', category);
    }

    if (regionId && source === 'auth') {
      query = query.eq('region_id', regionId);
    }

    if (tags && tags.length > 0) {
      query = query.overlaps('tags', tags);
    }

    const sanitized = sanitizeSupabaseSearch(search);
    if (sanitized) {
      query = query.or(
        `title.ilike.%${sanitized}%,description.ilike.%${sanitized}%`,
      );
    }

    query = query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data, count, error } = await query;

    if (error) {
      this.handleSupabaseError(error, '공개 투어 목록 조회');
    }

    const result = createPaginatedResponse(
      toCamelCase<unknown[]>(data || []),
      count || 0,
      page,
      limit,
    );

    // 검색어가 없는 경우만 캐싱
    if (cacheKey) {
      this.cache.set(cacheKey, result);
    }

    return result;
  }

  // 투어 목록 조회 (관리자용) - admin 프로젝트 전용
  async getTours(params: {
    page?: number;
    limit?: number;
    status?: string;
    search?: string;
  }) {
    const { page = 1, limit = 20, status, search } = params;
    const offset = calculateSkip(page, limit);
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

    const sanitized = sanitizeSupabaseSearch(search);
    if (sanitized) {
      query = query.or(
        `title.ilike.%${sanitized}%,description.ilike.%${sanitized}%`,
      );
    }

    query = query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data, count, error } = await query;

    if (error) {
      this.handleSupabaseError(error, '관리자 투어 목록 조회');
    }

    return createPaginatedResponse(
      toCamelCase<unknown[]>(data || []),
      count || 0,
      page,
      limit,
    );
  }

  // 투어 상세 조회 - source에 따라 다른 스키마 사용
  async getTour(id: number, source?: string) {
    const cacheKey = `tour_${id}_${source || 'admin'}`;
    const cached = this.cache.get<unknown>(cacheKey);
    if (cached) return cached;

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

    // 조회수 증가 (비동기로 처리하여 응답 속도 개선)
    supabase
      .from('tours')
      .update({ view_count: (tour.view_count || 0) + 1 })
      .eq('id', id)
      .then(({ error: updateError }) => {
        if (updateError) {
          this.logger.warn(`조회수 증가 실패: ${updateError.message}`);
        }
      });

    const result = toCamelCase(tour);
    this.cache.set(cacheKey, result);
    return result;
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
      this.handleSupabaseError(error, '투어 생성');
    }

    this.invalidateTourCache();
    return toCamelCase(tour);
  }

  // 투어 업데이트 - admin 프로젝트 전용
  async updateTour(id: number, data: UpdateTourDto) {
    const supabase = this.supabaseService.getAdminClient();

    // PostgreSQL array 컬럼 목록 (snake_case)
    const arrayColumns = new Set([
      'image_urls',
      'included_items',
      'excluded_items',
      'tags',
      'itinerary',
      'blocked_dates',
      'blocked_weekdays',
      'highlights',
      'meeting_point',
      'notes', // 혹시 배열일 수 있으므로 추가
    ]);

    // 먼저 snake_case로 변환
    const snakeCaseData = toSnakeCase<Record<string, unknown>>(data);

    // 빈 문자열/null/undefined를 적절히 변환
    const sanitizedData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(snakeCaseData)) {
      if (value === undefined) continue;

      if (arrayColumns.has(key)) {
        // 배열 컬럼: 빈 배열/빈 문자열/null → 업데이트 제외
        if (value === '' || value === null) {
          continue;
        } else if (Array.isArray(value)) {
          if (value.length === 0) {
            continue; // 빈 배열도 제외
          }
          sanitizedData[key] = value;
        } else {
          sanitizedData[key] = value;
        }
      } else {
        // 빈 문자열은 null로 변환 (또는 제외)
        if (value === '') {
          sanitizedData[key] = null;
        } else {
          sanitizedData[key] = value;
        }
      }
    }

    const { data: tour, error } = await supabase
      .from('tours')
      .update({ ...sanitizedData, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      this.handleSupabaseError(error, '투어 수정');
    }

    this.invalidateTourCache(id);
    return toCamelCase(tour);
  }

  // 투어 삭제 - admin 프로젝트 전용
  async deleteTour(id: number) {
    const supabase = this.supabaseService.getAdminClient();

    const { error } = await supabase.from('tours').delete().eq('id', id);

    if (error) {
      this.handleSupabaseError(error, '투어 삭제');
    }

    this.invalidateTourCache(id);
    return { success: true };
  }

  // 선택적 캐시 무효화
  private invalidateTourCache(tourId?: number) {
    this.cache.deleteByPrefix('public_tours_');
    if (tourId) {
      this.cache.delete(`tour_${tourId}_admin`);
      this.cache.delete(`tour_${tourId}_auth`);
    }
    this.cache.delete('tour_categories');
    this.cache.delete('tour_tags');
  }

  // 카테고리 목록 조회 - admin 프로젝트 전용 (1시간 캐싱)
  async getCategories() {
    const cacheKey = 'tour_categories';
    const cached = this.cache.get<string[]>(cacheKey);
    if (cached) return cached;

    const supabase = this.supabaseService.getAdminClient();

    const { data, error } = await supabase
      .from('tours')
      .select('category')
      .eq('status', 'published');

    if (error) {
      this.handleSupabaseError(error, '카테고리 목록 조회');
    }

    const categories = [...new Set((data || []).map((t) => t.category))];
    this.cache.set(cacheKey, categories, this.STATIC_CACHE_TTL);
    return categories;
  }

  // 태그 목록 조회 (1시간 캐싱)
  async getTags() {
    const cacheKey = 'tour_tags';
    const cached = this.cache.get<string[]>(cacheKey);
    if (cached) return cached;

    const supabase = this.supabaseService.getAdminClient();

    const { data, error } = await supabase
      .from('tours')
      .select('tags')
      .eq('status', 'published');

    if (error) {
      this.handleSupabaseError(error, '태그 목록 조회');
    }

    const allTags = (data || []).flatMap((t) => t.tags || []);
    const result = [...new Set(allTags)];
    this.cache.set(cacheKey, result, this.STATIC_CACHE_TTL);
    return result;
  }
}
