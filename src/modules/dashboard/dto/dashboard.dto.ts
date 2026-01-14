import { ApiProperty } from '@nestjs/swagger';

export class DashboardStatsDto {
  @ApiProperty({ description: '전체 견적 수' })
  totalEstimates: number;

  @ApiProperty({ description: '수동 견적 수' })
  manualEstimates: number;

  @ApiProperty({ description: 'AI 견적 수' })
  aiEstimates: number;

  @ApiProperty({ description: '최근 7일 견적 수' })
  recentEstimates: number;

  @ApiProperty({ description: '전체 예약 수' })
  totalBookings: number;

  @ApiProperty({ description: '대기 중 예약 수' })
  pendingBookings: number;

  @ApiProperty({ description: '확정된 예약 수' })
  confirmedBookings: number;

  @ApiProperty({ description: '다가오는 예약 수' })
  upcomingBookings: number;

  @ApiProperty({ description: '전체 채팅 수' })
  totalChats: number;

  @ApiProperty({ description: '진행 중인 채팅 수' })
  activeChats: number;

  @ApiProperty({ description: '전체 아이템 수' })
  totalItems: number;

  @ApiProperty({ description: '장소 수' })
  placeCount: number;

  @ApiProperty({ description: '숙소 수' })
  accommodationCount: number;

  @ApiProperty({ description: '교통 수' })
  transportationCount: number;

  @ApiProperty({ description: '컨텐츠 수' })
  contentsCount: number;
}

export class UpcomingBookingDto {
  @ApiProperty({ description: '예약 ID' })
  id: number;

  @ApiProperty({ description: '예약 코드' })
  code: string;

  @ApiProperty({ description: '예약 날짜' })
  bookingDate: string;

  @ApiProperty({ description: '예약 상태' })
  status: string;

  @ApiProperty({ description: 'D-Day까지 남은 일수' })
  daysUntil: number;
}

export class RecentEstimateDto {
  @ApiProperty({ description: '견적 ID' })
  id: number;

  @ApiProperty({ description: '견적 제목' })
  title: string;

  @ApiProperty({ description: '고객 이름' })
  customerName: string;

  @ApiProperty({ description: '출처' })
  source: string;

  @ApiProperty({ description: '수동 견적 상태' })
  statusManual: string;

  @ApiProperty({ description: 'AI 견적 상태' })
  statusAi: string;

  @ApiProperty({ description: '수정일' })
  updatedAt: string;
}

export class ChatStatsDto {
  @ApiProperty({ description: '전체' })
  all: number;

  @ApiProperty({ description: '진행 중' })
  inprogress: number;

  @ApiProperty({ description: '견적 준비 완료' })
  estimateReady: number;

  @ApiProperty({ description: '검토 대기' })
  pendingReview: number;

  @ApiProperty({ description: '견적 발송됨' })
  quoteSent: number;

  @ApiProperty({ description: '완료' })
  completed: number;

  @ApiProperty({ description: '거절됨' })
  declined: number;

  @ApiProperty({ description: '종료됨' })
  closed: number;
}

export class DashboardDataDto {
  @ApiProperty({ description: '통계 정보', type: DashboardStatsDto })
  stats: DashboardStatsDto;

  @ApiProperty({
    description: '다가오는 예약 목록',
    type: [UpcomingBookingDto],
  })
  upcomingBookings: UpcomingBookingDto[];

  @ApiProperty({ description: '최근 견적 목록', type: [RecentEstimateDto] })
  recentEstimates: RecentEstimateDto[];

  @ApiProperty({ description: '채팅 통계', type: ChatStatsDto })
  chatStats: ChatStatsDto;
}
