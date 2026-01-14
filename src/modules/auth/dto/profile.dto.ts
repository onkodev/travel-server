import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional({
    description: '사용자 이름',
    example: '홍길동',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    description: '전화번호',
    example: '010-1234-5678',
  })
  @IsOptional()
  @IsString()
  phone?: string;
}
