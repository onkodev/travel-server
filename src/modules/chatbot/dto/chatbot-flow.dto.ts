import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ChatbotFlowDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  sessionId: string;

  @ApiProperty()
  currentStep: number;

  @ApiProperty()
  isCompleted: boolean;

  @ApiPropertyOptional()
  tourType?: string;

  @ApiPropertyOptional()
  isFirstVisit?: boolean;

  @ApiPropertyOptional({ type: [String] })
  interestMain?: string[];

  @ApiPropertyOptional({ type: [String] })
  interestSub?: string[];

  @ApiPropertyOptional()
  region?: string;

  @ApiPropertyOptional({ type: [String] })
  attractions?: string[];

  @ApiPropertyOptional()
  travelDate?: Date;

  @ApiPropertyOptional()
  duration?: number;

  @ApiPropertyOptional()
  adultsCount?: number;

  @ApiPropertyOptional()
  childrenCount?: number;

  @ApiPropertyOptional()
  infantsCount?: number;

  @ApiPropertyOptional()
  seniorsCount?: number;

  @ApiPropertyOptional()
  budgetRange?: string;

  @ApiPropertyOptional()
  needsPickup?: boolean;

  @ApiPropertyOptional()
  userId?: string;

  @ApiPropertyOptional()
  customerName?: string;

  @ApiPropertyOptional()
  customerEmail?: string;

  @ApiPropertyOptional()
  customerPhone?: string;

  @ApiPropertyOptional()
  nationality?: string;

  @ApiPropertyOptional()
  referralSource?: string;

  @ApiPropertyOptional()
  additionalNotes?: string;

  @ApiPropertyOptional()
  estimateId?: number;

  @ApiPropertyOptional()
  ipAddress?: string;

  @ApiPropertyOptional()
  userAgent?: string;

  @ApiPropertyOptional()
  referrerUrl?: string;

  @ApiPropertyOptional()
  landingPage?: string;

  @ApiPropertyOptional()
  utmSource?: string;

  @ApiPropertyOptional()
  utmMedium?: string;

  @ApiPropertyOptional()
  utmCampaign?: string;

  @ApiPropertyOptional()
  utmTerm?: string;

  @ApiPropertyOptional()
  utmContent?: string;

  @ApiPropertyOptional()
  pageVisits?: object[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class ChatbotFlowSummaryDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  sessionId: string;

  @ApiProperty()
  currentStep: number;

  @ApiProperty()
  isCompleted: boolean;

  @ApiPropertyOptional()
  tourType?: string;

  @ApiPropertyOptional()
  customerName?: string;

  @ApiPropertyOptional()
  customerEmail?: string;

  @ApiPropertyOptional()
  ipAddress?: string;

  @ApiPropertyOptional()
  utmSource?: string;

  @ApiPropertyOptional()
  referrerUrl?: string;

  @ApiProperty()
  createdAt: Date;
}
