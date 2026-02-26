import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsNumber,
  IsArray,
  IsIn,
  IsObject,
} from 'class-validator';
import {
  EstimateItemExtendedDto,
  DisplayOptionsDto,
  RevisionHistoryEntryDto,
} from './estimate-types.dto';
import { BaseEstimateDto } from './estimate-base.dto';

/**
 * 견적 생성 DTO
 * 클라이언트에서 전체 EstimateSchema를 보내므로 모든 필드 허용
 */
export class CreateEstimateDto extends BaseEstimateDto {
  // 읽기 전용 필드들 (서버에서 무시됨)
  @ApiPropertyOptional({ description: 'ID (서버에서 무시)' })
  @IsOptional()
  @IsNumber()
  id?: number;

  @ApiPropertyOptional({ description: '총 여행자 수 (서버에서 무시)' })
  @IsOptional()
  @IsNumber()
  totalTravelers?: number;

  @ApiProperty({ description: '제목' })
  @IsString()
  title: string;

  @ApiPropertyOptional({ description: '고객 이메일' })
  @IsOptional()
  @IsString()
  customerEmail?: string;

  @ApiPropertyOptional({ description: '소스', enum: ['manual', 'ai'] })
  @IsOptional()
  @IsIn(['manual', 'ai'])
  source?: string;

  @ApiPropertyOptional({ description: '여행 일수' })
  @IsOptional()
  @IsNumber()
  travelDays?: number;

  @ApiPropertyOptional({ description: '성인 수' })
  @IsOptional()
  @IsNumber()
  adultsCount?: number;

  @ApiPropertyOptional({ description: '어린이 수' })
  @IsOptional()
  @IsNumber()
  childrenCount?: number;

  @ApiPropertyOptional({ description: '유아 수' })
  @IsOptional()
  @IsNumber()
  infantsCount?: number;

  @ApiPropertyOptional({
    description: '견적 아이템 목록',
    type: [EstimateItemExtendedDto],
  })
  @IsOptional()
  @IsArray()
  items?: EstimateItemExtendedDto[];

  @ApiPropertyOptional({ description: '소계' })
  @IsOptional()
  @IsNumber()
  subtotal?: number;

  @ApiPropertyOptional({ description: '수동 조정 금액' })
  @IsOptional()
  @IsNumber()
  manualAdjustment?: number;

  @ApiPropertyOptional({ description: '총 금액' })
  @IsOptional()
  @IsNumber()
  totalAmount?: number;

  @ApiPropertyOptional({ description: '표시 옵션', type: DisplayOptionsDto })
  @IsOptional()
  @IsObject()
  displayOptions?: DisplayOptionsDto;

  @ApiPropertyOptional({
    description: '수정 이력',
    type: [RevisionHistoryEntryDto],
  })
  @IsOptional()
  @IsArray()
  revisionHistory?: RevisionHistoryEntryDto[];

  @ApiPropertyOptional({ description: '결제 금액' })
  @IsOptional()
  @IsNumber()
  paidAmount?: number;
}
