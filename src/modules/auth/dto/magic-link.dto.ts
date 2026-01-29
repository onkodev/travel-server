import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString } from 'class-validator';

export class MagicLinkDto {
  @ApiProperty({
    description: '이메일 주소',
    example: 'user@example.com',
  })
  @IsEmail({}, { message: '올바른 이메일 형식이 아닙니다' })
  email: string;

  @ApiPropertyOptional({
    description: '매직링크 클릭 후 리다이렉트 URL',
    example: 'http://localhost:3000/auth/callback',
  })
  @IsOptional()
  @IsString()
  redirectTo?: string;
}
