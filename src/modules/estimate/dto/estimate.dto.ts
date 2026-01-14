import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class EstimateItemDto {
  @ApiProperty({ description: '아이템 ID' })
  id: number;

  @ApiProperty({
    description: '아이템 타입',
    enum: ['place', 'accommodation', 'transportation', 'contents'],
  })
  type: string;

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

  @ApiPropertyOptional({ description: 'AI 견적 상태' })
  statusAi?: string;

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

  @ApiPropertyOptional({ description: 'AI 견적 상태' })
  statusAi?: string;

  @ApiPropertyOptional({ description: '여행 시작일' })
  startDate?: string;

  @ApiProperty({ description: '총 금액' })
  totalAmount: number;

  @ApiProperty({ description: '고정 여부' })
  isPinned: boolean;

  @ApiProperty({ description: '수정일' })
  updatedAt: string;
}
