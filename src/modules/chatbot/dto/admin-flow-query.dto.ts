import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsInt, Min, Max, IsIn, IsString, MaxLength, IsBoolean } from 'class-validator';
import { Transform } from 'class-transformer';

export class AdminFlowQueryDto {
  @ApiPropertyOptional({ description: '페이지 번호', example: 1, minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: '페이지당 개수', example: 20, minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ description: '완료 여부 필터' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' ? true : value === 'false' ? false : undefined)
  @IsBoolean()
  isCompleted?: boolean;

  @ApiPropertyOptional({ description: '시작일 필터 (YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  startDate?: string;

  @ApiPropertyOptional({ description: '종료일 필터 (YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  endDate?: string;

  @ApiPropertyOptional({ description: 'UTM 소스 필터' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  utmSource?: string;

  @ApiPropertyOptional({ description: '정렬 컬럼' })
  @IsOptional()
  @IsString()
  @IsIn(['createdAt', 'updatedAt', 'currentStep', 'isCompleted'])
  sortColumn?: string;

  @ApiPropertyOptional({ description: '정렬 방향', enum: ['asc', 'desc'] })
  @IsOptional()
  @IsString()
  @IsIn(['asc', 'desc'])
  sortDirection?: string;

  @ApiPropertyOptional({ description: '견적 상태 필터' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  estimateStatus?: string;

  @ApiPropertyOptional({ description: '견적 유무 필터' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' ? true : value === 'false' ? false : undefined)
  @IsBoolean()
  hasEstimate?: boolean;
}
