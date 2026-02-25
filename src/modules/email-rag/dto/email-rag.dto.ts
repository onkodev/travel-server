import {
  IsOptional,
  IsString,
  IsInt,
  IsArray,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SearchEmailRagDto {
  @IsString()
  query: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  @Type(() => Number)
  limit?: number;
}

export class SyncEmailRagDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  batchSize?: number;
}

export interface EmailSearchResult {
  emailThreadId: number;
  subject: string | null;
  fromEmail: string | null;
  content: string;
  similarity: number;
}

export interface DraftItem {
  placeName: string;
  placeNameKor?: string;
  dayNumber: number;
  orderIndex: number;
  timeOfDay?: string;
  expectedDurationMins?: number;
  reason: string;
  itemId?: number;
  isTbd?: boolean;
}

export interface DraftResult {
  items: DraftItem[];
  ragSources: Array<{
    emailThreadId: number;
    subject: string | null;
    similarity: number;
  }>;
}

export class EmbedEstimatesDto {
  @IsArray()
  @IsInt({ each: true })
  @Type(() => Number)
  ids: number[];
}

export class AnalyzePlacesDto {
  @IsString()
  query: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  @Type(() => Number)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  similarityMin?: number;
}

export interface ExtractedPlace {
  name: string;
  nameKor: string | null;
  type: string;
  region: string | null;
  status: 'matched' | 'fuzzy' | 'unmatched';
  matchedItemId?: number;
  matchedItemName?: string;
  matchScore?: number;
}
