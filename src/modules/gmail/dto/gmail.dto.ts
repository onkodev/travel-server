import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationQueryDto } from '../../../common/dto';

export class BatchSyncDto {
  @ApiPropertyOptional({ description: '가져올 최대 이메일 수', default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxResults?: number;

  @ApiPropertyOptional({ description: '검색 쿼리 (Gmail 검색 구문)' })
  @IsOptional()
  @IsString()
  query?: string;
}

export class ThreadQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: '처리 상태 필터' })
  @IsOptional()
  @IsString()
  processed?: string;

  @ApiPropertyOptional({ description: '검색어' })
  @IsOptional()
  @IsString()
  search?: string;
}
