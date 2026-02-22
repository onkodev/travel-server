import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsInt,
  IsOptional,
  IsArray,
  IsBoolean,
  MaxLength,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationQueryDto } from '../../../common/dto';

export class OdkTourListDto {
  @ApiProperty({ description: 'ID' })
  id: number;

  @ApiProperty({ description: '영문 이름' })
  name: string;

  @ApiPropertyOptional({ description: '한글 이름' })
  nameKor?: string;

  @ApiProperty({ description: 'slug' })
  slug: string;

  @ApiPropertyOptional({ description: '설명' })
  description?: string;

  @ApiPropertyOptional({ description: '썸네일 URL' })
  thumbnailUrl?: string;

  @ApiProperty({ description: '웹사이트 URL' })
  websiteUrl: string;

  @ApiPropertyOptional({ description: '가격' })
  price?: number;

  @ApiPropertyOptional({ description: '지역' })
  region?: string;

  @ApiPropertyOptional({ description: '소요시간' })
  duration?: string;

  @ApiPropertyOptional({ description: '태그', type: [String] })
  tags?: string[];

  @ApiPropertyOptional({ description: '별점 (5.00)' })
  rating?: number;

  @ApiPropertyOptional({ description: '리뷰 수' })
  reviewCount?: number;

  @ApiPropertyOptional({ description: '사이트 카테고리' })
  category?: string;

  @ApiPropertyOptional({ description: '마지막 크롤링 시각' })
  lastSyncedAt?: string;

  @ApiProperty({ description: '우선순위 (0~10, 높을수록 먼저 노출)' })
  sortOrder: number;

  @ApiProperty({ description: '활성 상태' })
  isActive: boolean;

  @ApiProperty({ description: '생성일' })
  createdAt: string;

  @ApiProperty({ description: '수정일' })
  updatedAt: string;
}

export class OdkTourListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: '검색어 (이름, 설명)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ description: '지역 필터' })
  @IsOptional()
  @IsString()
  region?: string;

  @ApiPropertyOptional({ description: '활성 상태 필터' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;
}

export class CreateOdkTourListDto {
  @ApiProperty({ description: '영문 이름' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: '한글 이름' })
  @IsOptional()
  @IsString()
  nameKor?: string;

  @ApiProperty({ description: 'slug (URL용)' })
  @IsString()
  slug: string;

  @ApiPropertyOptional({ description: '설명' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: '썸네일 URL' })
  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  @ApiProperty({ description: '웹사이트 URL' })
  @IsString()
  websiteUrl: string;

  @ApiPropertyOptional({ description: '가격' })
  @IsOptional()
  @IsNumber()
  price?: number;

  @ApiPropertyOptional({ description: '지역' })
  @IsOptional()
  @IsString()
  region?: string;

  @ApiPropertyOptional({ description: '소요시간' })
  @IsOptional()
  @IsString()
  duration?: string;

  @ApiPropertyOptional({ description: '태그', type: [String] })
  @IsOptional()
  @IsArray()
  tags?: string[];

  @ApiPropertyOptional({ description: '우선순위 (0~10)', default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  sortOrder?: number;

  @ApiPropertyOptional({ description: '활성 상태', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateOdkTourListDto {
  @ApiPropertyOptional({ description: '영문 이름' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: '한글 이름' })
  @IsOptional()
  @IsString()
  nameKor?: string;

  @ApiPropertyOptional({ description: '설명' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: '별점 (5.00)' })
  @IsOptional()
  @IsNumber()
  rating?: number;

  @ApiPropertyOptional({ description: '리뷰 수' })
  @IsOptional()
  @IsInt()
  reviewCount?: number;

  @ApiPropertyOptional({ description: '사이트 카테고리' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: '썸네일 URL' })
  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  @ApiPropertyOptional({ description: '웹사이트 URL' })
  @IsOptional()
  @IsString()
  websiteUrl?: string;

  @ApiPropertyOptional({ description: '가격' })
  @IsOptional()
  @IsNumber()
  price?: number;

  @ApiPropertyOptional({ description: '지역' })
  @IsOptional()
  @IsString()
  region?: string;

  @ApiPropertyOptional({ description: '소요시간' })
  @IsOptional()
  @IsString()
  duration?: string;

  @ApiPropertyOptional({ description: '태그', type: [String] })
  @IsOptional()
  @IsArray()
  tags?: string[];

  @ApiPropertyOptional({ description: '우선순위 (0~10)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  sortOrder?: number;

  @ApiPropertyOptional({ description: '활성 상태' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
