import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsObject } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto';

export class TemplateDto {
  @ApiProperty({ description: '템플릿 ID' })
  id: number;

  @ApiProperty({ description: '템플릿 이름' })
  name: string;

  @ApiPropertyOptional({ description: '사용자 ID' })
  userId?: string;

  @ApiProperty({ description: '일정 아이템 데이터' })
  items: object;

  @ApiProperty({ description: '생성일' })
  createdAt: string;

  @ApiProperty({ description: '수정일' })
  updatedAt: string;
}

export class TemplateQueryDto extends PaginationQueryDto {}

export class CreateTemplateDto {
  @ApiProperty({
    description: '템플릿 이름',
    example: '제주도 3박 4일 기본 일정',
  })
  @IsString()
  name: string;

  @ApiProperty({ description: '일정 아이템 데이터' })
  @IsObject()
  items: object;
}

export class UpdateTemplateDto {
  @ApiPropertyOptional({ description: '템플릿 이름' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: '일정 아이템 데이터' })
  @IsOptional()
  @IsObject()
  items?: object;
}
