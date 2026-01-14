import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsEmail } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({
    description: '리프레시 토큰',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @IsString()
  refreshToken: string;
}

export class CheckEmailDto {
  @ApiProperty({
    description: '확인할 이메일 주소',
    example: 'user@example.com',
  })
  @IsEmail({}, { message: '올바른 이메일 형식이 아닙니다' })
  email: string;
}

export class ResendVerificationDto {
  @ApiProperty({
    description: '인증 이메일을 받을 이메일 주소',
    example: 'user@example.com',
  })
  @IsEmail({}, { message: '올바른 이메일 형식이 아닙니다' })
  email: string;

  @ApiProperty({
    description: '이메일 인증 후 리다이렉트될 URL',
    example: 'http://localhost:3000/auth/verified',
  })
  @IsString()
  redirectTo: string;
}
