import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class GoogleOAuthUrlDto {
  @ApiProperty({
    description: 'OAuth 인증 후 리다이렉트될 URL',
    example: 'http://localhost:3000/auth/callback',
  })
  @IsString()
  redirectTo: string;
}

export class GoogleCallbackDto {
  @ApiProperty({
    description: 'Google에서 받은 인증 코드',
    example: '4/0AX4XfWj...',
  })
  @IsString()
  code: string;
}
