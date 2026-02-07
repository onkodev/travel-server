import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsOptional,
  IsArray,
  IsIn,
  ValidateNested,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationQueryDto } from '../../../common/dto';

/**
 * 투어 일정 아이템
 */
export class TourItineraryItemDto {
  @ApiPropertyOptional({ description: '일정 순서' })
  @IsOptional()
  @IsNumber()
  order?: number;

  @ApiPropertyOptional({ description: '시간' })
  @IsOptional()
  @IsString()
  time?: string;

  @ApiPropertyOptional({ description: '장소명' })
  @IsOptional()
  @IsString()
  place?: string;

  @ApiPropertyOptional({ description: '설명' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: '소요 시간 (분)' })
  @IsOptional()
  @IsNumber()
  duration?: number;
}

export class TourDto {
  @ApiProperty({ description: '투어 ID' })
  id: number;

  @ApiProperty({ description: '투어 제목' })
  title: string;

  @ApiPropertyOptional({ description: '투어 설명' })
  description?: string;

  @ApiPropertyOptional({ description: '썸네일 URL' })
  thumbnailUrl?: string;

  @ApiProperty({ description: '소요 시간 (분)' })
  durationMinutes: number;

  @ApiProperty({ description: '가격' })
  price: number;

  @ApiPropertyOptional({ description: '통화', default: 'KRW' })
  currency?: string;

  @ApiPropertyOptional({ description: '카테고리' })
  category?: string;

  @ApiPropertyOptional({ description: '태그 목록', type: [String] })
  tags?: string[];

  @ApiProperty({
    description: '상태',
    enum: ['draft', 'published', 'archived'],
  })
  status: string;

  @ApiPropertyOptional({ description: '조회수' })
  viewCount?: number;

  @ApiPropertyOptional({ description: '리뷰 수' })
  reviewCount?: number;

  @ApiPropertyOptional({ description: '평균 평점' })
  averageRating?: number;
}

export class PublicTourQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: '카테고리 필터' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({
    description: '태그 필터 (쉼표로 구분)',
    example: 'culture,food',
  })
  @IsOptional()
  @IsString()
  tags?: string;

  @ApiPropertyOptional({ description: '검색어', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({
    description: '데이터 소스',
    enum: ['auth', 'admin'],
    example: 'admin',
  })
  @IsOptional()
  @IsIn(['auth', 'admin'])
  source?: string;
}

export class AdminTourQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: '상태 필터',
    enum: ['draft', 'published', 'archived', 'all'],
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: '검색어', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}

export class CreateTourDto {
  @ApiProperty({ description: '투어 제목' })
  @IsString()
  title: string;

  @ApiPropertyOptional({ description: '투어 설명' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: '썸네일 URL' })
  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  @ApiProperty({ description: '소요 시간 (분)' })
  @IsNumber()
  durationMinutes: number;

  @ApiProperty({ description: '가격' })
  @IsNumber()
  price: number;

  @ApiPropertyOptional({ description: '통화', default: 'KRW' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ description: '카테고리' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: '태그 목록', type: [String] })
  @IsOptional()
  @IsArray()
  tags?: string[];

  @ApiPropertyOptional({
    description: '상태',
    enum: ['draft', 'published'],
    default: 'draft',
  })
  @IsOptional()
  @IsIn(['draft', 'published'])
  status?: string;
}

export class UpdateTourDto {
  @ApiPropertyOptional({ description: '투어 제목' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ description: '부제목' })
  @IsOptional()
  @IsString()
  subtitle?: string;

  @ApiPropertyOptional({ description: '투어 설명' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: '썸네일 URL' })
  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  @ApiPropertyOptional({ description: '이미지 URL 목록', type: [String] })
  @IsOptional()
  @IsArray()
  imageUrls?: string[];

  @ApiPropertyOptional({ description: '소요 시간 (분)' })
  @IsOptional()
  @IsNumber()
  durationMinutes?: number;

  @ApiPropertyOptional({ description: '가격' })
  @IsOptional()
  @IsNumber()
  price?: number;

  @ApiPropertyOptional({ description: '통화' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ description: '미팅 포인트' })
  @IsOptional()
  @IsString()
  meetingPoint?: string;

  @ApiPropertyOptional({ description: '위도' })
  @IsOptional()
  @IsNumber()
  latitude?: number;

  @ApiPropertyOptional({ description: '경도' })
  @IsOptional()
  @IsNumber()
  longitude?: number;

  @ApiPropertyOptional({ description: '포함 항목', type: [String] })
  @IsOptional()
  @IsArray()
  includedItems?: string[];

  @ApiPropertyOptional({ description: '불포함 항목', type: [String] })
  @IsOptional()
  @IsArray()
  excludedItems?: string[];

  @ApiPropertyOptional({ description: '카테고리' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: '태그 목록', type: [String] })
  @IsOptional()
  @IsArray()
  tags?: string[];

  @ApiPropertyOptional({ description: '참고사항' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    description: '일정 목록',
    type: [TourItineraryItemDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TourItineraryItemDto)
  itinerary?: TourItineraryItemDto[];

  @ApiPropertyOptional({ description: '최소 인원' })
  @IsOptional()
  @IsNumber()
  minParticipants?: number;

  @ApiPropertyOptional({ description: '최대 인원' })
  @IsOptional()
  @IsNumber()
  maxParticipants?: number;

  @ApiPropertyOptional({ description: '예약 마감 시간 (시간 전)' })
  @IsOptional()
  @IsNumber()
  bookingCutoffHours?: number;

  @ApiPropertyOptional({ description: '차단된 날짜 목록', type: [String] })
  @IsOptional()
  @IsArray()
  blockedDates?: string[];

  @ApiPropertyOptional({ description: '차단된 요일 목록', type: [Number] })
  @IsOptional()
  @IsArray()
  blockedWeekdays?: number[];

  @ApiPropertyOptional({
    description: '상태',
    enum: ['draft', 'published', 'archived'],
  })
  @IsOptional()
  @IsIn(['draft', 'published', 'archived'])
  status?: string;
}
