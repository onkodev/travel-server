import {
  IsOptional,
  IsNumber,
  IsString,
  IsBoolean,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateGenerationConfigDto {
  @ApiPropertyOptional({ description: 'AI 활성화 여부', example: true })
  @IsOptional()
  @IsBoolean()
  aiEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'Gemini 모델명',
    example: 'gemini-2.5-flash',
  })
  @IsOptional()
  @IsString()
  geminiModel?: string;

  @ApiPropertyOptional({ description: 'RAG 검색 개수', example: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(20)
  ragSearchLimit?: number;

  @ApiPropertyOptional({ description: 'RAG 유사도 임계값', example: 0.3 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(0.9)
  ragSimilarityMin?: number;

  @ApiPropertyOptional({ description: 'RAG 타임아웃 (ms)', example: 25000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(5000)
  @Max(60000)
  ragTimeout?: number;

  @ApiPropertyOptional({ description: 'Gemini temperature', example: 0.7 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  geminiTemperature?: number;

  @ApiPropertyOptional({ description: 'Gemini max tokens', example: 4096 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(512)
  @Max(8192)
  geminiMaxTokens?: number;

  @ApiPropertyOptional({ description: '일일 장소 수', example: 4 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(2)
  @Max(8)
  placesPerDay?: number;

  @ApiPropertyOptional({ description: '커스텀 프롬프트 추가 문구' })
  @IsOptional()
  @IsString()
  customPromptAddon?: string;

  @ApiPropertyOptional({ description: 'Fuzzy 매칭 임계값', example: 0.3 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(0.9)
  fuzzyMatchThreshold?: number;

  @ApiPropertyOptional({ description: 'Direct 매칭 임계값', example: 0.7 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(0.9)
  directThreshold?: number;

  @ApiPropertyOptional({ description: 'RAG 매칭 임계값', example: 0.5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(0.9)
  ragThreshold?: number;

  @ApiPropertyOptional({ description: '매칭 실패 시 응답 메시지' })
  @IsOptional()
  @IsString()
  noMatchResponse?: string;

  @ApiPropertyOptional({ description: '수동 견적 유효기간 (일)', example: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(30)
  estimateValidityDays?: number;

  @ApiPropertyOptional({ description: 'AI 견적 유효기간 (일)', example: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(30)
  aiEstimateValidityDays?: number;

  @ApiPropertyOptional({ description: 'TBD 항목 포함 여부', example: true })
  @IsOptional()
  @IsBoolean()
  includeTbdItems?: boolean;
}
