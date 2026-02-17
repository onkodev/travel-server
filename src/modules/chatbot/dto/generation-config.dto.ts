import {
  IsOptional,
  IsNumber,
  IsString,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateGenerationConfigDto {
  @ApiPropertyOptional({ description: 'Gemini 모델명', example: 'gemini-2.5-flash' })
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
}
