import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsOptional,
  IsIn,
  IsArray,
  MaxLength,
  Min,
  Max,
  ArrayMinSize,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationQueryDto } from '../../../common/dto';

// ============================================================================
// FAQ DTOs
// ============================================================================

export class FaqQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: '상태 필터', enum: ['pending', 'approved', 'rejected'] })
  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected'])
  status?: string;

  @ApiPropertyOptional({ description: '소스 필터', enum: ['manual', 'gmail'] })
  @IsOptional()
  @IsIn(['manual', 'gmail'])
  source?: string;

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

export class CreateFaqDto {
  @ApiProperty({ description: '질문 (영어)' })
  @IsString()
  @MaxLength(500)
  question: string;

  @ApiProperty({ description: '답변 (영어)' })
  @IsString()
  @MaxLength(5000)
  answer: string;

  @ApiPropertyOptional({ description: '질문 (한국어)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  questionKo?: string;

  @ApiPropertyOptional({ description: '답변 (한국어)' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  answerKo?: string;

  @ApiPropertyOptional({ description: '태그' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class UpdateFaqDto {
  @ApiPropertyOptional({ description: '질문 (영어)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  question?: string;

  @ApiPropertyOptional({ description: '답변 (영어)' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  answer?: string;

  @ApiPropertyOptional({ description: '질문 (한국어)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  questionKo?: string;

  @ApiPropertyOptional({ description: '답변 (한국어)' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  answerKo?: string;

  @ApiPropertyOptional({ description: '태그' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class ApproveFaqDto {
  @ApiPropertyOptional({ description: '승인 시 질문 수정 (영어)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  question?: string;

  @ApiPropertyOptional({ description: '승인 시 답변 수정 (영어)' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  answer?: string;

  @ApiPropertyOptional({ description: '승인 시 질문 수정 (한국어)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  questionKo?: string;

  @ApiPropertyOptional({ description: '승인 시 답변 수정 (한국어)' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  answerKo?: string;
}

export class RejectFaqDto {
  @ApiPropertyOptional({ description: '거절 사유' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class BulkActionDto {
  @ApiProperty({ description: 'FAQ ID 목록' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsNumber({}, { each: true })
  ids: number[];

  @ApiProperty({ description: '액션', enum: ['approve', 'reject', 'delete'] })
  @IsIn(['approve', 'reject', 'delete'])
  action: 'approve' | 'reject' | 'delete';

  @ApiPropertyOptional({ description: '거절 사유 (reject 시)' })
  @IsOptional()
  @IsString()
  reason?: string;
}
