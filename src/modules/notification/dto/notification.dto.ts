import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min, IsBoolean } from 'class-validator';
import { Type, Transform } from 'class-transformer';

/**
 * 알림 상세 정보 DTO
 */
export class NotificationDto {
  @ApiProperty({ description: '알림 ID', example: 1 })
  id: number;

  @ApiProperty({
    description: '알림 타입',
    example: 'estimate_request',
    enum: ['estimate_request', 'estimate_review', 'general_inquiry', 'system'],
  })
  type: string;

  @ApiProperty({ description: '알림 제목', example: '새로운 상담 요청' })
  title: string;

  @ApiProperty({
    description: '알림 메시지',
    example: '홍길동님이 상담을 요청했습니다',
  })
  message: string;

  @ApiProperty({ description: '읽음 여부', example: false })
  isRead: boolean;

  @ApiPropertyOptional({ description: '관련 견적 ID', example: 123 })
  relatedEstimateId?: number;

  @ApiPropertyOptional({
    description: '관련 챗봇 세션 ID',
    example: 'session_abc123',
  })
  relatedSessionId?: string;

  @ApiPropertyOptional({
    description: '추가 메타데이터',
    example: { contactId: 1, name: '홍길동' },
  })
  metadata?: Record<string, unknown>;

  @ApiProperty({ description: '생성일시', example: '2024-01-15T10:30:00Z' })
  createdAt: Date;

  @ApiPropertyOptional({
    description: '읽은 일시',
    example: '2024-01-15T11:00:00Z',
  })
  readAt?: Date;
}

/**
 * 알림 목록 응답 DTO
 */
export class NotificationListDto {
  @ApiProperty({ type: [NotificationDto], description: '알림 목록' })
  notifications: NotificationDto[];

  @ApiProperty({ description: '전체 알림 수', example: 50 })
  total: number;

  @ApiProperty({ description: '읽지 않은 알림 수', example: 5 })
  unreadCount: number;
}

/**
 * 알림 조회 쿼리 DTO
 */
export class NotificationQueryDto {
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
  @IsOptional()
  limit?: number = 20;

  @ApiPropertyOptional({
    description: '알림 타입 필터',
    example: 'estimate_request',
    enum: ['estimate_request', 'estimate_review', 'general_inquiry', 'system'],
  })
  @IsString()
  @IsOptional()
  type?: string;

  @ApiPropertyOptional({
    description: '읽지 않은 알림만 조회',
    default: false,
    example: true,
  })
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  @IsOptional()
  unreadOnly?: boolean;
}

/**
 * 알림 읽음 처리 요청 DTO
 */
export class MarkAsReadDto {
  @ApiProperty({
    type: [Number],
    description: '읽음 처리할 알림 ID 배열',
    example: [1, 2, 3],
  })
  @IsInt({ each: true, message: '알림 ID는 정수여야 합니다' })
  notificationIds: number[];
}

/**
 * 읽지 않은 알림 수 응답 DTO
 */
export class UnreadCountDto {
  @ApiProperty({ description: '읽지 않은 알림 수', example: 5 })
  count: number;
}

/**
 * 알림 삭제 요청 DTO
 */
export class DeleteNotificationDto {
  @ApiProperty({ description: '삭제할 알림 ID', example: 1 })
  @IsInt({ message: '알림 ID는 정수여야 합니다' })
  notificationId: number;
}

/**
 * 대량 알림 삭제 요청 DTO
 */
export class DeleteNotificationsDto {
  @ApiProperty({
    type: [Number],
    description: '삭제할 알림 ID 배열',
    example: [1, 2, 3],
  })
  @IsInt({ each: true, message: '알림 ID는 정수여야 합니다' })
  notificationIds: number[];
}

/**
 * 성공 응답 DTO
 */
export class NotificationSuccessDto {
  @ApiProperty({ description: '성공 여부', example: true })
  success: boolean;
}
