import { Injectable, Logger } from '@nestjs/common';

export interface GeoIpData {
  country: string | null; // 국가 코드 (KR, US, JP)
  countryName: string | null; // 국가명
  city: string | null;
  region: string | null; // 지역/주
  timezone: string | null;
  isp: string | null; // 인터넷 서비스 제공자
  lat?: number;
  lon?: number;
}

@Injectable()
export class GeoIpService {
  private readonly logger = new Logger(GeoIpService.name);
  private cache = new Map<string, { data: GeoIpData; timestamp: number }>();
  private readonly CACHE_TTL = 24 * 60 * 60 * 1000; // 24시간
  private readonly MAX_CACHE_SIZE = 10000;

  /**
   * IP 주소로 지리 정보 조회
   * 무료 API 사용: ip-api.com (분당 45회 제한)
   */
  async lookup(ip: string): Promise<GeoIpData> {
    // localhost나 private IP는 스킵
    if (this.isPrivateIp(ip)) {
      return this.getEmptyData();
    }

    // 캐시 확인
    const cached = this.cache.get(ip);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }

    try {
      const response = await fetch(
        `http://ip-api.com/json/${ip}?fields=status,message,country,countryCode,region,regionName,city,timezone,isp,lat,lon`,
      );

      if (!response.ok) {
        this.logger.warn(
          `GeoIP lookup failed for ${ip}: HTTP ${response.status}`,
        );
        return this.getEmptyData();
      }

      const data = await response.json();

      if (data.status === 'fail') {
        this.logger.warn(`GeoIP lookup failed for ${ip}: ${data.message}`);
        return this.getEmptyData();
      }

      const result: GeoIpData = {
        country: data.countryCode || null,
        countryName: data.country || null,
        city: data.city || null,
        region: data.regionName || null,
        timezone: data.timezone || null,
        isp: data.isp || null,
        lat: data.lat,
        lon: data.lon,
      };

      // 캐시 저장 (크기 제한)
      this.evictIfNeeded();
      this.cache.set(ip, { data: result, timestamp: Date.now() });

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`GeoIP lookup error for ${ip}: ${errorMessage}`);
      return this.getEmptyData();
    }
  }

  /**
   * 배치 조회 (여러 IP를 한번에)
   */
  async lookupBatch(ips: string[]): Promise<Map<string, GeoIpData>> {
    const results = new Map<string, GeoIpData>();
    const uncachedIps: string[] = [];

    // 캐시된 것들 먼저 처리
    for (const ip of ips) {
      if (this.isPrivateIp(ip)) {
        results.set(ip, this.getEmptyData());
        continue;
      }

      const cached = this.cache.get(ip);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        results.set(ip, cached.data);
      } else {
        uncachedIps.push(ip);
      }
    }

    // 캐시 안된 것들 배치 조회 (ip-api.com 배치 API)
    if (uncachedIps.length > 0) {
      try {
        const response = await fetch(
          'http://ip-api.com/batch?fields=status,query,country,countryCode,region,regionName,city,timezone,isp',
          {
            method: 'POST',
            body: JSON.stringify(uncachedIps),
          },
        );

        if (response.ok) {
          const data = await response.json();
          for (const item of data) {
            const result: GeoIpData = {
              country: item.countryCode || null,
              countryName: item.country || null,
              city: item.city || null,
              region: item.regionName || null,
              timezone: item.timezone || null,
              isp: item.isp || null,
            };
            results.set(item.query, result);
            this.evictIfNeeded();
            this.cache.set(item.query, { data: result, timestamp: Date.now() });
          }
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(`GeoIP batch lookup error: ${errorMessage}`);
        // 실패한 IP들은 빈 데이터로
        for (const ip of uncachedIps) {
          if (!results.has(ip)) {
            results.set(ip, this.getEmptyData());
          }
        }
      }
    }

    return results;
  }

  private evictIfNeeded(): void {
    if (this.cache.size < this.MAX_CACHE_SIZE) return;
    // 가장 오래된 항목 삭제 (Map은 삽입 순서를 유지)
    const firstKey = this.cache.keys().next().value;
    if (firstKey !== undefined) {
      this.cache.delete(firstKey);
    }
  }

  private isPrivateIp(ip: string): boolean {
    if (!ip) return true;
    if (ip === '::1' || ip === '127.0.0.1' || ip === 'localhost') return true;

    // Private IP ranges
    const privateRanges = [
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
      /^192\.168\./,
    ];

    return privateRanges.some((range) => range.test(ip));
  }

  private getEmptyData(): GeoIpData {
    return {
      country: null,
      countryName: null,
      city: null,
      region: null,
      timezone: null,
      isp: null,
    };
  }

  /**
   * 국가 코드를 국기 이모지로 변환
   */
  getCountryFlag(countryCode: string | null): string {
    if (!countryCode || countryCode.length !== 2) return '';
    const codePoints = [...countryCode.toUpperCase()].map(
      (char) => 0x1f1e6 - 65 + char.charCodeAt(0),
    );
    return String.fromCodePoint(...codePoints);
  }
}
