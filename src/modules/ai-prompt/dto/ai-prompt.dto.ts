import { IsOptional, IsString, IsNumber, Min, Max } from 'class-validator';
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

export class UpdateFaqChatConfigDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  @Type(() => Number)
  directThreshold?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  @Type(() => Number)
  ragThreshold?: number;

  @IsOptional()
  @IsString()
  noMatchResponse?: string | null;
}
