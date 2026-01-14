import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsBoolean, IsIn } from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationQueryDto } from '../../../common/dto';

export class UserListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: '검색 키워드 (이름, 이메일)',
    example: '홍길동',
  })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiPropertyOptional({
    description: '활성화 상태 필터',
    example: true,
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === 'true' ? true : value === 'false' ? false : undefined,
  )
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: '정렬 컬럼',
    example: 'createdAt',
    enum: ['name', 'email', 'createdAt', 'lastLoginAt'],
  })
  @IsOptional()
  @IsString()
  sortColumn?: string;

  @ApiPropertyOptional({
    description: '정렬 방향',
    example: 'desc',
    enum: ['asc', 'desc'],
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection?: 'asc' | 'desc';
}
