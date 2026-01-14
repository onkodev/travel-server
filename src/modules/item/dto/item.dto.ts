import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNumber, IsOptional, IsArray, IsIn } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto';

export class ItemDto {
  @ApiProperty({ description: '아이템 ID' })
  id: number;

  @ApiProperty({ description: '아이템 이름' })
  name: string;

  @ApiPropertyOptional({ description: '아이템 설명' })
  description?: string;

  @ApiProperty({
    description: '아이템 타입',
    enum: ['place', 'accommodation', 'transportation', 'contents'],
  })
  type: string;

  @ApiPropertyOptional({ description: '지역' })
  region?: string;

  @ApiPropertyOptional({ description: '주소' })
  address?: string;

  @ApiPropertyOptional({ description: '위도' })
  latitude?: number;

  @ApiPropertyOptional({ description: '경도' })
  longitude?: number;

  @ApiProperty({ description: '가격' })
  price: number;

  @ApiPropertyOptional({ description: '통화', default: 'KRW' })
  currency?: string;

  @ApiPropertyOptional({ description: '이미지 URL 목록', type: [String] })
  imageUrls?: string[];

  @ApiPropertyOptional({ description: '태그 목록', type: [String] })
  tags?: string[];

  @ApiProperty({ description: '생성일' })
  createdAt: string;
}

export class ItemQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: '아이템 타입 필터',
    enum: ['place', 'accommodation', 'transportation', 'contents', 'service'],
  })
  @IsOptional()
  @IsIn(['place', 'accommodation', 'transportation', 'contents', 'service'])
  type?: string;

  @ApiPropertyOptional({ description: '지역 필터' })
  @IsOptional()
  @IsString()
  region?: string;

  @ApiPropertyOptional({ description: '검색어 (이름, 설명)' })
  @IsOptional()
  @IsString()
  search?: string;
}

export class CreateItemDto {
  @ApiProperty({
    description: '아이템 타입',
    enum: ['place', 'accommodation', 'transportation', 'contents', 'service'],
  })
  @IsIn(['place', 'accommodation', 'transportation', 'contents', 'service'])
  type: string;

  @ApiProperty({ description: '한글 이름', example: '서울 남산타워' })
  @IsString()
  nameKor: string;

  @ApiProperty({ description: '영문 이름', example: 'Seoul Namsan Tower' })
  @IsString()
  nameEng: string;

  @ApiPropertyOptional({ description: '한글 설명' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: '영문 설명' })
  @IsOptional()
  @IsString()
  descriptionEng?: string;

  @ApiProperty({ description: '기본 가격', default: 0 })
  @IsNumber()
  price: number;

  @ApiPropertyOptional({ description: '평일 가격' })
  @IsOptional()
  @IsNumber()
  weekdayPrice?: number;

  @ApiPropertyOptional({ description: '주말 가격' })
  @IsOptional()
  @IsNumber()
  weekendPrice?: number;

  @ApiPropertyOptional({ description: '지역' })
  @IsOptional()
  @IsString()
  region?: string;

  @ApiPropertyOptional({ description: '세부 지역' })
  @IsOptional()
  @IsString()
  area?: string;

  @ApiPropertyOptional({ description: '주소' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ description: '영문 주소' })
  @IsOptional()
  @IsString()
  addressEnglish?: string;

  @ApiPropertyOptional({ description: '위도', default: 0 })
  @IsOptional()
  @IsNumber()
  lat?: number;

  @ApiPropertyOptional({ description: '경도', default: 0 })
  @IsOptional()
  @IsNumber()
  lng?: number;

  @ApiPropertyOptional({ description: '웹사이트 링크' })
  @IsOptional()
  @IsString()
  websiteLink?: string;

  @ApiPropertyOptional({ description: '이미지 목록 (JSON)', type: Object })
  @IsOptional()
  images?: string[];

  @ApiPropertyOptional({ description: '카테고리 목록', type: [String] })
  @IsOptional()
  @IsArray()
  categories?: string[];

  @ApiPropertyOptional({ description: '검색 키워드' })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiPropertyOptional({ description: '한국관광공사 API 콘텐츠 ID' })
  @IsOptional()
  @IsString()
  tourApiContentId?: string;

  @ApiPropertyOptional({ description: '추가 메타데이터', type: Object })
  @IsOptional()
  metadata?: object;
}

export class UpdateItemDto {
  @ApiPropertyOptional({
    description: '아이템 타입',
    enum: ['place', 'accommodation', 'transportation', 'contents', 'service'],
  })
  @IsOptional()
  @IsIn(['place', 'accommodation', 'transportation', 'contents', 'service'])
  type?: string;

  @ApiPropertyOptional({ description: '한글 이름' })
  @IsOptional()
  @IsString()
  nameKor?: string;

  @ApiPropertyOptional({ description: '영문 이름' })
  @IsOptional()
  @IsString()
  nameEng?: string;

  @ApiPropertyOptional({ description: '한글 설명' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: '영문 설명' })
  @IsOptional()
  @IsString()
  descriptionEng?: string;

  @ApiPropertyOptional({ description: '기본 가격' })
  @IsOptional()
  @IsNumber()
  price?: number;

  @ApiPropertyOptional({ description: '평일 가격' })
  @IsOptional()
  @IsNumber()
  weekdayPrice?: number;

  @ApiPropertyOptional({ description: '주말 가격' })
  @IsOptional()
  @IsNumber()
  weekendPrice?: number;

  @ApiPropertyOptional({ description: '지역' })
  @IsOptional()
  @IsString()
  region?: string;

  @ApiPropertyOptional({ description: '세부 지역' })
  @IsOptional()
  @IsString()
  area?: string;

  @ApiPropertyOptional({ description: '주소' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ description: '영문 주소' })
  @IsOptional()
  @IsString()
  addressEnglish?: string;

  @ApiPropertyOptional({ description: '위도' })
  @IsOptional()
  @IsNumber()
  lat?: number;

  @ApiPropertyOptional({ description: '경도' })
  @IsOptional()
  @IsNumber()
  lng?: number;

  @ApiPropertyOptional({ description: '웹사이트 링크' })
  @IsOptional()
  @IsString()
  websiteLink?: string;

  @ApiPropertyOptional({ description: '이미지 목록 (JSON)', type: Object })
  @IsOptional()
  images?: string[];

  @ApiPropertyOptional({ description: '카테고리 목록', type: [String] })
  @IsOptional()
  @IsArray()
  categories?: string[];

  @ApiPropertyOptional({ description: '검색 키워드' })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiPropertyOptional({ description: '추가 메타데이터', type: Object })
  @IsOptional()
  metadata?: object;
}
