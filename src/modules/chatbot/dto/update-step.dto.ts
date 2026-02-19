import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsString,
  IsBoolean,
  IsOptional,
  IsArray,
  IsNumber,
  IsDateString,
  IsEmail,
  Min,
  Max,
  IsIn,
  ArrayMinSize,
  ArrayMaxSize,
  MaxLength,
  MinLength,
  ValidateNested,
  IsObject,
} from 'class-validator';
import {
  TOUR_TYPES,
  INTEREST_MAIN,
  INTEREST_SUB,
  REGIONS,
  ATTRACTIONS,
  BUDGET_RANGES,
  AGE_RANGES,
  REFERRAL_SOURCES,
} from '../constants/categories';

// Valid value arrays
const VALID_TOUR_TYPES = Object.keys(TOUR_TYPES);
const VALID_INTEREST_MAIN = Object.keys(INTEREST_MAIN);
const VALID_INTEREST_SUB = Object.keys(INTEREST_SUB);
const VALID_REGIONS = Object.keys(REGIONS);
const VALID_ATTRACTIONS = Object.keys(ATTRACTIONS);
const VALID_BUDGET_RANGES = Object.keys(BUDGET_RANGES);
const VALID_AGE_RANGES = Object.keys(AGE_RANGES);
const VALID_REFERRAL_SOURCES = Object.keys(REFERRAL_SOURCES);

// Step 1: Tour Type
export class UpdateStep1Dto {
  @ApiProperty({
    description: 'Tour type',
    enum: VALID_TOUR_TYPES,
  })
  @IsString()
  @IsIn(VALID_TOUR_TYPES, { message: 'Invalid tour type.' })
  tourType: string;
}

// Step 2: First Visit
export class UpdateStep2Dto {
  @ApiProperty({ description: 'First time visiting Korea' })
  @IsBoolean()
  isFirstVisit: boolean;
}

// Step 3: Interests (Main)
export class UpdateStep3MainDto {
  @ApiProperty({
    description: 'Main interests array',
    example: ['culture', 'food'],
    enum: VALID_INTEREST_MAIN,
    isArray: true,
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'Please select at least 1 interest.' })
  @ArrayMaxSize(4, { message: 'You can select up to 4 interests.' })
  @IsString({ each: true })
  @IsIn(VALID_INTEREST_MAIN, { each: true, message: 'Invalid interest.' })
  interestMain: string[];
}

// Step 3: Interests (Sub)
export class UpdateStep3SubDto {
  @ApiProperty({
    description: 'Sub interests array',
    example: ['historical', 'local_food'],
    enum: VALID_INTEREST_SUB,
    isArray: true,
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'Please select at least 1 specific interest.' })
  @ArrayMaxSize(16, { message: 'You can select up to 16 interests.' })
  @IsString({ each: true })
  @IsIn(VALID_INTEREST_SUB, { each: true, message: 'Invalid interest.' })
  interestSub: string[];
}

// Step 4: Region
export class UpdateStep4Dto {
  @ApiPropertyOptional({
    description: 'Region',
    example: 'seoul',
    enum: VALID_REGIONS,
  })
  @IsOptional()
  @IsString()
  @IsIn(VALID_REGIONS, { message: 'Invalid region.' })
  region?: string;
}

// Plan (계획유무 - 클라이언트 Step 3)
export class UpdatePlanDto {
  @ApiProperty({ description: 'Has specific plan/itinerary' })
  @IsBoolean()
  hasPlan: boolean;

  @ApiPropertyOptional({
    description: 'Plan details (if hasPlan is true)',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Plan details cannot exceed 2000 characters.' })
  planDetails?: string;

  @ApiProperty({ description: 'Flexible to modify plan' })
  @IsBoolean()
  isFlexible: boolean;
}

// Step 5: Attractions
export class UpdateStep5Dto {
  @ApiPropertyOptional({
    description: 'Attractions array',
    example: ['gyeongbokgung', 'bukchon'],
    enum: VALID_ATTRACTIONS,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10, { message: 'You can select up to 10 attractions.' })
  @IsString({ each: true })
  @IsIn(VALID_ATTRACTIONS, { each: true, message: 'Invalid attraction.' })
  attractions?: string[];
}

// Step 6: Personal Info + Travel Info (Combined)
export class UpdateStep6Dto {
  // Personal Info
  @ApiProperty({ description: 'Customer name', minLength: 2, maxLength: 100 })
  @IsString()
  @MinLength(2, { message: 'Name must be at least 2 characters.' })
  @MaxLength(100, { message: 'Name cannot exceed 100 characters.' })
  customerName: string;

  @ApiProperty({ description: 'Customer email' })
  @IsEmail({}, { message: 'Please enter a valid email address.' })
  @MaxLength(255, { message: 'Email cannot exceed 255 characters.' })
  customerEmail: string;

  @ApiPropertyOptional({ description: 'Customer phone' })
  @IsOptional()
  @IsString()
  @MaxLength(30, { message: 'Phone number cannot exceed 30 characters.' })
  customerPhone?: string;

  @ApiPropertyOptional({ description: 'Nationality', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Nationality cannot exceed 100 characters.' })
  nationality?: string;

  // Travel Info
  @ApiProperty({ description: 'Travel start date', example: '2024-06-15' })
  @IsDateString({}, { message: 'Please enter a valid date (YYYY-MM-DD).' })
  travelDate: string;

  @ApiProperty({
    description: 'Duration in days',
    example: 3,
    minimum: 1,
    maximum: 30,
  })
  @IsNumber()
  @Min(1, { message: 'Duration must be at least 1 day.' })
  @Max(30, { message: 'Duration cannot exceed 30 days.' })
  duration: number;

  // Group Info
  @ApiPropertyOptional({
    description: 'Adults count (13-64)',
    default: 1,
    minimum: 1,
    maximum: 50,
  })
  @IsOptional()
  @IsNumber()
  @Min(1, { message: 'At least 1 adult is required.' })
  @Max(50, { message: 'Group size cannot exceed 50 people.' })
  adultsCount?: number;

  @ApiPropertyOptional({
    description: 'Children count (3-12)',
    default: 0,
    minimum: 0,
    maximum: 50,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(50, { message: 'Group size cannot exceed 50 people.' })
  childrenCount?: number;

  @ApiPropertyOptional({
    description: 'Infants count (0-2)',
    default: 0,
    minimum: 0,
    maximum: 50,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(50, { message: 'Group size cannot exceed 50 people.' })
  infantsCount?: number;

  @ApiPropertyOptional({
    description: 'Seniors count (65+)',
    default: 0,
    minimum: 0,
    maximum: 50,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(50, { message: 'Group size cannot exceed 50 people.' })
  seniorsCount?: number;

  @ApiPropertyOptional({
    description: 'Primary age range',
    example: '20s-40s',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50, { message: 'Age range cannot exceed 50 characters.' })
  ageRange?: string;

  // Budget & Other
  @ApiPropertyOptional({
    description: 'Budget range',
    example: '100-200',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50, { message: 'Budget range cannot exceed 50 characters.' })
  budgetRange?: string;

  @ApiPropertyOptional({ description: 'Airport pickup needed' })
  @IsOptional()
  @IsBoolean()
  needsPickup?: boolean;

  @ApiPropertyOptional({ description: 'English guide / interpreter needed' })
  @IsOptional()
  @IsBoolean()
  needsGuide?: boolean;

  @ApiPropertyOptional({ description: 'Additional notes', maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000, {
    message: 'Additional notes cannot exceed 2000 characters.',
  })
  additionalNotes?: string;
}

// Step 7: Contact Info (Login required)
export class UpdateStep7Dto {
  @ApiProperty({ description: 'Customer name', minLength: 2, maxLength: 100 })
  @IsString()
  @MinLength(2, { message: 'Name must be at least 2 characters.' })
  @MaxLength(100, { message: 'Name cannot exceed 100 characters.' })
  customerName: string;

  @ApiProperty({ description: 'Customer email' })
  @IsEmail({}, { message: 'Please enter a valid email address.' })
  @MaxLength(255, { message: 'Email cannot exceed 255 characters.' })
  customerEmail: string;

  @ApiPropertyOptional({ description: 'Customer phone' })
  @IsOptional()
  @IsString()
  @MaxLength(30, { message: 'Phone number cannot exceed 30 characters.' })
  customerPhone?: string;

  @ApiPropertyOptional({ description: 'Nationality', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Nationality cannot exceed 100 characters.' })
  nationality?: string;

  @ApiPropertyOptional({
    description: 'Referral source',
    enum: VALID_REFERRAL_SOURCES,
  })
  @IsOptional()
  @IsString()
  @IsIn(VALID_REFERRAL_SOURCES, { message: 'Invalid referral source.' })
  referralSource?: string;

  @ApiPropertyOptional({ description: 'Additional notes', maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000, {
    message: 'Additional notes cannot exceed 2000 characters.',
  })
  additionalNotes?: string;
}

// Revision Item Change DTO
export class RevisionItemChangeDto {
  @ApiProperty({ description: 'Index of item in estimate items array' })
  @IsNumber()
  @Min(0)
  itemIndex: number;

  @ApiProperty({ description: 'Action for this item', enum: ['keep', 'remove', 'replace'] })
  @IsString()
  @IsIn(['keep', 'remove', 'replace'])
  action: 'keep' | 'remove' | 'replace';

  @ApiPropertyOptional({ description: 'Preference for replacement', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  preference?: string;
}

// Revision Group Change DTO
export class RevisionGroupChangeDto {
  @ApiPropertyOptional({ description: 'New adults count' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(50)
  adults?: number;

  @ApiPropertyOptional({ description: 'New children count' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(50)
  children?: number;

  @ApiPropertyOptional({ description: 'New infants count' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(50)
  infants?: number;
}

// Revision Details DTO (structured modification request)
export class RevisionDetailsDto {
  @ApiPropertyOptional({ description: 'Item-level changes', type: [RevisionItemChangeDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RevisionItemChangeDto)
  items?: RevisionItemChangeDto[];

  @ApiPropertyOptional({ description: 'Requested date change', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  dateChange?: string;

  @ApiPropertyOptional({ description: 'Requested duration change (days)' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(30)
  durationChange?: number;

  @ApiPropertyOptional({ description: 'Group size change' })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => RevisionGroupChangeDto)
  groupChange?: RevisionGroupChangeDto;

  @ApiPropertyOptional({ description: 'Budget change request', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  budgetChange?: string;

  @ApiPropertyOptional({ description: 'Additional note', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

// Customer Response DTO
export class RespondToEstimateDto {
  @ApiProperty({
    description: 'Customer response',
    enum: ['approved', 'declined'],
  })
  @IsString()
  @IsIn(['approved', 'declined'], { message: 'Invalid response.' })
  response: 'approved' | 'declined';

  @ApiPropertyOptional({ description: 'Modification request (free text)', maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000, {
    message: 'Modification request cannot exceed 2000 characters.',
  })
  modificationRequest?: string;

  @ApiPropertyOptional({ description: 'Structured revision details' })
  @IsOptional()
  @ValidateNested()
  @Type(() => RevisionDetailsDto)
  revisionDetails?: RevisionDetailsDto;
}

// Page Visit Tracking
export class TrackPageDto {
  @ApiProperty({ description: 'Page path', maxLength: 500 })
  @IsString()
  @MaxLength(500, { message: 'Path cannot exceed 500 characters.' })
  path: string;
}

// Session Title Update
export class UpdateSessionTitleDto {
  @ApiProperty({ description: 'Session title', minLength: 1, maxLength: 200 })
  @IsString()
  @MinLength(1, { message: 'Please enter a title.' })
  @MaxLength(200, { message: 'Title cannot exceed 200 characters.' })
  title: string;
}
