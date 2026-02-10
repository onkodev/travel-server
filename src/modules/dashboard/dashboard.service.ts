import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

// 일별 트렌드 데이터
export interface DailyTrend {
  date: string;
  estimates: number;
  bookings: number;
  chats: number;
}

// 월별 매출 데이터
export interface MonthlyRevenue {
  month: string;
  revenue: number;
  bookingCount: number;
}

// 국가별 통계
export interface CountryStats {
  country: string;
  countryName: string;
  count: number;
  percentage: number;
}

// 인기 투어
export interface PopularTour {
  id: number;
  title: string;
  thumbnailUrl: string | null;
  bookingCount: number;
  viewCount: number;
  revenue: number;
}

// 전환율 퍼널
export interface ConversionFunnel {
  chatbotStarted: number;
  estimateCreated: number;
  bookingCreated: number;
  bookingConfirmed: number;
  chatToEstimateRate: string;
  estimateToBookingRate: string;
  overallConversionRate: string;
}

// 대시보드 반환 데이터 타입
export interface DashboardData {
  stats: {
    totalEstimates: number;
    manualEstimates: number;
    aiEstimates: number;
    recentEstimates: number;
    totalBookings: number;
    pendingBookings: number;
    confirmedBookings: number;
    upcomingBookings: number;
    totalChats: number;
    activeChats: number;
    totalItems: number;
    placeCount: number;
    accommodationCount: number;
    transportationCount: number;
    contentsCount: number;
  };
  upcomingBookings: Array<{
    id: number;
    bookingDate: Date;
    status: string;
    daysUntil: number;
  }>;
  recentEstimates: Array<{
    id: number;
    title: string | null;
    customerName: string | null;
    source: string | null;
    statusManual: string | null;
    statusAi: string | null;
    updatedAt: Date | null;
    startDate: Date | null;
    totalAmount: unknown;
  }>;
  chatStats: {
    total: number;
    inProgress: number;
    completed: number;
  };
  // 새로운 통계
  dailyTrends: DailyTrend[];
  monthlyRevenue: MonthlyRevenue[];
  countryStats: CountryStats[];
  popularTours: PopularTour[];
  conversionFunnel: ConversionFunnel;
  tourTypeStats: Array<{ type: string; count: number; percentage: number }>;
}

// 간단한 인메모리 캐시
interface CacheEntry {
  data: DashboardData;
  timestamp: number;
}

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);
  private cache: CacheEntry | null = null;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5분 캐시

  constructor(private prisma: PrismaService) {}

  async getDashboardData() {
    // 캐시 확인
    const now = Date.now();
    if (this.cache && now - this.cache.timestamp < this.CACHE_TTL) {
      this.logger.debug('캐시 히트');
      return this.cache.data;
    }

    this.logger.debug('데이터 조회 시작');
    const startTime = Date.now();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const sevenDaysLater = new Date(today);
    sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);

    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // 단일 Raw SQL로 모든 핵심 통계 조회 (연결 1개만 사용)
    const [statsResult] = await this.prisma.$queryRaw<
      Array<{
        // 견적 통계
        total_estimates: bigint;
        manual_estimates: bigint;
        ai_estimates: bigint;
        recent_estimates: bigint;
        // 예약 통계
        total_bookings: bigint;
        pending_bookings: bigint;
        confirmed_bookings: bigint;
        upcoming_bookings: bigint;
        // 채팅 통계
        total_chats: bigint;
        completed_chats: bigint;
        // 아이템 통계
        total_items: bigint;
        place_count: bigint;
        accommodation_count: bigint;
        transportation_count: bigint;
        contents_count: bigint;
        // 전환 퍼널
        funnel_chatbot: bigint;
        funnel_estimate: bigint;
        funnel_booking: bigint;
        funnel_confirmed: bigint;
      }>
    >`
      SELECT
        -- 견적 통계
        (SELECT COUNT(*) FROM estimates) as total_estimates,
        (SELECT COUNT(*) FROM estimates WHERE source = 'manual') as manual_estimates,
        (SELECT COUNT(*) FROM estimates WHERE source = 'ai') as ai_estimates,
        (SELECT COUNT(*) FROM estimates WHERE created_at >= ${sevenDaysAgo}) as recent_estimates,
        -- 예약 통계
        (SELECT COUNT(*) FROM bookings) as total_bookings,
        (SELECT COUNT(*) FROM bookings WHERE status = 'pending') as pending_bookings,
        (SELECT COUNT(*) FROM bookings WHERE status = 'confirmed') as confirmed_bookings,
        (SELECT COUNT(*) FROM bookings WHERE booking_date >= ${today} AND status != 'cancelled') as upcoming_bookings,
        -- 채팅 통계
        (SELECT COUNT(*) FROM chatbot_flows) as total_chats,
        (SELECT COUNT(*) FROM chatbot_flows WHERE is_completed = true) as completed_chats,
        -- 아이템 통계
        (SELECT COUNT(*) FROM items) as total_items,
        (SELECT COUNT(*) FROM items WHERE type = 'place') as place_count,
        (SELECT COUNT(*) FROM items WHERE type = 'accommodation') as accommodation_count,
        (SELECT COUNT(*) FROM items WHERE type = 'transportation') as transportation_count,
        (SELECT COUNT(*) FROM items WHERE type = 'contents') as contents_count,
        -- 전환 퍼널
        (SELECT COUNT(*) FROM chatbot_flows WHERE created_at >= ${thirtyDaysAgo}) as funnel_chatbot,
        (SELECT COUNT(*) FROM chatbot_flows WHERE created_at >= ${thirtyDaysAgo} AND estimate_id IS NOT NULL) as funnel_estimate,
        (SELECT COUNT(*) FROM bookings WHERE created_at >= ${thirtyDaysAgo}) as funnel_booking,
        (SELECT COUNT(*) FROM bookings WHERE created_at >= ${thirtyDaysAgo} AND status IN ('confirmed', 'completed')) as funnel_confirmed
    `;
    this.logger.debug(`핵심 통계: ${Date.now() - startTime}ms`);

    // 나머지 데이터는 3개씩 병렬 (연결 수 제한)
    const [upcomingBookings, recentEstimates, monthlyRevenue] =
      await Promise.all([
        this.prisma.booking.findMany({
          where: {
            bookingDate: { gte: today, lte: sevenDaysLater },
            status: { not: 'cancelled' },
          },
          orderBy: { bookingDate: 'asc' },
          take: 10,
        }),
        this.prisma.estimate.findMany({
          select: {
            id: true,
            title: true,
            customerName: true,
            source: true,
            statusManual: true,
            statusAi: true,
            updatedAt: true,
            startDate: true,
            totalAmount: true,
          },
          orderBy: { updatedAt: 'desc' },
          take: 10,
        }),
        this.getMonthlyRevenue(),
      ]);
    this.logger.debug(`리스트 데이터: ${Date.now() - startTime}ms`);

    const [dailyTrends, countryStats, popularTours, tourTypeStats] =
      await Promise.all([
        this.getDailyTrends(),
        this.getCountryStats(),
        this.getPopularTours(),
        this.getTourTypeStats(),
      ]);
    this.logger.debug(`차트 데이터: ${Date.now() - startTime}ms`);

    // 통계 매핑
    const totalEstimates = Number(statsResult.total_estimates);
    const manualEstimates = Number(statsResult.manual_estimates);
    const aiEstimates = Number(statsResult.ai_estimates);
    const recentEstimatesCount = Number(statsResult.recent_estimates);
    const totalBookings = Number(statsResult.total_bookings);
    const pendingBookings = Number(statsResult.pending_bookings);
    const confirmedBookings = Number(statsResult.confirmed_bookings);
    const upcomingBookingsCount = Number(statsResult.upcoming_bookings);
    const totalChatsCount = Number(statsResult.total_chats);
    const completedChatsCount = Number(statsResult.completed_chats);
    const totalItems = Number(statsResult.total_items);
    const activeChats = totalChatsCount - completedChatsCount;

    // 전환 퍼널
    const funnelChatbot = Number(statsResult.funnel_chatbot);
    const funnelEstimate = Number(statsResult.funnel_estimate);
    const funnelBooking = Number(statsResult.funnel_booking);
    const funnelConfirmed = Number(statsResult.funnel_confirmed);

    const conversionFunnel: ConversionFunnel = {
      chatbotStarted: funnelChatbot,
      estimateCreated: funnelEstimate,
      bookingCreated: funnelBooking,
      bookingConfirmed: funnelConfirmed,
      chatToEstimateRate:
        funnelChatbot > 0
          ? ((funnelEstimate / funnelChatbot) * 100).toFixed(1) + '%'
          : '0%',
      estimateToBookingRate:
        funnelEstimate > 0
          ? ((funnelBooking / funnelEstimate) * 100).toFixed(1) + '%'
          : '0%',
      overallConversionRate:
        funnelChatbot > 0
          ? ((funnelConfirmed / funnelChatbot) * 100).toFixed(1) + '%'
          : '0%',
    };

    const chatStats = {
      total: totalChatsCount,
      inProgress: activeChats,
      completed: completedChatsCount,
    };

    // 아이템 통계 매핑
    const placeCount = Number(statsResult.place_count);
    const accommodationCount = Number(statsResult.accommodation_count);
    const transportationCount = Number(statsResult.transportation_count);
    const contentsCount = Number(statsResult.contents_count);

    // 다가오는 예약 가공
    const upcomingBookingsData = upcomingBookings.map((booking) => {
      const bookingDate = new Date(booking.bookingDate);
      const daysUntil = Math.ceil(
        (bookingDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
      );
      return { ...booking, daysUntil };
    });

    const result = {
      stats: {
        totalEstimates,
        manualEstimates,
        aiEstimates,
        recentEstimates: recentEstimatesCount,
        totalBookings,
        pendingBookings,
        confirmedBookings,
        upcomingBookings: upcomingBookingsCount,
        totalChats: totalChatsCount,
        activeChats,
        totalItems,
        placeCount,
        accommodationCount,
        transportationCount,
        contentsCount,
      },
      upcomingBookings: upcomingBookingsData,
      recentEstimates,
      chatStats,
      dailyTrends,
      monthlyRevenue,
      countryStats,
      popularTours,
      conversionFunnel,
      tourTypeStats,
    };

    // 캐시 저장
    this.cache = { data: result, timestamp: Date.now() };

    this.logger.debug(`총 소요시간: ${Date.now() - startTime}ms`);

    return result;
  }

  // 일별 트렌드 (최근 30일) - Raw SQL로 최적화
  private async getDailyTrends(): Promise<DailyTrend[]> {
    const start = Date.now();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    thirtyDaysAgo.setHours(0, 0, 0, 0);
    const dateStr = thirtyDaysAgo.toISOString();

    // Raw SQL로 날짜별 집계 (훨씬 빠름)
    const [estimateData, bookingData, chatData] = await Promise.all([
      this.prisma.$queryRaw<Array<{ date: Date; count: bigint }>>`
        SELECT DATE(created_at) as date, COUNT(*) as count
        FROM estimates
        WHERE created_at >= ${thirtyDaysAgo}
        GROUP BY DATE(created_at)
      `,
      this.prisma.$queryRaw<Array<{ date: Date; count: bigint }>>`
        SELECT DATE(created_at) as date, COUNT(*) as count
        FROM bookings
        WHERE created_at >= ${thirtyDaysAgo}
        GROUP BY DATE(created_at)
      `,
      this.prisma.$queryRaw<Array<{ date: Date; count: bigint }>>`
        SELECT DATE(created_at) as date, COUNT(*) as count
        FROM chatbot_flows
        WHERE created_at >= ${thirtyDaysAgo}
        GROUP BY DATE(created_at)
      `,
    ]);

    // 날짜별 맵 초기화
    const dateMap = new Map<string, DailyTrend>();
    for (let i = 0; i < 30; i++) {
      const date = new Date(thirtyDaysAgo);
      date.setDate(date.getDate() + i);
      const ds = date.toISOString().split('T')[0];
      dateMap.set(ds, { date: ds, estimates: 0, bookings: 0, chats: 0 });
    }

    // 데이터 매핑
    estimateData.forEach((e) => {
      const ds = new Date(e.date).toISOString().split('T')[0];
      const entry = dateMap.get(ds);
      if (entry) entry.estimates = Number(e.count);
    });
    bookingData.forEach((b) => {
      const ds = new Date(b.date).toISOString().split('T')[0];
      const entry = dateMap.get(ds);
      if (entry) entry.bookings = Number(b.count);
    });
    chatData.forEach((c) => {
      const ds = new Date(c.date).toISOString().split('T')[0];
      const entry = dateMap.get(ds);
      if (entry) entry.chats = Number(c.count);
    });

    this.logger.debug(`getDailyTrends: ${Date.now() - start}ms`);
    return Array.from(dateMap.values());
  }

  // 월별 매출 (최근 6개월)
  private async getMonthlyRevenue(): Promise<MonthlyRevenue[]> {
    const start = Date.now();
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setHours(0, 0, 0, 0);

    const bookings = await this.prisma.booking.findMany({
      where: {
        createdAt: { gte: sixMonthsAgo },
        status: { in: ['confirmed', 'completed'] },
      },
      select: {
        createdAt: true,
        totalAmount: true,
      },
    });

    // 월별 집계
    const monthMap = new Map<string, { revenue: number; count: number }>();
    for (let i = 0; i < 6; i++) {
      const date = new Date(sixMonthsAgo);
      date.setMonth(date.getMonth() + i);
      const monthStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      monthMap.set(monthStr, { revenue: 0, count: 0 });
    }

    bookings.forEach((b) => {
      const date = new Date(b.createdAt);
      const monthStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const entry = monthMap.get(monthStr);
      if (entry) {
        const amt = Number(b.totalAmount);
        entry.revenue += Number.isFinite(amt) ? amt : 0;
        entry.count += 1;
      }
    });

    const result = Array.from(monthMap.entries()).map(([month, data]) => ({
      month,
      revenue: data.revenue,
      bookingCount: data.count,
    }));
    this.logger.debug(`getMonthlyRevenue: ${Date.now() - start}ms`);
    return result;
  }

  // 국가별 통계 - Raw SQL로 최적화
  private async getCountryStats(): Promise<CountryStats[]> {
    const start = Date.now();

    const countryData = await this.prisma.$queryRaw<
      Array<{
        country: string;
        country_name: string;
        count: bigint;
      }>
    >`
      SELECT country, country_name, COUNT(*) as count
      FROM chatbot_flows
      WHERE country IS NOT NULL
      GROUP BY country, country_name
      ORDER BY COUNT(*) DESC
      LIMIT 10
    `;

    const total = countryData.reduce((sum, c) => sum + Number(c.count), 0);

    const result = countryData.map((c) => ({
      country: c.country || 'unknown',
      countryName: c.country_name || c.country || 'Unknown',
      count: Number(c.count),
      percentage: total > 0 ? Math.round((Number(c.count) / total) * 100) : 0,
    }));
    this.logger.debug(`getCountryStats: ${Date.now() - start}ms`);
    return result;
  }

  // 인기 투어 (예약 수 기준) - Raw SQL로 최적화
  private async getPopularTours(): Promise<PopularTour[]> {
    const start = Date.now();

    const result = await this.prisma.$queryRaw<
      Array<{
        id: number;
        title: string;
        thumbnail_url: string | null;
        view_count: number;
        booking_count: bigint;
        revenue: number | null;
      }>
    >`
      SELECT
        t.id,
        t.title,
        t.thumbnail_url,
        t.view_count,
        COUNT(b.id) as booking_count,
        COALESCE(SUM(CASE WHEN b.status IN ('confirmed', 'completed') THEN b.total_amount ELSE 0 END), 0) as revenue
      FROM tours t
      LEFT JOIN bookings b ON t.id = b.tour_id
      WHERE t.status = 'published'
      GROUP BY t.id, t.title, t.thumbnail_url, t.view_count
      ORDER BY COUNT(b.id) DESC
      LIMIT 5
    `;

    this.logger.debug(`getPopularTours: ${Date.now() - start}ms`);
    return result.map((r) => ({
      id: r.id,
      title: r.title,
      thumbnailUrl: r.thumbnail_url,
      bookingCount: Number(r.booking_count),
      viewCount: r.view_count || 0,
      revenue: Number(r.revenue) || 0,
    }));
  }

  // 전환율 퍼널 - Raw SQL로 최적화
  private async getConversionFunnel(): Promise<ConversionFunnel> {
    const start = Date.now();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // 단일 쿼리로 모든 통계 조회
    const [funnelData] = await this.prisma.$queryRaw<
      Array<{
        chatbot_started: bigint;
        estimate_created: bigint;
        booking_created: bigint;
        booking_confirmed: bigint;
      }>
    >`
      SELECT
        (SELECT COUNT(*) FROM chatbot_flows WHERE created_at >= ${thirtyDaysAgo}) as chatbot_started,
        (SELECT COUNT(*) FROM chatbot_flows WHERE created_at >= ${thirtyDaysAgo} AND estimate_id IS NOT NULL) as estimate_created,
        (SELECT COUNT(*) FROM bookings WHERE created_at >= ${thirtyDaysAgo}) as booking_created,
        (SELECT COUNT(*) FROM bookings WHERE created_at >= ${thirtyDaysAgo} AND status IN ('confirmed', 'completed')) as booking_confirmed
    `;

    const chatbotStarted = Number(funnelData.chatbot_started);
    const estimateCreated = Number(funnelData.estimate_created);
    const bookingCreated = Number(funnelData.booking_created);
    const bookingConfirmed = Number(funnelData.booking_confirmed);

    const chatToEstimateRate =
      chatbotStarted > 0
        ? ((estimateCreated / chatbotStarted) * 100).toFixed(1) + '%'
        : '0%';
    const estimateToBookingRate =
      estimateCreated > 0
        ? ((bookingCreated / estimateCreated) * 100).toFixed(1) + '%'
        : '0%';
    const overallConversionRate =
      chatbotStarted > 0
        ? ((bookingConfirmed / chatbotStarted) * 100).toFixed(1) + '%'
        : '0%';

    this.logger.debug(`getConversionFunnel: ${Date.now() - start}ms`);
    return {
      chatbotStarted,
      estimateCreated,
      bookingCreated,
      bookingConfirmed,
      chatToEstimateRate,
      estimateToBookingRate,
      overallConversionRate,
    };
  }

  // 투어 타입별 선호도 - Raw SQL로 최적화
  private async getTourTypeStats(): Promise<
    Array<{ type: string; count: number; percentage: number }>
  > {
    const start = Date.now();

    const typeData = await this.prisma.$queryRaw<
      Array<{
        tour_type: string;
        count: bigint;
      }>
    >`
      SELECT tour_type, COUNT(*) as count
      FROM chatbot_flows
      WHERE tour_type IS NOT NULL
      GROUP BY tour_type
      ORDER BY COUNT(*) DESC
    `;

    const total = typeData.reduce((sum, t) => sum + Number(t.count), 0);

    const result = typeData.map((t) => ({
      type: t.tour_type || 'unknown',
      count: Number(t.count),
      percentage: total > 0 ? Math.round((Number(t.count) / total) * 100) : 0,
    }));
    this.logger.debug(`getTourTypeStats: ${Date.now() - start}ms`);
    return result;
  }
}
