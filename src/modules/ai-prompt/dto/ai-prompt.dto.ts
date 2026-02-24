import {
  IsOptional,
  IsString,
  IsNumber,
  IsInt,
  IsIn,
  IsBoolean,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateAiPromptDto {
  @IsOptional()
  @IsString()
  promptText?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  @Type(() => Number)
  temperature?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(65536)
  @Type(() => Number)
  maxOutputTokens?: number | null;
}

export class AiPromptQueryDto {
  @IsOptional()
  @IsString()
  category?: string;
}

export class UpdateEstimateConfigDto {
  @IsOptional()
  @IsString()
  @IsIn(['gemini-2.5-flash', 'gemini-2.0-flash'])
  geminiModel?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  @Type(() => Number)
  geminiTemperature?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65536)
  @Type(() => Number)
  geminiMaxTokens?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  @Type(() => Number)
  ragSearchLimit?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  @Type(() => Number)
  ragEstimateLimit?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  @Type(() => Number)
  ragSimilarityMin?: number;

  @IsOptional()
  @IsInt()
  @Min(5000)
  @Max(60000)
  @Type(() => Number)
  ragTimeout?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  @Type(() => Number)
  placesPerDay?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  @Type(() => Number)
  fuzzyMatchThreshold?: number;

  @IsOptional()
  @IsString()
  customPromptAddon?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  @Type(() => Number)
  aiEstimateValidityDays?: number;

  @IsOptional()
  @IsBoolean()
  includeTbdItems?: boolean;
}

export class UpdateFaqChatConfigDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  @Type(() => Number)
  topFaqCount?: number;

  @IsOptional()
  @IsString()
  noMatchResponse?: string | null;

  @IsOptional()
  @IsString()
  @IsIn(['precise', 'balanced', 'conversational'])
  faqAnswerStyle?: string;

  @IsOptional()
  @IsString()
  @IsIn(['concise', 'standard', 'detailed'])
  faqAnswerLength?: string;

  @IsOptional()
  @IsString()
  faqCustomInstructions?: string | null;
}
