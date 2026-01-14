import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class UpdatePasswordDto {
  @ApiProperty({
    description: '새 비밀번호 (6자 이상)',
    example: 'newpassword123',
    minLength: 6,
  })
  @IsString()
  @MinLength(6, { message: '비밀번호는 6자 이상이어야 합니다' })
  password: string;
}

export class ForgotPasswordDto {
  @ApiProperty({
    description: '비밀번호 재설정을 받을 이메일 주소',
    example: 'user@example.com',
  })
  @IsString()
  email: string;

  @ApiProperty({
    description: '비밀번호 재설정 후 리다이렉트될 URL',
    example: 'http://localhost:3000/reset-password',
  })
  @IsString()
  redirectTo: string;
}

export class ResetPasswordDto {
  @ApiProperty({
    description: '비밀번호 재설정 토큰',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @IsString()
  accessToken: string;

  @ApiProperty({
    description: '새 비밀번호 (6자 이상)',
    example: 'newpassword123',
    minLength: 6,
  })
  @IsString()
  @MinLength(6, { message: '비밀번호는 6자 이상이어야 합니다' })
  password: string;
}
