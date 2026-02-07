import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNumber, IsOptional, IsIn } from 'class-validator';
import { EstimateItemExtendedDto } from '../../estimate/dto/estimate-types.dto';

export class ModifyEstimateDto {
  @ApiProperty({
    description: '수정 액션 타입',
    enum: ['replace', 'add', 'remove'],
    example: 'replace',
  })
  @IsString()
  @IsIn(['replace', 'add', 'remove'])
  action: 'replace' | 'add' | 'remove';

  @ApiPropertyOptional({
    description: '대상 일차 (Day number)',
    example: 1,
  })
  @IsNumber()
  @IsOptional()
  dayNumber?: number;

  @ApiPropertyOptional({
    description: '교체할 아이템 ID',
    example: 123,
  })
  @IsNumber()
  @IsOptional()
  replaceItemId?: number;

  @ApiPropertyOptional({
    description: '추가 선호도 (예: "맛집", "쇼핑")',
    example: '맛집',
  })
  @IsString()
  @IsOptional()
  preference?: string;
}

export class GenerateEstimateResponseDto {
  @ApiProperty({ description: '생성된 견적 ID' })
  estimateId: number;

  @ApiProperty({ description: '공유 해시' })
  shareHash: string;
}

export class ModifyEstimateResponseDto {
  @ApiProperty({ description: '성공 여부' })
  success: boolean;

  @ApiProperty({
    description: '업데이트된 아이템 목록',
    type: [EstimateItemExtendedDto],
  })
  items: EstimateItemExtendedDto[];
}
