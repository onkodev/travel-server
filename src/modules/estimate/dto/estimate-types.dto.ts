import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * 이미지 정보
 */
export class ImageDto {
  @ApiProperty({ description: '이미지 URL' })
  @IsString()
  url: string;

  @ApiPropertyOptional({ description: '이미지 타입' })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({ description: '이미지 alt 텍스트' })
  @IsOptional()
  @IsString()
  alt?: string;
}

/**
 * 견적 아이템 정보 (아이템 상세)
 */
export class EstimateItemInfoDto {
  @ApiPropertyOptional({ description: '한글 이름' })
  @IsOptional()
  @IsString()
  nameKor?: string;

  @ApiPropertyOptional({ description: '영문 이름' })
  @IsOptional()
  @IsString()
  nameEng?: string;

  @ApiPropertyOptional({ description: '영문 설명' })
  @IsOptional()
  @IsString()
  descriptionEng?: string;

  @ApiPropertyOptional({ description: '이미지 목록', type: [ImageDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImageDto)
  images?: ImageDto[];

  @ApiPropertyOptional({ description: '위도' })
  @IsOptional()
  @IsNumber()
  lat?: number;

  @ApiPropertyOptional({ description: '경도' })
  @IsOptional()
  @IsNumber()
  lng?: number;

  @ApiPropertyOptional({ description: '영문 주소' })
  @IsOptional()
  @IsString()
  addressEnglish?: string;
}

/**
 * 견적 아이템 (확장)
 */
export class EstimateItemExtendedDto {
  @ApiPropertyOptional({ description: '아이템 ID' })
  @IsOptional()
  @IsNumber()
  itemId?: number;

  @ApiPropertyOptional({ description: '아이템 타입' })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({ description: '아이템 이름' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: '가격' })
  @IsOptional()
  @IsNumber()
  price?: number;

  @ApiPropertyOptional({ description: '수량' })
  @IsOptional()
  @IsNumber()
  quantity?: number;

  @ApiPropertyOptional({ description: '소계' })
  @IsOptional()
  @IsNumber()
  subtotal?: number;

  @ApiPropertyOptional({ description: '날짜' })
  @IsOptional()
  @IsString()
  date?: string;

  @ApiPropertyOptional({ description: '일자 번호' })
  @IsOptional()
  @IsNumber()
  dayNumber?: number;

  @ApiPropertyOptional({ description: '노트' })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({
    description: '아이템 상세 정보',
    type: EstimateItemInfoDto,
  })
  @IsOptional()
  itemInfo?: EstimateItemInfoDto;
}

/**
 * 표시 옵션
 */
export class DisplayOptionsDto {
  @ApiPropertyOptional({ description: '가격 표시 여부' })
  @IsOptional()
  @IsBoolean()
  showPrice?: boolean;

  @ApiPropertyOptional({ description: '상세 가격 표시 여부' })
  @IsOptional()
  @IsBoolean()
  showDetailedPrice?: boolean;

  @ApiPropertyOptional({ description: '일자별 합계 표시 여부' })
  @IsOptional()
  @IsBoolean()
  showDayTotal?: boolean;

  @ApiPropertyOptional({ description: '지도 표시 여부' })
  @IsOptional()
  @IsBoolean()
  showMap?: boolean;

  @ApiPropertyOptional({ description: '이미지 표시 여부' })
  @IsOptional()
  @IsBoolean()
  showImages?: boolean;
}

/**
 * 타임라인 항목
 */
export class TimelineEntryDto {
  @ApiPropertyOptional({ description: '일자 번호' })
  @IsOptional()
  @IsNumber()
  dayNumber?: number;

  @ApiPropertyOptional({ description: '날짜' })
  @IsOptional()
  @IsString()
  date?: string;

  @ApiPropertyOptional({ description: '아이템 ID 목록', type: [Number] })
  @IsOptional()
  @IsArray()
  itemIds?: number[];
}

/**
 * 수정 이력
 */
export class RevisionHistoryEntryDto {
  @ApiPropertyOptional({ description: '수정 일시' })
  @IsOptional()
  @IsString()
  timestamp?: string;

  @ApiPropertyOptional({ description: '수정 내용' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: '수정자' })
  @IsOptional()
  @IsString()
  modifiedBy?: string;
}
