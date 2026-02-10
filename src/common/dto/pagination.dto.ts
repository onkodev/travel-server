import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min, Max } from 'class-validator';

/**
 * 페이지네이션 요청 DTO
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({
    description: '페이지 번호',
    example: 1,
    minimum: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '페이지 번호는 정수여야 합니다' })
  @Min(1, { message: '페이지 번호는 1 이상이어야 합니다' })
  page?: number = 1;

  @ApiPropertyOptional({
    description: '페이지당 항목 수',
    example: 20,
    minimum: 1,
    maximum: 100,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '페이지당 항목 수는 정수여야 합니다' })
  @Min(1, { message: '페이지당 항목 수는 1 이상이어야 합니다' })
  @Max(100, { message: '페이지당 항목 수는 100 이하여야 합니다' })
  limit?: number = 20;
}

/**
 * 페이지네이션 메타 정보 DTO
 */
export class PaginationMetaDto {
  @ApiProperty({ description: '전체 항목 수', example: 100 })
  total: number;

  @ApiProperty({ description: '현재 페이지 번호', example: 1 })
  page: number;

  @ApiProperty({ description: '페이지당 항목 수', example: 20 })
  limit: number;

  @ApiProperty({ description: '전체 페이지 수', example: 5 })
  totalPages: number;
}

/**
 * 페이지네이션 응답 DTO 팩토리
 */
export function createPaginatedResponseDto<T>(itemType: new () => T) {
  class PaginatedResponseDto {
    @ApiProperty({ type: [itemType], description: '데이터 목록' })
    data: T[];

    @ApiProperty({ type: PaginationMetaDto, description: '페이지네이션 정보' })
    meta: PaginationMetaDto;
  }

  return PaginatedResponseDto;
}

/**
 * 페이지네이션 메타 정보 생성 헬퍼
 */
export function createPaginationMeta(
  total: number,
  page: number,
  limit: number,
): PaginationMetaDto {
  return {
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

/**
 * 페이지네이션 응답 생성 헬퍼
 */
export function createPaginatedResponse<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
): { data: T[]; meta: PaginationMetaDto } {
  return {
    data,
    meta: createPaginationMeta(total, page, limit),
  };
}

/**
 * 페이지당 최대 항목 수
 */
export const MAX_PAGE_LIMIT = 100;

/**
 * limit 안전 보정 (1~100 범위)
 */
export function safeLimit(limit: number): number {
  return Math.min(Math.max(1, limit), MAX_PAGE_LIMIT);
}

/**
 * Prisma skip 값 계산 헬퍼
 */
export function calculateSkip(page: number, limit: number): number {
  return (page - 1) * safeLimit(limit);
}
