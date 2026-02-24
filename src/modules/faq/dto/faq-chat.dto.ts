import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsOptional,
  IsIn,
  IsArray,
  IsUUID,
  MaxLength,
  MinLength,
  ArrayMaxSize,
  ValidateNested,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';

// ============================================================================
// FAQ Chat DTOs
// ============================================================================

class FaqChatHistoryItem {
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  @IsString()
  content: string;
}

export class FaqChatDto {
  @ApiProperty({ description: '사용자 메시지' })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  message: string;

  @ApiPropertyOptional({ description: '대화 이력 (멀티턴)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => FaqChatHistoryItem)
  history?: FaqChatHistoryItem[];

  @ApiPropertyOptional({ description: '방문자 ID (UUID)' })
  @IsOptional()
  @IsUUID()
  visitorId?: string;
}

export class FaqFeedbackDto {
  @ApiProperty({ description: '채팅 로그 ID' })
  @Type(() => Number)
  @IsNumber()
  chatLogId: number;

  @ApiProperty({
    description: '도움이 되었는지 여부 (true=thumbs up, false=thumbs down)',
  })
  @IsBoolean()
  helpful: boolean;
}

export class FaqRegenerateDto {
  @ApiProperty({ description: '재생성할 채팅 로그 ID' })
  @Type(() => Number)
  @IsNumber()
  chatLogId: number;
}
