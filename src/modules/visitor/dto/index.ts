import { IsString, IsOptional, IsNumber, IsObject } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSessionDto {
  @ApiPropertyOptional({ description: '브라우저 핑거프린트' })
  @IsOptional()
  @IsString()
  fingerprint?: string;

  @ApiPropertyOptional({ description: '랜딩 페이지 경로' })
  @IsOptional()
  @IsString()
  landingPage?: string;

  @ApiPropertyOptional({ description: 'Referrer URL' })
  @IsOptional()
  @IsString()
  referrerUrl?: string;

  @ApiPropertyOptional({ description: 'UTM Source' })
  @IsOptional()
  @IsString()
  utmSource?: string;

  @ApiPropertyOptional({ description: 'UTM Medium' })
  @IsOptional()
  @IsString()
  utmMedium?: string;

  @ApiPropertyOptional({ description: 'UTM Campaign' })
  @IsOptional()
  @IsString()
  utmCampaign?: string;

  @ApiPropertyOptional({ description: 'UTM Term' })
  @IsOptional()
  @IsString()
  utmTerm?: string;

  @ApiPropertyOptional({ description: 'UTM Content' })
  @IsOptional()
  @IsString()
  utmContent?: string;
}

export class TrackPageViewDto {
  @ApiProperty({ description: '방문자 세션 ID' })
  @IsString()
  visitorId: string;

  @ApiProperty({ description: '페이지 경로' })
  @IsString()
  path: string;

  @ApiPropertyOptional({ description: '페이지 제목' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ description: '쿼리 파라미터' })
  @IsOptional()
  @IsObject()
  queryParams?: Record<string, string>;

  @ApiPropertyOptional({ description: '이전 페이지 경로' })
  @IsOptional()
  @IsString()
  referrerPath?: string;

  @ApiPropertyOptional({ description: '체류 시간 (초)' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  duration?: number;

  @ApiPropertyOptional({ description: '스크롤 깊이 (%)' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  scrollDepth?: number;
}

export class UpdatePageViewDto {
  @ApiPropertyOptional({ description: '체류 시간 (초)' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  duration?: number;

  @ApiPropertyOptional({ description: '스크롤 깊이 (%)' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  scrollDepth?: number;

  @ApiPropertyOptional({ description: '클릭 수' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  clickCount?: number;
}
