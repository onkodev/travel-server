import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class SignInDto {
  @ApiProperty({
    description: '이메일 주소',
    example: 'user@example.com',
  })
  @IsEmail({}, { message: '올바른 이메일 형식이 아닙니다' })
  email: string;

  @ApiProperty({
    description: '비밀번호',
    example: 'password123',
    minLength: 6,
  })
  @IsString()
  @MinLength(6, { message: '비밀번호는 6자 이상이어야 합니다' })
  password: string;
}
