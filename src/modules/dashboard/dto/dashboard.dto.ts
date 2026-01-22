import { ApiProperty } from '@nestjs/swagger';

/**
 * 대시보드 통계 DTO
 */
export class DashboardStatsDto {
  @ApiProperty({ description: '전체 견적 수', example: 150 })
  totalEstimates: number;

  @ApiProperty({ description: '수동 견적 수', example: 80 })
  manualEstimates: number;

  @ApiProperty({ description: 'AI 견적 수', example: 70 })
  aiEstimates: number;

  @ApiProperty({ description: '최근 7일 견적 수', example: 25 })
  recentEstimates: number;

  @ApiProperty({ description: '전체 예약 수', example: 50 })
  totalBookings: number;

  @ApiProperty({ description: '대기 중 예약 수', example: 5 })
  pendingBookings: number;

  @ApiProperty({ description: '확정된 예약 수', example: 35 })
  confirmedBookings: number;

  @ApiProperty({ description: '다가오는 예약 수', example: 10 })
  upcomingBookings: number;

  @ApiProperty({ description: '전체 채팅 수', example: 200 })
  totalChats: number;

  @ApiProperty({ description: '진행 중인 채팅 수', example: 15 })
  activeChats: number;

  @ApiProperty({ description: '전체 아이템 수', example: 500 })
  totalItems: number;

  @ApiProperty({ description: '장소 수', example: 250 })
  placeCount: number;

  @ApiProperty({ description: '숙소 수', example: 100 })
  accommodationCount: number;

  @ApiProperty({ description: '교통 수', example: 50 })
  transportationCount: number;

  @ApiProperty({ description: '컨텐츠 수', example: 100 })
  contentsCount: number;
}

/**
 * 다가오는 예약 DTO
 */
export class UpcomingBookingDto {
  @ApiProperty({ description: '예약 ID', example: 1 })
  id: number;

  @ApiProperty({ description: '예약 코드', example: 'BK-2024-0001' })
  code: string;

  @ApiProperty({ description: '예약 날짜', example: '2024-02-15' })
  bookingDate: string;

  @ApiProperty({
    description: '예약 상태',
    example: 'confirmed',
    enum: ['pending', 'confirmed', 'completed', 'cancelled'],
  })
  status: string;

  @ApiProperty({ description: 'D-Day까지 남은 일수', example: 7 })
  daysUntil: number;
}

/**
 * 최근 견적 DTO
 */
export class RecentEstimateDto {
  @ApiProperty({ description: '견적 ID', example: 1 })
  id: number;

  @ApiProperty({ description: '견적 제목', example: 'Seoul 3-Day Tour' })
  title: string;

  @ApiProperty({ description: '고객 이름', example: 'John Smith' })
  customerName: string;

  @ApiProperty({
    description: '출처',
    example: 'chatbot',
    enum: ['chatbot', 'admin', 'website'],
  })
  source: string;

  @ApiProperty({
    description: '수동 견적 상태',
    example: 'draft',
    enum: ['draft', 'pending', 'sent', 'accepted', 'rejected'],
  })
  statusManual: string;

  @ApiProperty({
    description: 'AI 견적 상태',
    example: 'generated',
    enum: ['pending', 'generated', 'error'],
  })
  statusAi: string;

  @ApiProperty({ description: '수정일', example: '2024-01-15T10:30:00Z' })
  updatedAt: string;
}

/**
 * 채팅 통계 DTO
 */
export class ChatStatsDto {
  @ApiProperty({ description: '전체', example: 200 })
  all: number;

  @ApiProperty({ description: '진행 중', example: 15 })
  inprogress: number;

  @ApiProperty({ description: '견적 준비 완료', example: 10 })
  estimateReady: number;

  @ApiProperty({ description: '검토 대기', example: 8 })
  pendingReview: number;

  @ApiProperty({ description: '견적 발송됨', example: 50 })
  quoteSent: number;

  @ApiProperty({ description: '완료', example: 100 })
  completed: number;

  @ApiProperty({ description: '거절됨', example: 12 })
  declined: number;

  @ApiProperty({ description: '종료됨', example: 5 })
  closed: number;
}

/**
 * 대시보드 전체 데이터 응답 DTO
 */
export class DashboardDataDto {
  @ApiProperty({ description: '통계 정보', type: DashboardStatsDto })
  stats: DashboardStatsDto;

  @ApiProperty({
    description: '다가오는 예약 목록 (최대 5개)',
    type: [UpcomingBookingDto],
  })
  upcomingBookings: UpcomingBookingDto[];

  @ApiProperty({
    description: '최근 견적 목록 (최대 10개)',
    type: [RecentEstimateDto],
  })
  recentEstimates: RecentEstimateDto[];

  @ApiProperty({ description: '채팅 상태별 통계', type: ChatStatsDto })
  chatStats: ChatStatsDto;
}
