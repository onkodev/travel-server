import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class OptionDto {
  @ApiProperty()
  value: string;

  @ApiProperty()
  label: string;

  @ApiPropertyOptional()
  labelKo?: string;

  @ApiPropertyOptional()
  main?: string;

  @ApiPropertyOptional()
  description?: string;

  @ApiPropertyOptional()
  descriptionKo?: string;

  @ApiPropertyOptional({ description: '상태 (available, coming_soon)' })
  status?: string;

  @ApiPropertyOptional({ description: '외부 리다이렉트 URL' })
  redirectUrl?: string | null;

  @ApiPropertyOptional({ description: '카테고리 (어트랙션용)' })
  category?: string;

  @ApiPropertyOptional({ description: '지역 (어트랙션용)' })
  region?: string;
}

class FieldDto {
  @ApiProperty()
  name: string;

  @ApiProperty()
  type: string;

  @ApiProperty()
  label: string;

  @ApiPropertyOptional()
  labelKo?: string;

  @ApiPropertyOptional()
  required?: boolean;

  @ApiPropertyOptional()
  default?: unknown;

  @ApiPropertyOptional({ type: [OptionDto] })
  options?: OptionDto[];

  @ApiPropertyOptional({ description: '폼 섹션 (personal, travel, group, budget)' })
  section?: string;
}

export class StepResponseDto {
  @ApiProperty({ description: '단계 번호' })
  step: number;

  @ApiPropertyOptional({ description: '서브 단계 (main/sub)' })
  subStep?: string;

  @ApiProperty({ description: '질문 제목 (영문)' })
  title: string;

  @ApiPropertyOptional({ description: '질문 제목 (한글)' })
  titleKo?: string;

  @ApiProperty({
    description: '질문 타입',
    enum: ['single_select', 'multi_select', 'form', 'boolean'],
  })
  type: 'single_select' | 'multi_select' | 'form' | 'boolean';

  @ApiProperty({ description: '필수 여부' })
  required: boolean;

  @ApiPropertyOptional({ type: [OptionDto], description: '선택지 목록' })
  options?: OptionDto[];

  @ApiPropertyOptional({ type: [FieldDto], description: '폼 필드 목록' })
  fields?: FieldDto[];

  @ApiPropertyOptional({ description: '현재 저장된 값' })
  currentValue?: unknown;

  @ApiPropertyOptional({ description: '인증 필요 여부' })
  requiresAuth?: boolean;

  @ApiPropertyOptional({ description: '인증 필요 시 메시지' })
  message?: string;

  @ApiPropertyOptional({ description: '인증 필요 시 리다이렉트 URL' })
  redirectTo?: string;
}

export class FlowStartResponseDto {
  @ApiProperty({ description: '세션 ID' })
  sessionId: string;

  @ApiProperty({ description: '현재 단계' })
  currentStep: number;
}
