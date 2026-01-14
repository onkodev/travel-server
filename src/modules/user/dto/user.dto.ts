import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UserDetailDto {
  @ApiProperty({ description: '사용자 ID', example: 'uuid-string' })
  id: string;

  @ApiProperty({ description: '이메일', example: 'user@example.com' })
  email: string;

  @ApiPropertyOptional({ description: '사용자 이름', example: '홍길동' })
  name?: string;

  @ApiPropertyOptional({ description: '전화번호', example: '010-1234-5678' })
  phone?: string;

  @ApiPropertyOptional({ description: '프로필 이미지 URL' })
  avatarUrl?: string;

  @ApiProperty({
    description: '역할',
    example: 'user',
    enum: ['user', 'admin', 'agent'],
  })
  role: string;

  @ApiProperty({ description: '활성화 상태', example: true })
  isActive: boolean;

  @ApiProperty({ description: '가입일', example: '2024-01-01T00:00:00.000Z' })
  createdAt: string;

  @ApiPropertyOptional({
    description: '마지막 로그인',
    example: '2024-01-10T00:00:00.000Z',
  })
  lastLoginAt?: string;
}

export class UserListItemDto {
  @ApiProperty({ description: '사용자 ID' })
  id: string;

  @ApiProperty({ description: '이메일' })
  email: string;

  @ApiPropertyOptional({ description: '사용자 이름' })
  name?: string;

  @ApiProperty({ description: '역할' })
  role: string;

  @ApiProperty({ description: '활성화 상태' })
  isActive: boolean;

  @ApiProperty({ description: '가입일' })
  createdAt: string;
}

export class UserStatsDto {
  @ApiProperty({ description: '전체 사용자 수', example: 100 })
  total: number;

  @ApiProperty({ description: '활성 사용자 수', example: 90 })
  active: number;

  @ApiProperty({ description: '비활성 사용자 수', example: 10 })
  inactive: number;

  @ApiProperty({ description: '관리자 수', example: 5 })
  admins: number;

  @ApiProperty({ description: '에이전트 수', example: 10 })
  agents: number;

  @ApiProperty({ description: '일반 사용자 수', example: 85 })
  users: number;
}

export class MyStatsDto {
  @ApiProperty({ description: '총 예약 수', example: 10 })
  totalBookings: number;

  @ApiProperty({ description: '완료된 예약 수', example: 8 })
  completedBookings: number;

  @ApiProperty({ description: '총 결제 금액', example: 1500000 })
  totalSpent: number;

  @ApiProperty({ description: '작성한 리뷰 수', example: 5 })
  reviewCount: number;
}
