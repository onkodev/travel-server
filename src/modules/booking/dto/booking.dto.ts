import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsOptional,
  IsIn,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationQueryDto } from '../../../common/dto';

export class BookingDto {
  @ApiProperty({ description: '예약 ID' })
  id: number;

  @ApiProperty({ description: '예약 코드' })
  code: string;

  @ApiPropertyOptional({ description: '투어 ID' })
  tourId?: number;

  @ApiPropertyOptional({ description: '사용자 ID' })
  userId?: string;

  @ApiProperty({ description: '예약자 이름' })
  customerName: string;

  @ApiProperty({ description: '예약자 이메일' })
  customerEmail: string;

  @ApiPropertyOptional({ description: '예약자 전화번호' })
  customerPhone?: string;

  @ApiProperty({ description: '예약 날짜' })
  bookingDate: string;

  @ApiProperty({ description: '인원 수' })
  participants: number;

  @ApiProperty({ description: '총 금액' })
  totalAmount: number;

  @ApiProperty({
    description: '예약 상태',
    enum: ['pending', 'confirmed', 'cancelled', 'completed'],
  })
  status: string;

  @ApiPropertyOptional({ description: '취소 사유' })
  cancelReason?: string;

  @ApiProperty({ description: '생성일' })
  createdAt: string;
}

export class BookingQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: '예약 상태 필터',
    enum: ['pending', 'confirmed', 'cancelled', 'completed'],
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: '투어 ID 필터' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  tourId?: number;

  @ApiPropertyOptional({ description: '검색어 (이름, 이메일)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ description: '시작일 필터' })
  @IsOptional()
  @IsString()
  dateFrom?: string;

  @ApiPropertyOptional({ description: '종료일 필터' })
  @IsOptional()
  @IsString()
  dateTo?: string;

  @ApiPropertyOptional({
    description: '결제 상태 필터',
    enum: ['pending', 'completed', 'failed', 'refunded', 'partially_refunded'],
  })
  @IsOptional()
  @IsString()
  paymentStatus?: string;
}

export class CreateBookingDto {
  @ApiProperty({ description: '투어 ID' })
  @IsNumber()
  tourId: number;

  @ApiProperty({ description: '투어 제목' })
  @IsString()
  tourTitle: string;

  @ApiProperty({ description: '예약 날짜 (YYYY-MM-DD)' })
  @IsString()
  bookingDate: string;

  @ApiPropertyOptional({ description: '시작 시간 (HH:MM)' })
  @IsOptional()
  @IsString()
  startTime?: string;

  @ApiProperty({ description: '예약자 이름 (First Name)' })
  @IsString()
  customerFirstName: string;

  @ApiProperty({ description: '예약자 성 (Last Name)' })
  @IsString()
  customerLastName: string;

  @ApiProperty({ description: '예약자 이메일' })
  @IsString()
  customerEmail: string;

  @ApiPropertyOptional({ description: '예약자 전화번호' })
  @IsOptional()
  @IsString()
  customerPhone?: string;

  @ApiPropertyOptional({ description: '예약자 국가' })
  @IsOptional()
  @IsString()
  customerCountry?: string;

  @ApiProperty({ description: '인원 수', default: 1 })
  @IsNumber()
  participantCount: number;

  @ApiProperty({ description: '1인당 가격' })
  @IsNumber()
  unitPrice: number;

  @ApiProperty({ description: '총 금액' })
  @IsNumber()
  totalAmount: number;

  @ApiPropertyOptional({ description: '통화', default: 'USD' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ description: '특별 요청사항' })
  @IsOptional()
  @IsString()
  specialRequests?: string;
}

export class UpdateBookingDto {
  @ApiPropertyOptional({ description: '예약 날짜 (YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  bookingDate?: string;

  @ApiPropertyOptional({ description: '시작 시간 (HH:MM)' })
  @IsOptional()
  @IsString()
  startTime?: string;

  @ApiPropertyOptional({ description: '예약자 이름 (First Name)' })
  @IsOptional()
  @IsString()
  customerFirstName?: string;

  @ApiPropertyOptional({ description: '예약자 성 (Last Name)' })
  @IsOptional()
  @IsString()
  customerLastName?: string;

  @ApiPropertyOptional({ description: '예약자 이메일' })
  @IsOptional()
  @IsString()
  customerEmail?: string;

  @ApiPropertyOptional({ description: '예약자 전화번호' })
  @IsOptional()
  @IsString()
  customerPhone?: string;

  @ApiPropertyOptional({ description: '예약자 국가' })
  @IsOptional()
  @IsString()
  customerCountry?: string;

  @ApiPropertyOptional({ description: '인원 수' })
  @IsOptional()
  @IsNumber()
  participantCount?: number;

  @ApiPropertyOptional({ description: '1인당 가격' })
  @IsOptional()
  @IsNumber()
  unitPrice?: number;

  @ApiPropertyOptional({ description: '총 금액' })
  @IsOptional()
  @IsNumber()
  totalAmount?: number;

  @ApiPropertyOptional({ description: '특별 요청사항' })
  @IsOptional()
  @IsString()
  specialRequests?: string;

  @ApiPropertyOptional({ description: '관리자 메모' })
  @IsOptional()
  @IsString()
  adminMemo?: string;
}

export class UpdateBookingStatusDto {
  @ApiProperty({
    description: '변경할 상태',
    enum: ['pending', 'confirmed', 'cancelled', 'completed'],
  })
  @IsIn(['pending', 'confirmed', 'cancelled', 'completed'])
  status: string;

  @ApiPropertyOptional({ description: '취소 사유 (취소 시)' })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class BookingStatsDto {
  @ApiProperty({ description: '전체 예약 수' })
  total: number;

  @ApiProperty({ description: '대기 중' })
  pending: number;

  @ApiProperty({ description: '확정됨' })
  confirmed: number;

  @ApiProperty({ description: '취소됨' })
  cancelled: number;

  @ApiProperty({ description: '완료됨' })
  completed: number;

  @ApiProperty({ description: '다가오는 예약 수' })
  upcoming: number;
}
