import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsOptional,
  IsIn,
  IsUUID,
  MaxLength,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationQueryDto } from '../../../common/dto';

// ============================================================================
// FAQ Chat Log DTOs
// ============================================================================

export class FaqChatLogQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'No Match 필터' })
  @IsOptional()
  @IsString()
  noMatch?: string;

  @ApiPropertyOptional({ description: '시작일' })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ description: '종료일' })
  @IsOptional()
  @IsString()
  endDate?: string;

  @ApiPropertyOptional({ description: '검색어 (질문 내용)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({
    description: '응답 유형',
    enum: ['direct', 'rag', 'no_match'],
  })
  @IsOptional()
  @IsIn(['direct', 'rag', 'no_match'])
  responseTier?: string;

  @ApiPropertyOptional({ description: '방문자 ID (UUID)' })
  @IsOptional()
  @IsUUID()
  visitorId?: string;
}

// ============================================================================
// Auto Review DTO
// ============================================================================

export class AutoReviewFaqsDto {
  @ApiPropertyOptional({ description: '배치 크기 (기본 100)', default: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(10)
  @Max(200)
  batchSize?: number;

  @ApiPropertyOptional({
    description: 'true일 경우 실제 DB 변경 없이 결과만 반환',
    default: false,
  })
  @IsOptional()
  @Type(() => Boolean)
  dryRun?: boolean;
}

// ============================================================================
// Duplicate DTOs
// ============================================================================

export class ScanDuplicatesDto {
  @ApiPropertyOptional({ description: '유사도 임계값 (기본 0.96)', default: 0.96 })
  @IsOptional()
  @Type(() => Number)
  @Min(0.7)
  @Max(1.0)
  threshold?: number;

  @ApiPropertyOptional({ description: '최대 결과 수 (기본 100)', default: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(500)
  limit?: number;
}

export class CheckDuplicateDto {
  @ApiPropertyOptional({ description: '중복 체크할 질문' })
  @IsString()
  @MaxLength(500)
  question: string;

  @ApiPropertyOptional({ description: '유사도 임계값 (기본 0.8)', default: 0.8 })
  @IsOptional()
  @Type(() => Number)
  @Min(0.5)
  @Max(1.0)
  threshold?: number;

  @ApiPropertyOptional({ description: '제외할 FAQ ID (편집 시 자기 자신 제외)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  excludeId?: number;
}
