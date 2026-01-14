import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 기본 성공 응답 DTO
 */
export class SuccessResponseDto {
  @ApiProperty({ description: '성공 여부', example: true })
  success: boolean;

  @ApiPropertyOptional({
    description: '메시지',
    example: '성공적으로 처리되었습니다',
  })
  message?: string;
}

/**
 * 데이터 포함 성공 응답 DTO 팩토리
 */
export function createSuccessResponseDto<T>(
  dataType: new () => T,
  description?: string,
) {
  class DataResponseDto {
    @ApiProperty({ description: '성공 여부', example: true })
    success: boolean;

    @ApiProperty({ type: dataType, description: description || '응답 데이터' })
    data: T;
  }

  return DataResponseDto;
}

/**
 * 에러 응답 DTO
 */
export class ErrorResponseDto {
  @ApiProperty({ description: 'HTTP 상태 코드', example: 400 })
  statusCode: number;

  @ApiProperty({ description: '에러 메시지', example: '잘못된 요청입니다' })
  message: string;

  @ApiPropertyOptional({ description: '에러 코드', example: 'INVALID_REQUEST' })
  error?: string;

  @ApiPropertyOptional({ description: '상세 에러 정보', type: [String] })
  details?: string[];
}

/**
 * 삭제 응답 DTO
 */
export class DeleteResponseDto {
  @ApiProperty({ description: '성공 여부', example: true })
  success: boolean;

  @ApiPropertyOptional({ description: '삭제된 항목 ID', example: 1 })
  deletedId?: number;
}

/**
 * 카운트 응답 DTO
 */
export class CountResponseDto {
  @ApiProperty({ description: '전체 개수', example: 100 })
  count: number;
}
