import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsNumber,
  IsArray,
  IsBoolean,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { EstimateItemDto } from './estimate.dto';
import { BaseEstimateDto } from './estimate-base.dto';

/**
 * 견적 수정 DTO
 * 클라이언트에서 전체 EstimateSchema를 보내므로 모든 필드 허용
 */
export class UpdateEstimateDto extends BaseEstimateDto {
  // 읽기 전용 필드들 (서버에서 무시됨)
  @ApiPropertyOptional({ description: 'ID (서버에서 무시)' })
  @IsOptional()
  @Type(() => Number)
  id?: number;

  @ApiPropertyOptional({ description: '총 여행자 수 (서버에서 무시)' })
  @IsOptional()
  @Type(() => Number)
  totalTravelers?: number;

  @ApiPropertyOptional({ description: '제목' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ description: '고객 이메일' })
  @IsOptional()
  @IsString()
  customerEmail?: string;

  @ApiPropertyOptional({ description: '소스', enum: ['manual', 'ai'] })
  @IsOptional()
  @IsString()
  source?: string;

  @ApiPropertyOptional({ description: '여행 일수' })
  @IsOptional()
  @Type(() => Number)
  travelDays?: number;

  @ApiPropertyOptional({ description: '성인 수' })
  @IsOptional()
  @Type(() => Number)
  adultsCount?: number;

  @ApiPropertyOptional({ description: '어린이 수' })
  @IsOptional()
  @Type(() => Number)
  childrenCount?: number;

  @ApiPropertyOptional({ description: '유아 수' })
  @IsOptional()
  @Type(() => Number)
  infantsCount?: number;

  @ApiPropertyOptional({ description: '시니어 수' })
  @IsOptional()
  @Type(() => Number)
  seniorsCount?: number;

  @ApiPropertyOptional({ description: '견적 아이템 목록' })
  @IsOptional()
  @IsArray()
  items?: Record<string, unknown>[];

  @ApiPropertyOptional({ description: '소계' })
  @IsOptional()
  @Type(() => Number)
  subtotal?: number;

  @ApiPropertyOptional({ description: '수동 조정 금액' })
  @IsOptional()
  @Type(() => Number)
  manualAdjustment?: number;

  @ApiPropertyOptional({ description: '총 금액' })
  @IsOptional()
  @Type(() => Number)
  totalAmount?: number;

  @ApiPropertyOptional({
    description:
      '표시 옵션 (place, accommodation, transportation, contents, price)',
  })
  @IsOptional()
  @IsObject()
  displayOptions?: Record<string, boolean>;

  @ApiPropertyOptional({ description: '수정 이력' })
  @IsOptional()
  @IsArray()
  revisionHistory?: Record<string, unknown>[];
}

export class UpdateStatusDto {
  @ApiProperty({ description: '변경할 상태', example: 'in_progress' })
  @IsString()
  status: string;
}

export class UpdatePinnedDto {
  @ApiProperty({ description: '고정 여부', example: true })
  @IsBoolean()
  isPinned: boolean;
}

export class UpdateItemsDto {
  @ApiProperty({ description: '견적 아이템 목록', type: [EstimateItemDto] })
  @IsArray()
  items: EstimateItemDto[];
}

export class UpdateAdjustmentDto {
  @ApiProperty({ description: '조정 금액', example: 50000 })
  @IsNumber()
  amount: number;

  @ApiPropertyOptional({ description: '조정 사유', example: '특별 할인' })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class BulkDeleteDto {
  @ApiProperty({ description: '삭제할 견적 ID 목록', example: [1, 2, 3] })
  @IsArray()
  ids: number[];
}

export class BulkStatusDto {
  @ApiProperty({ description: '변경할 견적 ID 목록', example: [1, 2, 3] })
  @IsArray()
  ids: number[];

  @ApiProperty({ description: '변경할 상태', example: 'archived' })
  @IsString()
  status: string;
}
