import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsBoolean,
  IsIn,
  IsArray,
  IsNumber,
  MaxLength,
  ArrayMaxSize,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { PaginationQueryDto } from '../../../common/dto';

export class EstimateListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: '견적 출처',
    enum: ['manual', 'ai'],
    example: 'manual',
  })
  @IsOptional()
  @IsIn(['manual', 'ai'])
  source?: string;

  @ApiPropertyOptional({
    description: '수동 견적 상태 필터',
    example: 'planning',
  })
  @IsOptional()
  @IsString()
  statusManual?: string;

  @ApiPropertyOptional({
    description: 'AI 견적 상태 필터',
    example: 'draft',
  })
  @IsOptional()
  @IsString()
  statusAi?: string;

  @ApiPropertyOptional({
    description: '제외할 수동 견적 상태',
    example: 'archived',
  })
  @IsOptional()
  @IsString()
  excludeStatusManual?: string;

  @ApiPropertyOptional({
    description: '제외할 AI 견적 상태',
    example: 'archived',
  })
  @IsOptional()
  @IsString()
  excludeStatusAi?: string;

  @ApiPropertyOptional({
    description: '통합 검색어 (제목, 고객명, 내부메모, 코멘트)',
    example: '홍길동',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({
    description: '시작일 필터 (이후)',
    example: '2024-01-01',
  })
  @IsOptional()
  @IsString()
  dateFrom?: string;

  @ApiPropertyOptional({
    description: '종료일 필터 (이전)',
    example: '2024-12-31',
  })
  @IsOptional()
  @IsString()
  dateTo?: string;

  @ApiPropertyOptional({
    description: '고정 여부 필터',
    example: true,
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === 'true' ? true : value === 'false' ? false : undefined,
  )
  @IsBoolean()
  isPinned?: boolean;

  @ApiPropertyOptional({
    description: '예정 견적 필터 (5일 이내 시작)',
    example: true,
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === 'true' ? true : value === 'false' ? false : undefined,
  )
  @IsBoolean()
  upcoming?: boolean;

  @ApiPropertyOptional({
    description: '여행 시작일 범위 (이후)',
    example: '2024-01-01',
  })
  @IsOptional()
  @IsString()
  startDateFrom?: string;

  @ApiPropertyOptional({
    description: '여행 시작일 범위 (이전)',
    example: '2024-12-31',
  })
  @IsOptional()
  @IsString()
  startDateTo?: string;

  @ApiPropertyOptional({
    description: '최소 인원수',
    example: 2,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  paxMin?: number;

  @ApiPropertyOptional({
    description: '최대 인원수',
    example: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  paxMax?: number;

  @ApiPropertyOptional({
    description: '최소 금액',
    example: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amountMin?: number;

  @ApiPropertyOptional({
    description: '최대 금액',
    example: 10000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amountMax?: number;

  @ApiPropertyOptional({
    description: '최소 여행일수',
    example: 3,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  durationMin?: number;

  @ApiPropertyOptional({
    description: '최대 여행일수',
    example: 14,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  durationMax?: number;
}

export class BatchSummariesDto {
  @ApiProperty({
    description: '견적 ID 배열',
    example: [1, 2, 3],
    type: [Number],
  })
  @IsArray()
  @IsNumber({}, { each: true })
  @ArrayMaxSize(100)
  ids: number[];
}
