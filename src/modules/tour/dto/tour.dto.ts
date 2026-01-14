import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNumber, IsOptional, IsArray, IsIn } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto';

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

  @ApiPropertyOptional({ description: '검색어' })
  @IsOptional()
  @IsString()
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

  @ApiPropertyOptional({ description: '검색어' })
  @IsOptional()
  @IsString()
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

  @ApiPropertyOptional({ description: '투어 설명' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: '썸네일 URL' })
  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  @ApiPropertyOptional({ description: '소요 시간 (분)' })
  @IsOptional()
  @IsNumber()
  durationMinutes?: number;

  @ApiPropertyOptional({ description: '가격' })
  @IsOptional()
  @IsNumber()
  price?: number;

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
    enum: ['draft', 'published', 'archived'],
  })
  @IsOptional()
  @IsIn(['draft', 'published', 'archived'])
  status?: string;
}
