import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsNumber,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  Allow,
} from 'class-validator';
import { Type } from 'class-transformer';
import { EstimateItemDto } from './estimate.dto';

/**
 * 견적 수정 DTO
 * 클라이언트에서 전체 EstimateSchema를 보내므로 모든 필드 허용
 */
export class UpdateEstimateDto {
  // 읽기 전용 필드들 (서버에서 무시됨)
  @ApiPropertyOptional({ description: 'ID (서버에서 무시)' })
  @IsOptional()
  @Type(() => Number)
  id?: number;

  @ApiPropertyOptional({ description: '생성일 (서버에서 무시)' })
  @IsOptional()
  @IsString()
  createdAt?: string;

  @ApiPropertyOptional({ description: '수정일 (서버에서 무시)' })
  @IsOptional()
  @IsString()
  updatedAt?: string;

  @ApiPropertyOptional({ description: '공유 해시 (서버에서 무시)' })
  @IsOptional()
  @IsString()
  shareHash?: string;

  @ApiPropertyOptional({ description: '수정일 (서버에서 무시)' })
  @IsOptional()
  @IsString()
  revisedAt?: string;

  @ApiPropertyOptional({ description: '조회일 (서버에서 무시)' })
  @IsOptional()
  @IsString()
  viewedAt?: string;

  @ApiPropertyOptional({ description: '발송일 (서버에서 무시)' })
  @IsOptional()
  @IsString()
  sentAt?: string;

  @ApiPropertyOptional({ description: '응답일 (서버에서 무시)' })
  @IsOptional()
  @IsString()
  respondedAt?: string;

  @ApiPropertyOptional({ description: '완료일 (서버에서 무시)' })
  @IsOptional()
  @IsString()
  completedAt?: string;

  @ApiPropertyOptional({ description: '결제일 (서버에서 무시)' })
  @IsOptional()
  @IsString()
  paidAt?: string;

  @ApiPropertyOptional({ description: '총 여행자 수 (서버에서 무시)' })
  @IsOptional()
  @Type(() => Number)
  totalTravelers?: number;

  @ApiPropertyOptional({ description: '제목' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ description: '고객 이름' })
  @IsOptional()
  @IsString()
  customerName?: string;

  @ApiPropertyOptional({ description: '고객 이메일' })
  @IsOptional()
  @IsString()
  customerEmail?: string;

  @ApiPropertyOptional({ description: '고객 전화번호' })
  @IsOptional()
  @IsString()
  customerPhone?: string;

  @ApiPropertyOptional({ description: '국적' })
  @IsOptional()
  @IsString()
  nationality?: string;

  @ApiPropertyOptional({ description: '소스', enum: ['manual', 'ai'] })
  @IsOptional()
  @IsString()
  source?: string;

  @ApiPropertyOptional({ description: '수동 견적 상태' })
  @IsOptional()
  @IsString()
  statusManual?: string;

  @ApiPropertyOptional({ description: 'AI 견적 상태' })
  @IsOptional()
  @IsString()
  statusAi?: string;

  @ApiPropertyOptional({ description: '여행 시작일' })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ description: '여행 종료일' })
  @IsOptional()
  @IsString()
  endDate?: string;

  @ApiPropertyOptional({ description: '여행 일수' })
  @IsOptional()
  @Type(() => Number)
  travelDays?: number;

  @ApiPropertyOptional({ description: '성인 수' })
  @IsOptional()
  @Type(() => Number)
  adultsCount?: number;

  @ApiPropertyOptional({ description: '어린이 수' })
  @IsOptional()
  @Type(() => Number)
  childrenCount?: number;

  @ApiPropertyOptional({ description: '유아 수' })
  @IsOptional()
  @Type(() => Number)
  infantsCount?: number;

  @ApiPropertyOptional({ description: '시니어 수' })
  @IsOptional()
  @Type(() => Number)
  seniorsCount?: number;

  @ApiPropertyOptional({ description: '투어 타입' })
  @IsOptional()
  @IsString()
  tourType?: string;

  @ApiPropertyOptional({ description: '여행자 유형' })
  @IsOptional()
  @IsString()
  travelerType?: string;

  @ApiPropertyOptional({ description: '가격대' })
  @IsOptional()
  @IsString()
  priceRange?: string;

  @ApiPropertyOptional({ description: '관심사 목록' })
  @IsOptional()
  @IsArray()
  interests?: string[];

  @ApiPropertyOptional({ description: '지역 목록' })
  @IsOptional()
  @IsArray()
  regions?: string[];

  @ApiPropertyOptional({ description: '견적 아이템 목록' })
  @IsOptional()
  @IsArray()
  items?: Record<string, unknown>[];

  @ApiPropertyOptional({ description: '소계' })
  @IsOptional()
  @Type(() => Number)
  subtotal?: number;

  @ApiPropertyOptional({ description: '수동 조정 금액' })
  @IsOptional()
  @Type(() => Number)
  manualAdjustment?: number;

  @ApiPropertyOptional({ description: '조정 사유' })
  @IsOptional()
  @IsString()
  adjustmentReason?: string;

  @ApiPropertyOptional({ description: '총 금액' })
  @IsOptional()
  @Type(() => Number)
  totalAmount?: number;

  @ApiPropertyOptional({ description: '통화' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ description: '표시 옵션 (place, accommodation, transportation, contents, price)' })
  @IsOptional()
  @IsObject()
  displayOptions?: Record<string, boolean>;

  @ApiPropertyOptional({ description: '코멘트' })
  @IsOptional()
  @IsString()
  comment?: string;

  @ApiPropertyOptional({ description: '타임라인 (Record<number, string> 형태)' })
  @IsOptional()
  timeline?: Record<number, string>;

  @ApiPropertyOptional({ description: '요청 내용' })
  @IsOptional()
  @IsString()
  requestContent?: string;

  @ApiPropertyOptional({ description: '수정 이력' })
  @IsOptional()
  @IsArray()
  revisionHistory?: Record<string, unknown>[];

  @ApiPropertyOptional({ description: '고정 여부' })
  @IsOptional()
  @IsBoolean()
  isPinned?: boolean;

  @ApiPropertyOptional({ description: '키워드 목록' })
  @IsOptional()
  @IsArray()
  keywords?: string[];

  @ApiPropertyOptional({ description: '그룹 타입' })
  @IsOptional()
  @IsString()
  groupType?: string;

  @ApiPropertyOptional({ description: '예산 수준' })
  @IsOptional()
  @IsString()
  budgetLevel?: string;

  @ApiPropertyOptional({ description: '특별 요구사항' })
  @IsOptional()
  @IsArray()
  specialNeeds?: string[];

  @ApiPropertyOptional({ description: '유효 날짜' })
  @IsOptional()
  @IsString()
  validDate?: string;

  @ApiPropertyOptional({ description: '결제 여부' })
  @IsOptional()
  @IsBoolean()
  isPaid?: boolean;

  @ApiPropertyOptional({ description: '결제 금액' })
  @IsOptional()
  @Type(() => Number)
  paidAmount?: number;

  @ApiPropertyOptional({ description: '고객 응답' })
  @IsOptional()
  @IsString()
  customerResponse?: string;

  @ApiPropertyOptional({ description: '내부 메모' })
  @IsOptional()
  @IsString()
  internalMemo?: string;

  @ApiPropertyOptional({ description: '채팅 세션 ID (서버에서 무시)' })
  @IsOptional()
  @IsString()
  chatSessionId?: string;

  @ApiPropertyOptional({ description: '사용자 ID (서버에서 무시)' })
  @IsOptional()
  @IsString()
  userId?: string;
}

export class UpdateStatusDto {
  @ApiProperty({ description: '변경할 상태', example: 'in_progress' })
  @IsString()
  status: string;
}

export class UpdatePinnedDto {
  @ApiProperty({ description: '고정 여부', example: true })
  @IsBoolean()
  isPinned: boolean;
}

export class UpdateItemsDto {
  @ApiProperty({ description: '견적 아이템 목록', type: [EstimateItemDto] })
  @IsArray()
  items: EstimateItemDto[];
}

export class UpdateAdjustmentDto {
  @ApiProperty({ description: '조정 금액', example: 50000 })
  @IsNumber()
  amount: number;

  @ApiPropertyOptional({ description: '조정 사유', example: '특별 할인' })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class BulkDeleteDto {
  @ApiProperty({ description: '삭제할 견적 ID 목록', example: [1, 2, 3] })
  @IsArray()
  ids: number[];
}

export class BulkStatusDto {
  @ApiProperty({ description: '변경할 견적 ID 목록', example: [1, 2, 3] })
  @IsArray()
  ids: number[];

  @ApiProperty({ description: '변경할 상태', example: 'archived' })
  @IsString()
  status: string;
}
