import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsOptional,
  IsArray,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';

export class TourApiSearchQueryDto {
  @ApiPropertyOptional({ description: '검색 키워드' })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiPropertyOptional({ description: '지역 코드' })
  @IsOptional()
  @IsString()
  areaCode?: string;

  @ApiPropertyOptional({ description: '콘텐츠 타입 ID' })
  @IsOptional()
  @IsString()
  contentTypeId?: string;

  @ApiPropertyOptional({ description: '페이지 번호', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  pageNo?: number;
}

export class TourApiSearchDto {
  @ApiProperty({ description: '액션 타입', enum: ['search', 'add'] })
  @IsString()
  action: string;

  @ApiPropertyOptional({ description: '검색 키워드' })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiPropertyOptional({ description: '콘텐츠 타입 ID' })
  @IsOptional()
  @IsString()
  contentTypeId?: string;

  @ApiPropertyOptional({ description: '콘텐츠 ID (추가 시)' })
  @IsOptional()
  @IsString()
  contentId?: string;

  @ApiPropertyOptional({ description: '추가할 아이템 데이터' })
  @IsOptional()
  @IsObject()
  itemData?: object;
}

export class GenerateItemContentV2Dto {
  @ApiProperty({ description: '아이템 ID' })
  @IsNumber()
  itemId: number;

  @ApiProperty({ description: '한글 이름' })
  @IsString()
  nameKor: string;

  @ApiProperty({ description: '영문 이름' })
  @IsString()
  nameEng: string;

  @ApiProperty({ description: '아이템 타입' })
  @IsString()
  itemType: string;

  @ApiPropertyOptional({
    description: '기존 한글 설명 (있으면 영어 번역만 수행)',
  })
  @IsOptional()
  @IsString()
  existingDescription?: string;
}

export class AnalyzeEstimateV2Dto {
  @ApiProperty({ description: '견적 ID' })
  @IsNumber()
  estimateId: number;

  @ApiPropertyOptional({ description: '요청 내용' })
  @IsOptional()
  @IsString()
  requestContent?: string;

  @ApiProperty({ description: '견적 아이템 목록', type: [Object] })
  @IsArray()
  items: object[];
}

export class AnalyzeEstimateResponseDto {
  @ApiProperty({ description: '성공 여부' })
  success: boolean;

  @ApiProperty({ description: '추출된 지역 목록', type: [String] })
  regions: string[];

  @ApiProperty({ description: '추출된 관심사 목록', type: [String] })
  interests: string[];

  @ApiProperty({ description: '추출된 키워드 목록', type: [String] })
  keywords: string[];

  @ApiProperty({ description: '특별 요구사항', type: [String] })
  specialNeeds: string[];
}

export class GenerateTimelineV2Dto {
  @ApiProperty({ description: '일차 번호' })
  @IsNumber()
  dayNumber: number;

  @ApiPropertyOptional({ description: '날짜' })
  @IsOptional()
  @IsString()
  date?: string;

  @ApiProperty({ description: '타임라인 아이템 목록', type: [Object] })
  @IsArray()
  items: object[];
}
