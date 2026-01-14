import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UserDto {
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

  @ApiPropertyOptional({
    description: '역할',
    example: 'user',
    enum: ['user', 'admin', 'curator'],
  })
  role?: string;
}

export class SessionDto {
  @ApiProperty({ description: '액세스 토큰' })
  access_token: string;

  @ApiProperty({ description: '리프레시 토큰' })
  refresh_token: string;

  @ApiProperty({ description: '토큰 타입', example: 'bearer' })
  token_type: string;

  @ApiProperty({ description: '토큰 만료 시간 (초)', example: 3600 })
  expires_in: number;

  @ApiProperty({ description: '토큰 만료 시각 (Unix timestamp)' })
  expires_at: number;
}

export class AuthResponseDto {
  @ApiProperty({ type: UserDto, description: '사용자 정보' })
  user: UserDto;

  @ApiProperty({ type: SessionDto, description: '세션 정보' })
  session: SessionDto;
}

export class GoogleOAuthUrlResponseDto {
  @ApiProperty({ description: 'Google OAuth 인증 URL' })
  url: string;
}

export class CheckEmailResponseDto {
  @ApiProperty({ description: '이메일 사용 가능 여부', example: true })
  available: boolean;

  @ApiPropertyOptional({
    description: '메시지',
    example: '사용 가능한 이메일입니다',
  })
  message?: string;
}

export class SuccessMessageResponseDto {
  @ApiProperty({ description: '성공 여부', example: true })
  success: boolean;

  @ApiPropertyOptional({ description: '메시지' })
  message?: string;
}
