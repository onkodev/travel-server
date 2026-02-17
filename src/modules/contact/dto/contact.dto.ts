import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsString,
  MinLength,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * 문의 생성 요청 DTO
 */
export class CreateContactDto {
  @ApiProperty({
    description: '문의자 이름',
    example: 'John Smith',
    minLength: 1,
  })
  @IsString({ message: '이름은 문자열이어야 합니다' })
  @MinLength(1, { message: '이름을 입력해주세요' })
  name: string;

  @ApiProperty({
    description: '문의자 이메일',
    example: 'john@example.com',
    format: 'email',
  })
  @IsEmail({}, { message: '올바른 이메일 형식이 아닙니다' })
  email: string;

  @ApiProperty({
    description: '문의 내용',
    example: 'I would like to inquire about the Seoul tour package.',
    minLength: 1,
  })
  @IsString({ message: '메시지는 문자열이어야 합니다' })
  @MinLength(1, { message: '문의 내용을 입력해주세요' })
  message: string;
}

/**
 * 문의 상세 정보 DTO
 */
export class ContactDto {
  @ApiProperty({ description: '문의 ID', example: 1 })
  id: number;

  @ApiProperty({ description: '문의자 이름', example: 'John Smith' })
  name: string;

  @ApiProperty({ description: '문의자 이메일', example: 'john@example.com' })
  email: string;

  @ApiProperty({
    description: '문의 내용',
    example: 'I would like to inquire about the Seoul tour package.',
  })
  message: string;

  @ApiProperty({
    description: '처리 상태',
    example: 'pending',
    enum: ['pending', 'replied', 'closed'],
  })
  status: string;

  @ApiPropertyOptional({
    description: '답변 내용',
    example: 'Thank you for your inquiry...',
    nullable: true,
  })
  reply: string | null;

  @ApiPropertyOptional({
    description: '답변 일시',
    example: '2024-01-15T10:30:00Z',
    nullable: true,
  })
  repliedAt: Date | null;

  @ApiPropertyOptional({
    description: '답변자 ID',
    example: 'user-uuid-123',
    nullable: true,
  })
  repliedBy: string | null;

  @ApiProperty({ description: '생성 일시', example: '2024-01-15T09:00:00Z' })
  createdAt: Date;

  @ApiProperty({ description: '수정 일시', example: '2024-01-15T10:30:00Z' })
  updatedAt: Date;
}

/**
 * 문의 목록 조회 쿼리 DTO
 */
export class ContactQueryDto {
  @ApiPropertyOptional({
    description: '페이지 번호',
    default: 1,
    minimum: 1,
    example: 1,
  })
  @Type(() => Number)
  @IsInt({ message: '페이지 번호는 정수여야 합니다' })
  @Min(1, { message: '페이지 번호는 1 이상이어야 합니다' })
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({
    description: '페이지당 항목 수',
    default: 20,
    minimum: 1,
    maximum: 100,
    example: 20,
  })
  @Type(() => Number)
  @IsInt({ message: '페이지당 항목 수는 정수여야 합니다' })
  @Min(1, { message: '페이지당 항목 수는 1 이상이어야 합니다' })
  @Max(100, { message: '페이지당 항목 수는 100 이하여야 합니다' })
  @IsOptional()
  limit?: number = 20;

  @ApiPropertyOptional({
    description: '상태 필터',
    example: 'pending',
    enum: ['pending', 'replied', 'closed'],
  })
  @IsString()
  @IsIn(['pending', 'replied', 'closed'], {
    message: '올바른 상태값이 아닙니다',
  })
  @IsOptional()
  status?: string;

  @ApiPropertyOptional({
    description: '검색어 (이름, 이메일, 내용)',
    example: 'john',
  })
  @IsString()
  @IsOptional()
  search?: string;
}

/**
 * 문의 목록 응답 DTO
 */
export class ContactListDto {
  @ApiProperty({ type: [ContactDto], description: '문의 목록' })
  contacts: ContactDto[];

  @ApiProperty({ description: '전체 문의 수', example: 50 })
  total: number;
}

/**
 * 답변 작성 요청 DTO
 */
export class ReplyContactDto {
  @ApiProperty({
    description: '답변 내용',
    example: 'Thank you for your inquiry. Our Seoul tour package includes...',
    minLength: 1,
  })
  @IsString({ message: '답변은 문자열이어야 합니다' })
  @MinLength(1, { message: '답변 내용을 입력해주세요' })
  reply: string;
}

/**
 * 상태 변경 요청 DTO
 */
export class UpdateContactStatusDto {
  @ApiProperty({
    description: '변경할 상태',
    example: 'closed',
    enum: ['pending', 'replied', 'closed'],
  })
  @IsString()
  @IsIn(['pending', 'replied', 'closed'], {
    message: '올바른 상태값이 아닙니다',
  })
  status: string;
}

/**
 * 성공 응답 DTO
 */
export class ContactSuccessDto {
  @ApiProperty({ description: '성공 여부', example: true })
  success: boolean;
}
