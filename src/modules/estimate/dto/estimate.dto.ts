import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ============================================================================
// Estimate Status - 견적 상태 정의 (6개)
// 결제 관련 상태는 Payment 테이블에서 관리
// ============================================================================

export const ESTIMATE_STATUS = {
  DRAFT: 'draft', // AI 생성 완료, 관리자 검토 전
  PENDING: 'pending', // 관리자 검토 대기
  SENT: 'sent', // 고객에게 발송됨
  APPROVED: 'approved', // 고객 승인 (결제 대기)
  COMPLETED: 'completed', // 투어 완료
  CANCELLED: 'cancelled', // 취소됨 (거절 포함)
} as const;

export type EstimateStatus =
  (typeof ESTIMATE_STATUS)[keyof typeof ESTIMATE_STATUS];

// 상태별 한글 라벨
export const ESTIMATE_STATUS_LABELS: Record<EstimateStatus, string> = {
  draft: '작성중',
  pending: '검토대기',
  sent: '발송됨',
  approved: '승인됨',
  completed: '완료',
  cancelled: '취소됨',
};

// 상태 전이 규칙 (현재 상태 → 가능한 다음 상태들)
// 수정 요청: sent 상태에서 revisionRequested=true로 처리
// 결제: Payment.status로 관리
export const ESTIMATE_STATUS_TRANSITIONS: Record<
  EstimateStatus,
  EstimateStatus[]
> = {
  draft: ['pending'],
  pending: ['sent'],
  sent: ['approved', 'cancelled'], // 수정요청은 sent 유지 + flag
  approved: ['completed', 'cancelled'], // 결제는 Payment로
  completed: [],
  cancelled: [],
};

// 취소 사유 타입
export const CANCEL_REASONS = {
  DECLINED: 'declined', // 고객 거절
  CUSTOMER_REQUEST: 'customer_request', // 고객 요청
  NO_RESPONSE: 'no_response', // 무응답
  OTHER: 'other', // 기타
} as const;

export type CancelReason = (typeof CANCEL_REASONS)[keyof typeof CANCEL_REASONS];

export class EstimateItemDto {
  @ApiProperty({ description: '아이템 ID' })
  id: number;

  @ApiProperty({
    description: '아이템 카테고리',
    enum: ['place', 'accommodation', 'transportation', 'contents', 'service', 'restaurant'],
  })
  category: string;

  @ApiProperty({ description: '아이템 이름' })
  name: string;

  @ApiPropertyOptional({ description: '아이템 설명' })
  description?: string;

  @ApiProperty({ description: '가격' })
  price: number;

  @ApiProperty({ description: '수량', default: 1 })
  quantity: number;

  @ApiPropertyOptional({ description: '날짜' })
  date?: string;

  @ApiPropertyOptional({ description: '이미지 URL 목록', type: [String] })
  imageUrls?: string[];
}

export class EstimateDto {
  @ApiProperty({ description: '견적 ID' })
  id: number;

  @ApiProperty({ description: '견적 제목' })
  title: string;

  @ApiPropertyOptional({ description: '고객 이름' })
  customerName?: string;

  @ApiPropertyOptional({ description: '고객 이메일' })
  customerEmail?: string;

  @ApiPropertyOptional({ description: '고객 전화번호' })
  customerPhone?: string;

  @ApiProperty({ description: '출처', enum: ['manual', 'ai'] })
  source: string;

  @ApiPropertyOptional({ description: '수동 견적 상태' })
  statusManual?: string;

  @ApiPropertyOptional({
    description: 'AI 견적 상태',
    enum: Object.values(ESTIMATE_STATUS),
  })
  statusAi?: EstimateStatus;

  @ApiPropertyOptional({ description: '여행 시작일' })
  startDate?: string;

  @ApiPropertyOptional({ description: '여행 종료일' })
  endDate?: string;

  @ApiProperty({ description: '인원 수', default: 1 })
  travelers: number;

  @ApiProperty({ description: '총 금액' })
  totalAmount: number;

  @ApiPropertyOptional({ description: '통화', default: 'KRW' })
  currency?: string;

  @ApiPropertyOptional({ description: '조정 금액' })
  adjustmentAmount?: number;

  @ApiPropertyOptional({ description: '조정 사유' })
  adjustmentReason?: string;

  @ApiProperty({ description: '고정 여부', default: false })
  isPinned: boolean;

  @ApiPropertyOptional({ description: '공유 해시' })
  shareHash?: string;

  @ApiPropertyOptional({
    description: '견적 아이템 목록',
    type: [EstimateItemDto],
  })
  items?: EstimateItemDto[];

  @ApiProperty({ description: '생성일' })
  createdAt: string;

  @ApiProperty({ description: '수정일' })
  updatedAt: string;
}

export class EstimateListItemDto {
  @ApiProperty({ description: '견적 ID' })
  id: number;

  @ApiProperty({ description: '견적 제목' })
  title: string;

  @ApiPropertyOptional({ description: '고객 이름' })
  customerName?: string;

  @ApiProperty({ description: '출처' })
  source: string;

  @ApiPropertyOptional({ description: '수동 견적 상태' })
  statusManual?: string;

  @ApiPropertyOptional({
    description: 'AI 견적 상태',
    enum: Object.values(ESTIMATE_STATUS),
  })
  statusAi?: EstimateStatus;

  @ApiPropertyOptional({ description: '여행 시작일' })
  startDate?: string;

  @ApiProperty({ description: '총 금액' })
  totalAmount: number;

  @ApiProperty({ description: '고정 여부' })
  isPinned: boolean;

  @ApiProperty({ description: '수정일' })
  updatedAt: string;
}
