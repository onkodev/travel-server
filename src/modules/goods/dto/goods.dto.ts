import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsOptional,
  IsArray,
  IsIn,
  IsBoolean,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto';

// 굿즈 카테고리
export const GOODS_CATEGORIES = ['apparel', 'accessories', 'drinkware', 'stationery', 'other'] as const;
export type GoodsCategory = (typeof GOODS_CATEGORIES)[number];

// 굿즈 상태
export const GOODS_STATUS = ['draft', 'active', 'inactive', 'soldout'] as const;
export type GoodsStatus = (typeof GOODS_STATUS)[number];

// 옵션 타입 정의
export interface GoodsVariant {
  [key: string]: string | number;
}

export interface GoodsOptions {
  types?: string[];
  variants?: GoodsVariant[];
}

export class GoodsDto {
  @ApiProperty({ description: '굿즈 ID' })
  id: number;

  @ApiProperty({ description: '영문 이름' })
  name: string;

  @ApiPropertyOptional({ description: '한글 이름' })
  nameKor?: string;

  @ApiPropertyOptional({ description: '설명' })
  description?: string;

  @ApiProperty({ description: '카테고리', enum: GOODS_CATEGORIES })
  category: GoodsCategory;

  @ApiPropertyOptional({ description: '썸네일 URL' })
  thumbnailUrl?: string;

  @ApiPropertyOptional({ description: '이미지 URL 목록', type: [String] })
  imageUrls?: string[];

  @ApiProperty({ description: '가격' })
  price: number;

  @ApiPropertyOptional({ description: '통화', default: 'USD' })
  currency?: string;

  @ApiProperty({ description: '재고' })
  stock: number;

  @ApiPropertyOptional({ description: '옵션 (사이즈, 색상 등)' })
  options?: GoodsOptions;

  @ApiPropertyOptional({ description: '태그 목록', type: [String] })
  tags?: string[];

  @ApiProperty({ description: '상태', enum: GOODS_STATUS })
  status: GoodsStatus;

  @ApiProperty({ description: '추천 상품 여부' })
  isFeatured: boolean;

  @ApiProperty({ description: '조회수' })
  viewCount: number;

  @ApiProperty({ description: '생성일' })
  createdAt: string;
}

export class GoodsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: '카테고리 필터',
    enum: GOODS_CATEGORIES,
  })
  @IsOptional()
  @IsIn(GOODS_CATEGORIES)
  category?: GoodsCategory;

  @ApiPropertyOptional({
    description: '상태 필터',
    enum: GOODS_STATUS,
  })
  @IsOptional()
  @IsIn(GOODS_STATUS)
  status?: GoodsStatus;

  @ApiPropertyOptional({ description: '추천 상품만' })
  @IsOptional()
  @IsBoolean()
  featured?: boolean;

  @ApiPropertyOptional({ description: '검색어 (이름, 설명)' })
  @IsOptional()
  @IsString()
  search?: string;
}

export class CreateGoodsDto {
  @ApiProperty({ description: '영문 이름', example: 'Korea T-Shirt' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: '한글 이름', example: '코리아 티셔츠' })
  @IsOptional()
  @IsString()
  nameKor?: string;

  @ApiPropertyOptional({ description: '설명' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: '카테고리', enum: GOODS_CATEGORIES })
  @IsIn(GOODS_CATEGORIES)
  category: GoodsCategory;

  @ApiPropertyOptional({ description: '썸네일 URL' })
  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  @ApiPropertyOptional({ description: '이미지 URL 목록', type: [String] })
  @IsOptional()
  @IsArray()
  imageUrls?: string[];

  @ApiProperty({ description: '가격', default: 0 })
  @IsNumber()
  price: number;

  @ApiPropertyOptional({ description: '통화', default: 'USD' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ description: '재고', default: 0 })
  @IsOptional()
  @IsNumber()
  stock?: number;

  @ApiPropertyOptional({ description: '옵션 (사이즈, 색상 등)', type: Object })
  @IsOptional()
  options?: GoodsOptions;

  @ApiPropertyOptional({ description: '태그 목록', type: [String] })
  @IsOptional()
  @IsArray()
  tags?: string[];

  @ApiPropertyOptional({ description: '상태', enum: GOODS_STATUS, default: 'draft' })
  @IsOptional()
  @IsIn(GOODS_STATUS)
  status?: GoodsStatus;

  @ApiPropertyOptional({ description: '추천 상품 여부', default: false })
  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;
}

export class UpdateGoodsDto {
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

  @ApiPropertyOptional({ description: '카테고리', enum: GOODS_CATEGORIES })
  @IsOptional()
  @IsIn(GOODS_CATEGORIES)
  category?: GoodsCategory;

  @ApiPropertyOptional({ description: '썸네일 URL' })
  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  @ApiPropertyOptional({ description: '이미지 URL 목록', type: [String] })
  @IsOptional()
  @IsArray()
  imageUrls?: string[];

  @ApiPropertyOptional({ description: '가격' })
  @IsOptional()
  @IsNumber()
  price?: number;

  @ApiPropertyOptional({ description: '통화' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ description: '재고' })
  @IsOptional()
  @IsNumber()
  stock?: number;

  @ApiPropertyOptional({ description: '옵션 (사이즈, 색상 등)', type: Object })
  @IsOptional()
  options?: GoodsOptions;

  @ApiPropertyOptional({ description: '태그 목록', type: [String] })
  @IsOptional()
  @IsArray()
  tags?: string[];

  @ApiPropertyOptional({ description: '상태', enum: GOODS_STATUS })
  @IsOptional()
  @IsIn(GOODS_STATUS)
  status?: GoodsStatus;

  @ApiPropertyOptional({ description: '추천 상품 여부' })
  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;
}
