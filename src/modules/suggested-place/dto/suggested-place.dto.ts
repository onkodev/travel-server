import { IsOptional, IsString, IsInt, IsArray, Min, Max, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class SuggestedPlaceQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: '상태 필터' })
  @IsOptional()
  @IsString()
  status?: string; // pending | added | ignored

  @ApiPropertyOptional({ description: '지역 필터' })
  @IsOptional()
  @IsString()
  region?: string;

  @ApiPropertyOptional({ description: '검색어' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: '정렬 기준', default: 'count' })
  @IsOptional()
  @IsString()
  sortBy?: 'count' | 'lastSeenAt' | 'createdAt' | 'bestMatchScore';

  @ApiPropertyOptional({ description: '정렬 방향', default: 'desc' })
  @IsOptional()
  @IsString()
  sortDir?: 'asc' | 'desc';
}

export class SuggestedPlaceUpdateStatusDto {
  @ApiProperty({ description: '상태' })
  @IsString()
  status: string; // pending | added | ignored

  @ApiPropertyOptional({ description: '연결된 Item ID' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  linkedItemId?: number;
}

export class SuggestedPlaceBulkStatusDto {
  @ApiProperty({ description: 'ID 목록' })
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  ids: number[];

  @ApiProperty({ description: '상태' })
  @IsString()
  status: string;
}

export class AddToItemDto {
  @ApiProperty({ description: '아이템 타입', default: 'place' })
  @IsString()
  type: string;

  @ApiProperty({ description: '영문 이름' })
  @IsString()
  nameEng: string;

  @ApiProperty({ description: '한글 이름' })
  @IsString()
  nameKor: string;

  @ApiPropertyOptional({ description: '지역' })
  @IsOptional()
  @IsString()
  region?: string;

  @ApiPropertyOptional({ description: '설명' })
  @IsOptional()
  @IsString()
  description?: string;
}

export class ApproveMatchDto {
  @ApiProperty({ description: '매칭할 Item ID' })
  @Type(() => Number)
  @IsInt()
  itemId: number;
}

export class AddFromTourApiDto {
  @ApiProperty({ description: 'Tour API contentId' })
  @IsString()
  contentId: string;

  @ApiProperty({ description: 'Tour API 아이템 데이터' })
  itemData: Record<string, unknown>;
}

export class EnhancedStatsQueryDto {
  @ApiPropertyOptional({ description: '기간 (일)', default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;
}
