import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsOptional,
  IsIn,
  MaxLength,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationQueryDto } from '../../../common/dto';

// ============================================================================
// FAQ Categories
// ============================================================================

export const FAQ_CATEGORIES = [
  'general',
  'booking',
  'tour',
  'payment',
  'transportation',
  'accommodation',
  'visa',
  'other',
] as const;
export type FaqCategory = (typeof FAQ_CATEGORIES)[number];

// ============================================================================
// Query DTOs
// ============================================================================

export class FaqQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: '상태 필터',
    enum: ['pending', 'needs_review', 'approved', 'rejected'],
  })
  @IsOptional()
  @IsIn(['pending', 'needs_review', 'approved', 'rejected'])
  status?: string;

  @ApiPropertyOptional({ description: '소스 필터', enum: ['manual', 'gmail'] })
  @IsOptional()
  @IsIn(['manual', 'gmail'])
  source?: string;

  @ApiPropertyOptional({
    description: '카테고리 필터 (__none = 미분류)',
    enum: [...FAQ_CATEGORIES, '__none'],
  })
  @IsOptional()
  @IsIn([...FAQ_CATEGORIES, '__none'])
  category?: string;

  @ApiPropertyOptional({ description: '검색어 (질문/답변)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}

export class FaqSearchQueryDto {
  @ApiProperty({ description: '검색 질문' })
  @IsString()
  @MaxLength(500)
  q: string;

  @ApiPropertyOptional({ description: '결과 수 제한', default: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(20)
  limit?: number;
}
