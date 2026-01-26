import { ApiProperty } from '@nestjs/swagger';

export class EstimateStatsDto {
  @ApiProperty({ description: '전체 견적 수' })
  total: number;

  @ApiProperty({ description: '수동 견적 수' })
  manual: number;

  @ApiProperty({ description: 'AI 견적 수' })
  ai: number;
}

export class ManualEstimateStatsDto {
  @ApiProperty({ description: '전체 수동 견적 수' })
  total: number;

  @ApiProperty({ description: '계획 중' })
  planning: number;

  @ApiProperty({ description: '진행 중' })
  inProgress: number;

  @ApiProperty({ description: '완료' })
  completed: number;

  @ApiProperty({ description: '취소' })
  cancelled: number;

  @ApiProperty({ description: '보관' })
  archived: number;

  @ApiProperty({ description: '다가오는 여행' })
  upcoming: number;
}

export class AIEstimateStatsDto {
  @ApiProperty({ description: '전체 AI 견적 수' })
  total: number;

  @ApiProperty({ description: '초안 (AI 생성 완료, 관리자 검토 전)' })
  draft: number;

  @ApiProperty({ description: '검토 대기' })
  pending: number;

  @ApiProperty({ description: '발송됨' })
  sent: number;

  @ApiProperty({ description: '승인됨 (결제 대기)' })
  approved: number;

  @ApiProperty({ description: '완료' })
  completed: number;

  @ApiProperty({ description: '취소됨' })
  cancelled: number;
}

export class AdjacentIdsDto {
  @ApiProperty({ description: '이전 견적 ID', nullable: true })
  prevId: number | null;

  @ApiProperty({ description: '다음 견적 ID', nullable: true })
  nextId: number | null;
}
