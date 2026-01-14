import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsOptional,
  IsBoolean,
  IsArray,
  Min,
  Max,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { PaginationQueryDto } from '../../../common/dto';

export class ReviewDto {
  @ApiProperty({ description: '리뷰 ID' })
  id: number;

  @ApiProperty({ description: '투어 ID' })
  tourId: number;

  @ApiPropertyOptional({ description: '예약 ID' })
  bookingId?: number;

  @ApiProperty({ description: '평점 (1-5)', minimum: 1, maximum: 5 })
  rating: number;

  @ApiPropertyOptional({ description: '리뷰 내용' })
  content?: string;

  @ApiPropertyOptional({ description: '이미지 URL 목록', type: [String] })
  images?: string[];

  @ApiProperty({ description: '작성자 이름' })
  reviewerName: string;

  @ApiPropertyOptional({ description: '작성자 이메일' })
  reviewerEmail?: string;

  @ApiProperty({ description: '관리자 생성 여부', default: false })
  isAdminCreated: boolean;

  @ApiProperty({ description: '표시 여부', default: true })
  isVisible: boolean;

  @ApiProperty({ description: '생성일' })
  createdAt: string;
}

export class ReviewQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: '투어 ID 필터' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  tourId?: number;

  @ApiPropertyOptional({ description: '표시 여부 필터' })
  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  isVisible?: boolean;
}

export class CreateReviewDto {
  @ApiProperty({ description: '투어 ID' })
  @IsNumber()
  tourId: number;

  @ApiPropertyOptional({ description: '예약 ID' })
  @IsOptional()
  @IsNumber()
  bookingId?: number;

  @ApiProperty({ description: '평점 (1-5)', minimum: 1, maximum: 5 })
  @IsNumber()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiPropertyOptional({ description: '리뷰 내용' })
  @IsOptional()
  @IsString()
  content?: string;

  @ApiPropertyOptional({ description: '이미지 URL 목록', type: [String] })
  @IsOptional()
  @IsArray()
  images?: string[];

  @ApiProperty({ description: '작성자 이름' })
  @IsString()
  reviewerName: string;

  @ApiPropertyOptional({ description: '작성자 이메일' })
  @IsOptional()
  @IsString()
  reviewerEmail?: string;

  @ApiPropertyOptional({ description: '관리자 생성 여부', default: false })
  @IsOptional()
  @IsBoolean()
  isAdminCreated?: boolean;
}

export class UpdateReviewDto {
  @ApiPropertyOptional({ description: '평점 (1-5)', minimum: 1, maximum: 5 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(5)
  rating?: number;

  @ApiPropertyOptional({ description: '리뷰 제목' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ description: '리뷰 내용' })
  @IsOptional()
  @IsString()
  content?: string;

  @ApiPropertyOptional({ description: '이미지 URL 목록', type: [String] })
  @IsOptional()
  @IsArray()
  imageUrls?: string[];

  @ApiPropertyOptional({ description: '표시 여부' })
  @IsOptional()
  @IsBoolean()
  isVisible?: boolean;
}
