import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsOptional,
  IsArray,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AnalyzeEstimateDto {
  @ApiProperty({ description: '분석할 견적 요청 내용' })
  @IsString()
  content: string;
}

export class AnalyzeEstimateResponseDto {
  @ApiProperty({ description: '추출된 목적지' })
  destination: string;

  @ApiProperty({ description: '추출된 여행 기간 (일)' })
  days: number;

  @ApiPropertyOptional({ description: '추출된 인원 수' })
  travelers?: number;

  @ApiPropertyOptional({ description: '추출된 관심사', type: [String] })
  interests?: string[];

  @ApiPropertyOptional({ description: '추가 요청 사항' })
  additionalRequests?: string;
}

export class GenerateTimelineDto {
  @ApiProperty({ description: '여행 목적지', example: '제주도' })
  @IsString()
  destination: string;

  @ApiProperty({ description: '여행 일수', example: 3 })
  @IsNumber()
  days: number;

  @ApiPropertyOptional({ description: '관심사 목록', type: [String] })
  @IsOptional()
  @IsArray()
  interests?: string[];

  @ApiPropertyOptional({ description: '포함할 아이템 목록' })
  @IsOptional()
  @IsArray()
  items?: any[];
}

export class GenerateItemContentDto {
  @ApiProperty({ description: '아이템 이름', example: '서울 남산타워' })
  @IsString()
  name: string;

  @ApiProperty({ description: '아이템 타입', example: 'place' })
  @IsString()
  type: string;

  @ApiPropertyOptional({ description: '주소' })
  @IsOptional()
  @IsString()
  address?: string;
}

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
