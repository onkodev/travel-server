import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

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
    all: number;
    inprogress: number;
    estimateReady: number;
    pendingReview: number;
    quoteSent: number;
    completed: number;
    declined: number;
    closed: number;
  };
}

// 간단한 인메모리 캐시
interface CacheEntry {
  data: DashboardData;
  timestamp: number;
}

@Injectable()
export class DashboardService {
  private cache: CacheEntry | null = null;
  private readonly CACHE_TTL = 60 * 1000; // 1분 캐시

  constructor(private prisma: PrismaService) {}

  async getDashboardData() {
    // 캐시 확인
    const now = Date.now();
    if (this.cache && now - this.cache.timestamp < this.CACHE_TTL) {
      return this.cache.data;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const sevenDaysLater = new Date(today);
    sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);

    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // SQL 집계로 최적화 (전체 레코드 fetch 대신 DB에서 카운트)
    const [
      // 견적 통계 (groupBy로 source별 카운트)
      estimatesBySource,
      recentEstimatesCount,
      // 예약 통계 (groupBy로 status별 카운트)
      bookingsByStatus,
      upcomingBookingsCount,
      upcomingBookings,
      // 채팅 통계 (groupBy로 status별 카운트)
      chatsByStatus,
      // 아이템 통계 (groupBy로 type별 카운트)
      itemsByType,
      // 최근 수정된 견적 (필요한 필드만)
      recentEstimates,
    ] = await Promise.all([
      // 견적: source별 카운트
      this.prisma.estimate.groupBy({
        by: ['source'],
        _count: { id: true },
      }),
      // 견적: 최근 7일 카운트
      this.prisma.estimate.count({
        where: { createdAt: { gte: sevenDaysAgo } },
      }),
      // 예약: status별 카운트
      this.prisma.booking.groupBy({
        by: ['status'],
        _count: { id: true },
      }),
      // 예약: 다가오는 예약 카운트
      this.prisma.booking.count({
        where: {
          bookingDate: { gte: today },
          status: { not: 'cancelled' },
        },
      }),
      // 예약: 다가오는 예약 상세 (상위 10개만)
      this.prisma.booking.findMany({
        where: {
          bookingDate: { gte: today, lte: sevenDaysLater },
          status: { not: 'cancelled' },
        },
        orderBy: { bookingDate: 'asc' },
        take: 10,
      }),
      // 채팅: status별 카운트
      this.prisma.chatSession.groupBy({
        by: ['status'],
        _count: { id: true },
      }),
      // 아이템: type별 카운트
      this.prisma.item.groupBy({
        by: ['type'],
        _count: { id: true },
      }),
      // 최근 견적 (필요한 필드만)
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
    ]);

    // 견적 통계 매핑
    const manualEstimates =
      estimatesBySource.find((e) => e.source === 'manual')?._count.id || 0;
    const aiEstimates =
      estimatesBySource.find((e) => e.source === 'ai')?._count.id || 0;
    const totalEstimates = manualEstimates + aiEstimates;

    // 예약 통계 매핑
    const bookingStatusMap = Object.fromEntries(
      bookingsByStatus.map((b) => [b.status, b._count.id]),
    );
    const totalBookings = bookingsByStatus.reduce(
      (sum, b) => sum + b._count.id,
      0,
    );
    const pendingBookings = bookingStatusMap['pending'] || 0;
    const confirmedBookings = bookingStatusMap['confirmed'] || 0;

    // 채팅 통계 매핑
    const chatStatusMap = Object.fromEntries(
      chatsByStatus.map((c) => [c.status, c._count.id]),
    );
    const totalChats = chatsByStatus.reduce((sum, c) => sum + c._count.id, 0);
    const activeChats =
      (chatStatusMap['inprogress'] || 0) +
      (chatStatusMap['estimate_ready'] || 0) +
      (chatStatusMap['pending_review'] || 0);

    const chatStats = {
      all: totalChats,
      inprogress: chatStatusMap['inprogress'] || 0,
      estimateReady: chatStatusMap['estimate_ready'] || 0,
      pendingReview: chatStatusMap['pending_review'] || 0,
      quoteSent: chatStatusMap['quote_sent'] || 0,
      completed: chatStatusMap['completed'] || 0,
      declined: chatStatusMap['declined'] || 0,
      closed: chatStatusMap['closed'] || 0,
    };

    // 아이템 통계 매핑
    const itemTypeMap = Object.fromEntries(
      itemsByType.map((i) => [i.type, i._count.id]),
    );
    const totalItems = itemsByType.reduce((sum, i) => sum + i._count.id, 0);

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
        totalChats,
        activeChats,
        totalItems,
        placeCount: itemTypeMap['place'] || 0,
        accommodationCount: itemTypeMap['accommodation'] || 0,
        transportationCount: itemTypeMap['transportation'] || 0,
        contentsCount: itemTypeMap['contents'] || 0,
      },
      upcomingBookings: upcomingBookingsData,
      recentEstimates,
      chatStats,
    };

    // 캐시 저장
    this.cache = { data: result, timestamp: Date.now() };

    return result;
  }
}
