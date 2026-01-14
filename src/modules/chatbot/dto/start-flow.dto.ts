import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class StartFlowDto {
  @ApiPropertyOptional({ description: '랜딩 페이지 경로' })
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
}
