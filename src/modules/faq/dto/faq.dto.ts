import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsOptional,
  IsIn,
  IsArray,
  IsUUID,
  MaxLength,
  MinLength,
  Min,
  Max,
  ArrayMinSize,
  ArrayMaxSize,
  ValidateNested,
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
// FAQ DTOs
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

  @ApiPropertyOptional({ description: '카테고리', enum: FAQ_CATEGORIES })
  @IsOptional()
  @IsIn([...FAQ_CATEGORIES])
  category?: string;
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

  @ApiPropertyOptional({ description: '카테고리', enum: FAQ_CATEGORIES })
  @IsOptional()
  @IsIn([...FAQ_CATEGORIES])
  category?: string;
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

  @ApiProperty({
    description: '액션',
    enum: ['approve', 'reject', 'delete', 'setCategory'],
  })
  @IsIn(['approve', 'reject', 'delete', 'setCategory'])
  action: 'approve' | 'reject' | 'delete' | 'setCategory';

  @ApiPropertyOptional({ description: '거절 사유 (reject 시)' })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional({
    description: '카테고리 (setCategory 시)',
    enum: FAQ_CATEGORIES,
  })
  @IsOptional()
  @IsIn([...FAQ_CATEGORIES])
  category?: string;
}

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
  @ApiProperty({ description: '중복 체크할 질문' })
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
// FAQ Chat DTO
// ============================================================================

class FaqChatHistoryItem {
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  @IsString()
  content: string;
}

export class FaqChatDto {
  @ApiProperty({ description: '사용자 메시지' })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  message: string;

  @ApiPropertyOptional({ description: '대화 이력 (멀티턴)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => FaqChatHistoryItem)
  history?: FaqChatHistoryItem[];

  @ApiPropertyOptional({ description: '방문자 ID (UUID)' })
  @IsOptional()
  @IsUUID()
  visitorId?: string;
}

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
