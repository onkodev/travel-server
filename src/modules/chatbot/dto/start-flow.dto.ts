import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsIn } from 'class-validator';
import { TOUR_TYPES } from '../constants/categories';

const VALID_TOUR_TYPES = Object.keys(TOUR_TYPES);

export class StartFlowDto {
  @ApiPropertyOptional({
    description: 'Tour type (Step 1 response)',
    enum: VALID_TOUR_TYPES,
  })
  @IsOptional()
  @IsString()
  @IsIn(VALID_TOUR_TYPES, { message: 'Invalid tour type.' })
  tourType?: string;

  @ApiPropertyOptional({ description: 'Landing page path' })
  @IsOptional()
  @IsString()
  landingPage?: string;

  @ApiPropertyOptional({ description: 'UTM Source' })
  @IsOptional()
  @IsString()
  utmSource?: string;

  @ApiPropertyOptional({ description: 'UTM Medium' })
  @IsOptional()
  @IsString()
  utmMedium?: string;

  @ApiPropertyOptional({ description: 'UTM Campaign' })
  @IsOptional()
  @IsString()
  utmCampaign?: string;

  @ApiPropertyOptional({ description: 'UTM Term' })
  @IsOptional()
  @IsString()
  utmTerm?: string;

  @ApiPropertyOptional({ description: 'UTM Content' })
  @IsOptional()
  @IsString()
  utmContent?: string;

  @ApiPropertyOptional({
    description: 'Visitor session ID (for site-wide tracking)',
  })
  @IsOptional()
  @IsString()
  visitorId?: string;

  @ApiPropertyOptional({
    description: 'Session title (e.g., selected tour type label)',
  })
  @IsOptional()
  @IsString()
  title?: string;
}
