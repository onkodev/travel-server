import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GeoIpService } from '../geoip/geoip.service';
import { UAParser } from 'ua-parser-js';
import { TrackPageViewDto } from './dto';
import {
  calculateSkip,
  createPaginatedResponse,
} from '../../common/dto/pagination.dto';

export interface CreateVisitorSessionDto {
  fingerprint?: string;
  ipAddress?: string;
  userAgent?: string;
  referrerUrl?: string;
  landingPage?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
}

@Injectable()
export class VisitorService {
  private readonly logger = new Logger(VisitorService.name);

  constructor(
    private prisma: PrismaService,
    private geoIpService: GeoIpService,
  ) {}

  /**
   * 새 방문자 세션 생성
   */
  async createSession(dto: CreateVisitorSessionDto) {
    // User Agent 파싱
    const uaParser = new UAParser(dto.userAgent || '');
    const uaResult = uaParser.getResult();

    // IP 기반 지리 정보 조회
    const geoData = dto.ipAddress
      ? await this.geoIpService.lookup(dto.ipAddress)
      : null;

    // Referrer 도메인 추출
    let referrerDomain: string | null = null;
    if (dto.referrerUrl) {
      try {
        const url = new URL(dto.referrerUrl);
        referrerDomain = url.hostname;
      } catch {
        // Invalid URL
      }
    }

    // 디바이스 타입 결정
    let deviceType = 'desktop';
    if (uaResult.device.type === 'mobile') {
      deviceType = 'mobile';
    } else if (uaResult.device.type === 'tablet') {
      deviceType = 'tablet';
    }

    const session = await this.prisma.visitorSession.create({
      data: {
        fingerprint: dto.fingerprint,
        ipAddress: dto.ipAddress,
        country: geoData?.country,
        countryName: geoData?.countryName,
        city: geoData?.city,
        region: geoData?.region,
        timezone: geoData?.timezone,
        isp: geoData?.isp,
        userAgent: dto.userAgent,
        deviceType,
        browser: uaResult.browser.name || null,
        browserVersion: uaResult.browser.version || null,
        os: uaResult.os.name || null,
        osVersion: uaResult.os.version || null,
        utmSource: dto.utmSource,
        utmMedium: dto.utmMedium,
        utmCampaign: dto.utmCampaign,
        utmTerm: dto.utmTerm,
        utmContent: dto.utmContent,
        referrerUrl: dto.referrerUrl,
        referrerDomain,
        landingPage: dto.landingPage,
      },
    });

    // 랜딩 페이지를 첫 페이지뷰로 기록
    if (dto.landingPage) {
      await this.trackPageView({
        visitorId: session.id,
        path: dto.landingPage,
      });
    }

    return session;
  }

  /**
   * 기존 세션 조회 또는 생성
   */
  async getOrCreateSession(fingerprint: string, dto: CreateVisitorSessionDto) {
    // 최근 30분 내 같은 fingerprint 세션 찾기
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

    const existingSession = await this.prisma.visitorSession.findFirst({
      where: {
        fingerprint,
        lastActivityAt: { gte: thirtyMinutesAgo },
      },
      orderBy: { lastActivityAt: 'desc' },
    });

    if (existingSession) {
      // 활동 시간 업데이트
      await this.prisma.visitorSession.update({
        where: { id: existingSession.id },
        data: { lastActivityAt: new Date() },
      });
      return existingSession;
    }

    // 새 세션 생성
    return this.createSession({ ...dto, fingerprint });
  }

  /**
   * 페이지뷰 기록
   */
  async trackPageView(dto: TrackPageViewDto) {
    const pageView = await this.prisma.pageView.create({
      data: {
        visitorId: dto.visitorId,
        path: dto.path,
        title: dto.title,
        queryParams: dto.queryParams,
        referrerPath: dto.referrerPath,
        duration: dto.duration,
        scrollDepth: dto.scrollDepth,
      },
    });

    // 세션 통계 업데이트
    await this.prisma.visitorSession.update({
      where: { id: dto.visitorId },
      data: {
        totalPageViews: { increment: 1 },
        lastActivityAt: new Date(),
      },
    });

    return pageView;
  }

  /**
   * 페이지뷰 업데이트 (체류 시간, 스크롤 등)
   */
  async updatePageView(
    pageViewId: number,
    data: { duration?: number; scrollDepth?: number; clickCount?: number },
  ) {
    const pageView = await this.prisma.pageView.update({
      where: { id: pageViewId },
      data,
    });

    // 세션 총 체류시간 업데이트
    if (data.duration) {
      await this.prisma.visitorSession.update({
        where: { id: pageView.visitorId },
        data: {
          totalDuration: { increment: data.duration },
          lastActivityAt: new Date(),
        },
      });
    }

    return pageView;
  }

  /**
   * 세션 전환 상태 업데이트
   */
  async updateConversion(
    visitorId: string,
    type: 'chatbot' | 'estimate' | 'booking',
  ) {
    const updateData: Record<string, boolean> = {};

    switch (type) {
      case 'chatbot':
        updateData.hasChatbot = true;
        break;
      case 'estimate':
        updateData.hasEstimate = true;
        break;
      case 'booking':
        updateData.hasBooking = true;
        break;
    }

    return this.prisma.visitorSession.update({
      where: { id: visitorId },
      data: updateData,
    });
  }

  /**
   * 세션 상세 조회
   */
  async getSession(visitorId: string) {
    return this.prisma.visitorSession.findUnique({
      where: { id: visitorId },
      include: {
        pageViews: {
          orderBy: { createdAt: 'asc' },
        },
        chatbotFlows: {
          select: {
            id: true,
            sessionId: true,
            isCompleted: true,
            estimateId: true,
            createdAt: true,
          },
        },
      },
    });
  }

  /**
   * 방문자 세션 목록 조회 (관리자용)
   */
  async getSessions(params: {
    page?: number;
    limit?: number;
    country?: string;
    hasChatbot?: boolean;
    hasEstimate?: boolean;
    startDate?: string;
    endDate?: string;
  }) {
    const {
      page = 1,
      limit = 20,
      country,
      hasChatbot,
      hasEstimate,
      startDate,
      endDate,
    } = params;
    const skip = calculateSkip(page, limit);

    const where: Record<string, unknown> = {};

    if (country) {
      where.country = country;
    }

    if (hasChatbot !== undefined) {
      where.hasChatbot = hasChatbot;
    }

    if (hasEstimate !== undefined) {
      where.hasEstimate = hasEstimate;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        (where.createdAt as Record<string, Date>).gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        (where.createdAt as Record<string, Date>).lte = end;
      }
    }

    const [sessions, total] = await Promise.all([
      this.prisma.visitorSession.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          _count: {
            select: { pageViews: true, chatbotFlows: true },
          },
        },
      }),
      this.prisma.visitorSession.count({ where }),
    ]);

    return createPaginatedResponse(sessions, total, page, limit);
  }

  /**
   * 방문자 통계 (Raw SQL로 최적화 - 3개 쿼리로 통합)
   */
  async getStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // 1. 기본 통계를 단일 쿼리로 조회
    const baseStats = await this.prisma.$queryRaw<[{
      total: bigint;
      today: bigint;
      this_week: bigint;
      with_chatbot: bigint;
      with_estimate: bigint;
    }]>`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN created_at >= ${today} THEN 1 END) as today,
        COUNT(CASE WHEN created_at >= ${sevenDaysAgo} THEN 1 END) as this_week,
        COUNT(CASE WHEN has_chatbot = true THEN 1 END) as with_chatbot,
        COUNT(CASE WHEN has_estimate = true THEN 1 END) as with_estimate
      FROM visitor_sessions
    `;

    // 2. 그룹별 통계는 병렬로 조회 (각 그룹은 별도 인덱스 사용)
    const [byCountry, byDevice, byUtmSource] = await Promise.all([
      this.prisma.$queryRaw<{ country: string; count: bigint }[]>`
        SELECT country, COUNT(*) as count
        FROM visitor_sessions
        WHERE country IS NOT NULL
        GROUP BY country
        ORDER BY count DESC
        LIMIT 10
      `,
      this.prisma.$queryRaw<{ device_type: string; count: bigint }[]>`
        SELECT device_type, COUNT(*) as count
        FROM visitor_sessions
        WHERE device_type IS NOT NULL
        GROUP BY device_type
      `,
      this.prisma.$queryRaw<{ utm_source: string; count: bigint }[]>`
        SELECT utm_source, COUNT(*) as count
        FROM visitor_sessions
        WHERE utm_source IS NOT NULL
        GROUP BY utm_source
        ORDER BY count DESC
        LIMIT 10
      `,
    ]);

    const stats = baseStats[0];
    const totalSessions = Number(stats.total);
    const withChatbot = Number(stats.with_chatbot);
    const withEstimate = Number(stats.with_estimate);

    return {
      total: totalSessions,
      today: Number(stats.today),
      thisWeek: Number(stats.this_week),
      conversions: {
        chatbot: withChatbot,
        chatbotRate: totalSessions > 0 ? ((withChatbot / totalSessions) * 100).toFixed(1) + '%' : '0%',
        estimate: withEstimate,
        estimateRate: totalSessions > 0 ? ((withEstimate / totalSessions) * 100).toFixed(1) + '%' : '0%',
      },
      byCountry: byCountry.map(item => ({
        country: item.country,
        count: Number(item.count),
      })),
      byDevice: byDevice.map(item => ({
        device: item.device_type,
        count: Number(item.count),
      })),
      byUtmSource: byUtmSource.map(item => ({
        source: item.utm_source,
        count: Number(item.count),
      })),
    };
  }
}
