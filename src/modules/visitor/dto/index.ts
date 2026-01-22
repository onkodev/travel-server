import { IsString, IsOptional, IsNumber, IsObject, IsInt, Min, Max, IsBoolean, IsDateString } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 세션 생성 요청 DTO
 */
export class CreateSessionDto {
  @ApiPropertyOptional({
    description: '브라우저 핑거프린트 (고유 식별자)',
    example: 'fp_abc123xyz',
  })
  @IsOptional()
  @IsString()
  fingerprint?: string;

  @ApiPropertyOptional({
    description: '랜딩 페이지 경로',
    example: '/tours/seoul',
  })
  @IsOptional()
  @IsString()
  landingPage?: string;

  @ApiPropertyOptional({
    description: 'Referrer URL',
    example: 'https://google.com',
  })
  @IsOptional()
  @IsString()
  referrerUrl?: string;

  @ApiPropertyOptional({ description: 'UTM Source', example: 'google' })
  @IsOptional()
  @IsString()
  utmSource?: string;

  @ApiPropertyOptional({ description: 'UTM Medium', example: 'cpc' })
  @IsOptional()
  @IsString()
  utmMedium?: string;

  @ApiPropertyOptional({ description: 'UTM Campaign', example: 'summer_sale' })
  @IsOptional()
  @IsString()
  utmCampaign?: string;

  @ApiPropertyOptional({ description: 'UTM Term', example: 'korea tour' })
  @IsOptional()
  @IsString()
  utmTerm?: string;

  @ApiPropertyOptional({ description: 'UTM Content', example: 'banner_1' })
  @IsOptional()
  @IsString()
  utmContent?: string;
}

/**
 * 페이지뷰 기록 요청 DTO
 */
export class TrackPageViewDto {
  @ApiProperty({
    description: '방문자 세션 ID',
    example: 'visitor_abc123',
  })
  @IsString()
  visitorId: string;

  @ApiProperty({
    description: '페이지 경로',
    example: '/tours/seoul',
  })
  @IsString()
  path: string;

  @ApiPropertyOptional({
    description: '페이지 제목',
    example: 'Seoul City Tour - Tumakr',
  })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({
    description: '쿼리 파라미터',
    example: { category: 'city', sort: 'popular' },
  })
  @IsOptional()
  @IsObject()
  queryParams?: Record<string, string>;

  @ApiPropertyOptional({
    description: '이전 페이지 경로',
    example: '/tours',
  })
  @IsOptional()
  @IsString()
  referrerPath?: string;

  @ApiPropertyOptional({
    description: '체류 시간 (초)',
    example: 45,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  duration?: number;

  @ApiPropertyOptional({
    description: '스크롤 깊이 (%)',
    example: 75,
    minimum: 0,
    maximum: 100,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  scrollDepth?: number;
}

/**
 * 페이지뷰 업데이트 요청 DTO
 */
export class UpdatePageViewDto {
  @ApiPropertyOptional({
    description: '체류 시간 (초)',
    example: 120,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  duration?: number;

  @ApiPropertyOptional({
    description: '스크롤 깊이 (%)',
    example: 100,
    minimum: 0,
    maximum: 100,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  scrollDepth?: number;

  @ApiPropertyOptional({
    description: '클릭 수',
    example: 5,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  clickCount?: number;
}

/**
 * 관리자 세션 목록 조회 쿼리 DTO
 */
export class AdminSessionQueryDto {
  @ApiPropertyOptional({
    description: '페이지 번호',
    default: 1,
    minimum: 1,
    example: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({
    description: '페이지당 항목 수',
    default: 20,
    minimum: 1,
    maximum: 100,
    example: 20,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number = 20;

  @ApiPropertyOptional({
    description: '국가 코드 필터',
    example: 'US',
  })
  @IsString()
  @IsOptional()
  country?: string;

  @ApiPropertyOptional({
    description: '챗봇 사용 여부 필터',
    example: true,
  })
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  @IsOptional()
  hasChatbot?: boolean;

  @ApiPropertyOptional({
    description: '견적 요청 여부 필터',
    example: false,
  })
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  @IsOptional()
  hasEstimate?: boolean;

  @ApiPropertyOptional({
    description: '시작 날짜 (YYYY-MM-DD)',
    example: '2024-01-01',
  })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({
    description: '종료 날짜 (YYYY-MM-DD)',
    example: '2024-01-31',
  })
  @IsDateString()
  @IsOptional()
  endDate?: string;
}

// ==================== 응답 DTO ====================

/**
 * 세션 정보 DTO
 */
export class VisitorSessionDto {
  @ApiProperty({ description: '세션 ID', example: 'visitor_abc123' })
  id: string;

  @ApiPropertyOptional({ description: '핑거프린트', example: 'fp_xyz789' })
  fingerprint?: string;

  @ApiPropertyOptional({ description: 'IP 주소', example: '123.45.67.89' })
  ipAddress?: string;

  @ApiPropertyOptional({ description: 'User Agent' })
  userAgent?: string;

  @ApiPropertyOptional({ description: '국가 코드', example: 'US' })
  country?: string;

  @ApiPropertyOptional({ description: '도시', example: 'New York' })
  city?: string;

  @ApiPropertyOptional({ description: '랜딩 페이지', example: '/tours' })
  landingPage?: string;

  @ApiPropertyOptional({ description: 'Referrer URL' })
  referrerUrl?: string;

  @ApiProperty({ description: '생성 일시' })
  createdAt: Date;

  @ApiPropertyOptional({ description: '마지막 활동 일시' })
  lastActiveAt?: Date;
}

/**
 * 세션 목록 응답 DTO
 */
export class SessionListDto {
  @ApiProperty({ type: [VisitorSessionDto], description: '세션 목록' })
  sessions: VisitorSessionDto[];

  @ApiProperty({ description: '전체 세션 수', example: 150 })
  total: number;

  @ApiProperty({ description: '현재 페이지', example: 1 })
  page: number;

  @ApiProperty({ description: '페이지당 항목 수', example: 20 })
  limit: number;
}

/**
 * 방문자 통계 DTO
 */
export class VisitorStatsDto {
  @ApiProperty({ description: '오늘 방문자 수', example: 150 })
  todayVisitors: number;

  @ApiProperty({ description: '이번 주 방문자 수', example: 850 })
  weeklyVisitors: number;

  @ApiProperty({ description: '이번 달 방문자 수', example: 3200 })
  monthlyVisitors: number;

  @ApiProperty({ description: '전체 방문자 수', example: 25000 })
  totalVisitors: number;

  @ApiProperty({ description: '평균 체류 시간 (초)', example: 180 })
  avgDuration: number;

  @ApiProperty({ description: '평균 페이지뷰', example: 3.5 })
  avgPageViews: number;

  @ApiPropertyOptional({
    description: '국가별 방문자 수',
    example: [{ country: 'US', count: 500 }, { country: 'KR', count: 300 }],
  })
  countryStats?: Array<{ country: string; count: number }>;
}

/**
 * 성공 응답 DTO
 */
export class VisitorSuccessDto {
  @ApiProperty({ description: '성공 여부', example: true })
  success: boolean;

  @ApiPropertyOptional({ description: '메시지' })
  message?: string;
}

/**
 * 세션 생성 응답 DTO
 */
export class CreateSessionResponseDto {
  @ApiProperty({ description: '세션 ID', example: 'visitor_abc123' })
  id: string;

  @ApiProperty({ description: '신규 세션 여부', example: true })
  isNew: boolean;
}

/**
 * 페이지뷰 생성 응답 DTO
 */
export class CreatePageViewResponseDto {
  @ApiProperty({ description: '성공 여부', example: true })
  success: boolean;

  @ApiPropertyOptional({ description: '페이지뷰 ID', example: 123 })
  pageViewId?: number;
}
