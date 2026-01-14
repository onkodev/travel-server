import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  Matches,
} from 'class-validator';
import {
  TOUR_TYPES,
  INTEREST_MAIN,
  INTEREST_SUB,
  REGIONS,
  ATTRACTIONS,
  BUDGET_RANGES,
  REFERRAL_SOURCES,
} from '../constants/categories';

// 유효한 값 배열 추출
const VALID_TOUR_TYPES = Object.keys(TOUR_TYPES);
const VALID_INTEREST_MAIN = Object.keys(INTEREST_MAIN);
const VALID_INTEREST_SUB = Object.keys(INTEREST_SUB);
const VALID_REGIONS = Object.keys(REGIONS);
const VALID_ATTRACTIONS = Object.keys(ATTRACTIONS);
const VALID_BUDGET_RANGES = Object.keys(BUDGET_RANGES);
const VALID_REFERRAL_SOURCES = Object.keys(REFERRAL_SOURCES);

// Step 1: 투어 타입
export class UpdateStep1Dto {
  @ApiProperty({
    description: '투어 타입',
    enum: VALID_TOUR_TYPES,
  })
  @IsString()
  @IsIn(VALID_TOUR_TYPES, { message: '유효하지 않은 투어 타입입니다.' })
  tourType: string;
}

// Step 2: 한국 첫 방문
export class UpdateStep2Dto {
  @ApiProperty({ description: '한국 첫 방문 여부' })
  @IsBoolean()
  isFirstVisit: boolean;
}

// Step 3: 관심사 (메인)
export class UpdateStep3MainDto {
  @ApiProperty({
    description: '메인 관심사 배열',
    example: ['culture', 'food'],
    enum: VALID_INTEREST_MAIN,
    isArray: true,
  })
  @IsArray()
  @ArrayMinSize(1, { message: '최소 1개 이상의 관심사를 선택해주세요.' })
  @ArrayMaxSize(4, { message: '최대 4개까지 선택 가능합니다.' })
  @IsString({ each: true })
  @IsIn(VALID_INTEREST_MAIN, { each: true, message: '유효하지 않은 관심사입니다.' })
  interestMain: string[];
}

// Step 3: 관심사 (서브)
export class UpdateStep3SubDto {
  @ApiProperty({
    description: '서브 관심사 배열',
    example: ['historical', 'local_food'],
    enum: VALID_INTEREST_SUB,
    isArray: true,
  })
  @IsArray()
  @ArrayMinSize(1, { message: '최소 1개 이상의 세부 관심사를 선택해주세요.' })
  @ArrayMaxSize(16, { message: '최대 16개까지 선택 가능합니다.' })
  @IsString({ each: true })
  @IsIn(VALID_INTEREST_SUB, { each: true, message: '유효하지 않은 세부 관심사입니다.' })
  interestSub: string[];
}

// Step 4: 지역
export class UpdateStep4Dto {
  @ApiPropertyOptional({
    description: '지역',
    example: 'seoul',
    enum: VALID_REGIONS,
  })
  @IsOptional()
  @IsString()
  @IsIn(VALID_REGIONS, { message: '유효하지 않은 지역입니다.' })
  region?: string;
}

// Step 5: 명소
export class UpdateStep5Dto {
  @ApiPropertyOptional({
    description: '명소 배열',
    example: ['gyeongbokgung', 'bukchon'],
    enum: VALID_ATTRACTIONS,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10, { message: '최대 10개까지 선택 가능합니다.' })
  @IsString({ each: true })
  @IsIn(VALID_ATTRACTIONS, { each: true, message: '유효하지 않은 명소입니다.' })
  attractions?: string[];
}

// Step 6: 여행 정보
export class UpdateStep6Dto {
  @ApiProperty({ description: '여행 시작일', example: '2024-06-15' })
  @IsDateString({}, { message: '유효한 날짜 형식이 아닙니다. (YYYY-MM-DD)' })
  travelDate: string;

  @ApiProperty({ description: '여행 일수', example: 3, minimum: 1, maximum: 30 })
  @IsNumber()
  @Min(1, { message: '여행 일수는 최소 1일 이상이어야 합니다.' })
  @Max(30, { message: '여행 일수는 최대 30일까지입니다.' })
  duration: number;

  @ApiPropertyOptional({ description: '성인 수', default: 1, minimum: 1, maximum: 50 })
  @IsOptional()
  @IsNumber()
  @Min(1, { message: '성인은 최소 1명 이상이어야 합니다.' })
  @Max(50, { message: '인원은 최대 50명까지입니다.' })
  adultsCount?: number;

  @ApiPropertyOptional({ description: '어린이 수 (3-12세)', default: 0, minimum: 0, maximum: 50 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(50, { message: '인원은 최대 50명까지입니다.' })
  childrenCount?: number;

  @ApiPropertyOptional({ description: '유아 수 (0-2세)', default: 0, minimum: 0, maximum: 50 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(50, { message: '인원은 최대 50명까지입니다.' })
  infantsCount?: number;

  @ApiPropertyOptional({ description: '시니어 수 (65세+)', default: 0, minimum: 0, maximum: 50 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(50, { message: '인원은 최대 50명까지입니다.' })
  seniorsCount?: number;

  @ApiPropertyOptional({
    description: '예산 범위',
    enum: VALID_BUDGET_RANGES,
  })
  @IsOptional()
  @IsString()
  @IsIn(VALID_BUDGET_RANGES, { message: '유효하지 않은 예산 범위입니다.' })
  budgetRange?: string;

  @ApiPropertyOptional({ description: '공항 픽업 필요 여부' })
  @IsOptional()
  @IsBoolean()
  needsPickup?: boolean;
}

// Step 7: 연락처 (로그인 필수)
export class UpdateStep7Dto {
  @ApiProperty({ description: '고객 이름', minLength: 2, maxLength: 100 })
  @IsString()
  @MinLength(2, { message: '이름은 최소 2자 이상이어야 합니다.' })
  @MaxLength(100, { message: '이름은 최대 100자까지입니다.' })
  customerName: string;

  @ApiProperty({ description: '고객 이메일' })
  @IsEmail({}, { message: '유효한 이메일 형식이 아닙니다.' })
  @MaxLength(255, { message: '이메일은 최대 255자까지입니다.' })
  customerEmail: string;

  @ApiPropertyOptional({ description: '고객 전화번호' })
  @IsOptional()
  @IsString()
  @Matches(/^[\+]?[(]?[0-9]{1,3}[)]?[-\s\.]?[0-9]{1,4}[-\s\.]?[0-9]{1,4}[-\s\.]?[0-9]{1,9}$/, {
    message: '유효한 전화번호 형식이 아닙니다.',
  })
  @MaxLength(30, { message: '전화번호는 최대 30자까지입니다.' })
  customerPhone?: string;

  @ApiPropertyOptional({ description: '국적', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: '국적은 최대 100자까지입니다.' })
  nationality?: string;

  @ApiPropertyOptional({
    description: '유입 경로',
    enum: VALID_REFERRAL_SOURCES,
  })
  @IsOptional()
  @IsString()
  @IsIn(VALID_REFERRAL_SOURCES, { message: '유효하지 않은 유입 경로입니다.' })
  referralSource?: string;

  @ApiPropertyOptional({ description: '추가 요청사항', maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: '추가 요청사항은 최대 2000자까지입니다.' })
  additionalNotes?: string;
}

// 고객 응답 DTO
export class RespondToEstimateDto {
  @ApiProperty({
    description: '고객 응답',
    enum: ['accepted', 'declined'],
  })
  @IsString()
  @IsIn(['accepted', 'declined'], { message: '유효하지 않은 응답입니다.' })
  response: 'accepted' | 'declined';

  @ApiPropertyOptional({ description: '수정 요청사항', maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: '수정 요청사항은 최대 2000자까지입니다.' })
  modificationRequest?: string;
}

// 페이지 방문 기록
export class TrackPageDto {
  @ApiProperty({ description: '페이지 경로', maxLength: 500 })
  @IsString()
  @MaxLength(500, { message: '경로는 최대 500자까지입니다.' })
  path: string;
}

// 세션 제목 업데이트
export class UpdateSessionTitleDto {
  @ApiProperty({ description: '세션 제목', minLength: 1, maxLength: 200 })
  @IsString()
  @MinLength(1, { message: '제목을 입력해주세요.' })
  @MaxLength(200, { message: '제목은 최대 200자까지입니다.' })
  title: string;
}
