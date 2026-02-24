import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsOptional,
  IsIn,
  IsArray,
  MaxLength,
  ArrayMinSize,
  ArrayMaxSize,
} from 'class-validator';
import { FAQ_CATEGORIES } from './faq-query.dto';

// ============================================================================
// CRUD DTOs
// ============================================================================

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

  @ApiPropertyOptional({ description: 'AI 응답 가이드라인' })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  guideline?: string;

  @ApiPropertyOptional({ description: '참고 내용 (자동 생성)' })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  reference?: string;
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

  @ApiPropertyOptional({ description: 'AI 응답 가이드라인' })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  guideline?: string;

  @ApiPropertyOptional({ description: '참고 내용 (자동 생성)' })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  reference?: string;
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
