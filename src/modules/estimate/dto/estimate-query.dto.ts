import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsBoolean, IsIn } from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationQueryDto } from '../../../common/dto';

export class EstimateListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: '견적 출처',
    enum: ['manual', 'ai'],
    example: 'manual',
  })
  @IsOptional()
  @IsIn(['manual', 'ai'])
  source?: string;

  @ApiPropertyOptional({
    description: '수동 견적 상태 필터',
    example: 'planning',
  })
  @IsOptional()
  @IsString()
  statusManual?: string;

  @ApiPropertyOptional({
    description: 'AI 견적 상태 필터',
    example: 'draft',
  })
  @IsOptional()
  @IsString()
  statusAi?: string;

  @ApiPropertyOptional({
    description: '제외할 수동 견적 상태',
    example: 'archived',
  })
  @IsOptional()
  @IsString()
  excludeStatusManual?: string;

  @ApiPropertyOptional({
    description: '검색어 (제목, 고객명)',
    example: '홍길동',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: '시작일 필터 (이후)',
    example: '2024-01-01',
  })
  @IsOptional()
  @IsString()
  dateFrom?: string;

  @ApiPropertyOptional({
    description: '종료일 필터 (이전)',
    example: '2024-12-31',
  })
  @IsOptional()
  @IsString()
  dateTo?: string;

  @ApiPropertyOptional({
    description: '고정 여부 필터',
    example: true,
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === 'true' ? true : value === 'false' ? false : undefined,
  )
  @IsBoolean()
  isPinned?: boolean;

  @ApiPropertyOptional({
    description: '예정 견적 필터 (5일 이내 시작)',
    example: true,
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === 'true' ? true : value === 'false' ? false : undefined,
  )
  @IsBoolean()
  upcoming?: boolean;
}
