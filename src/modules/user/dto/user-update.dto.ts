import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn } from 'class-validator';

export class UpdateUserStatusDto {
  @ApiProperty({
    description: '활성화 상태',
    example: true,
  })
  @IsBoolean()
  isActive: boolean;
}

export class UpdateUserRoleDto {
  @ApiProperty({
    description: '사용자 역할',
    example: 'user',
    enum: ['user', 'admin', 'agent'],
  })
  @IsIn(['user', 'admin', 'agent'])
  role: 'user' | 'admin' | 'agent';
}
