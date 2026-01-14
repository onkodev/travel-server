import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNumber, IsOptional, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationQueryDto } from '../../../common/dto';

export class PaymentDto {
  @ApiProperty({ description: '결제 ID' })
  id: number;

  @ApiPropertyOptional({ description: '예약 ID' })
  bookingId?: number;

  @ApiPropertyOptional({ description: '견적 ID' })
  estimateId?: number;

  @ApiProperty({ description: '결제 금액' })
  amount: number;

  @ApiPropertyOptional({ description: '통화', default: 'USD' })
  currency?: string;

  @ApiProperty({
    description: '결제 상태',
    enum: ['pending', 'completed', 'failed', 'refunded', 'partial_refund'],
  })
  status: string;

  @ApiProperty({
    description: '결제 수단',
    enum: ['paypal', 'credit_card', 'bank_transfer'],
  })
  paymentMethod: string;

  @ApiPropertyOptional({ description: 'PayPal 주문 ID' })
  paypalOrderId?: string;

  @ApiPropertyOptional({ description: 'PayPal 캡처 ID' })
  paypalCaptureId?: string;

  @ApiPropertyOptional({ description: '결제 완료 시각' })
  paidAt?: string;

  @ApiPropertyOptional({ description: '환불 금액' })
  refundedAmount?: number;

  @ApiPropertyOptional({ description: '환불 사유' })
  refundReason?: string;

  @ApiProperty({ description: '생성일' })
  createdAt: string;
}

export class PaymentQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: '결제 상태 필터' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: '예약 ID 필터' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  bookingId?: number;

  @ApiPropertyOptional({ description: '견적 ID 필터' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  estimateId?: number;

  @ApiPropertyOptional({ description: '결제 수단 필터' })
  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @ApiPropertyOptional({ description: '시작일 필터' })
  @IsOptional()
  @IsString()
  dateFrom?: string;

  @ApiPropertyOptional({ description: '종료일 필터' })
  @IsOptional()
  @IsString()
  dateTo?: string;
}

export class CreatePaymentDto {
  @ApiPropertyOptional({ description: '예약 ID' })
  @IsOptional()
  @IsNumber()
  bookingId?: number;

  @ApiPropertyOptional({ description: '견적 ID' })
  @IsOptional()
  @IsNumber()
  estimateId?: number;

  @ApiProperty({ description: '결제 금액' })
  @IsNumber()
  amount: number;

  @ApiPropertyOptional({ description: '통화', default: 'USD' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiProperty({
    description: '결제 수단',
    enum: ['paypal', 'credit_card', 'bank_transfer'],
  })
  @IsIn(['paypal', 'credit_card', 'bank_transfer'])
  paymentMethod: string;

  @ApiPropertyOptional({ description: 'PayPal 주문 ID' })
  @IsOptional()
  @IsString()
  paypalOrderId?: string;
}

export class UpdatePaymentStatusDto {
  @ApiProperty({
    description: '결제 상태',
    enum: ['pending', 'completed', 'failed', 'refunded'],
  })
  @IsIn(['pending', 'completed', 'failed', 'refunded'])
  status: string;

  @ApiPropertyOptional({ description: 'PayPal 캡처 ID' })
  @IsOptional()
  @IsString()
  paypalCaptureId?: string;

  @ApiPropertyOptional({ description: '결제 완료 시각' })
  @IsOptional()
  @IsString()
  paidAt?: string;

  @ApiPropertyOptional({ description: '실패 사유' })
  @IsOptional()
  @IsString()
  failureReason?: string;
}

export class ProcessRefundDto {
  @ApiProperty({ description: '환불 금액' })
  @IsNumber()
  refundedAmount: number;

  @ApiPropertyOptional({ description: '환불 사유' })
  @IsOptional()
  @IsString()
  refundReason?: string;

  @ApiPropertyOptional({ description: 'PayPal 환불 ID' })
  @IsOptional()
  @IsString()
  paypalRefundId?: string;
}

export class PaymentStatsDto {
  @ApiProperty({ description: '전체 결제 수' })
  total: number;

  @ApiProperty({ description: '완료된 결제 수' })
  completed: number;

  @ApiProperty({ description: '총 결제 금액' })
  totalAmount: number;

  @ApiProperty({ description: '환불된 금액' })
  refundedAmount: number;

  @ApiProperty({ description: '대기 중인 결제 수' })
  pending: number;
}
