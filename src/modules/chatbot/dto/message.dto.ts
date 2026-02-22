import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsNotEmpty,
  IsIn,
  IsArray,
  ArrayMaxSize,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class MessageOptionDto {
  @ApiProperty({ description: '옵션 값' })
  @IsString()
  @IsNotEmpty()
  value: string;

  @ApiProperty({ description: '옵션 라벨' })
  @IsString()
  @IsNotEmpty()
  label: string;

  @ApiPropertyOptional({ description: '서브 라벨' })
  @IsOptional()
  @IsString()
  sub?: string;
}

export class SaveMessageDto {
  @ApiProperty({ description: '메시지 역할', enum: ['bot', 'user', 'admin'] })
  @IsString()
  @IsIn(['bot', 'user', 'admin'])
  role: 'bot' | 'user' | 'admin';

  @ApiProperty({ description: '메시지 내용' })
  @IsString()
  @MaxLength(10000)
  content: string;

  @ApiPropertyOptional({
    description: '메시지 타입',
    enum: ['text', 'options', 'form', 'estimate', 'quickReply'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['text', 'options', 'form', 'estimate', 'quickReply'])
  messageType?: 'text' | 'options' | 'form' | 'estimate' | 'quickReply';

  @ApiPropertyOptional({ description: '선택지 옵션 또는 견적 데이터' })
  @IsOptional()
  options?: unknown;
}

// 배치 메시지 저장 DTO
export class SaveMessageBatchDto {
  @ApiProperty({ description: '메시지 배열', type: [SaveMessageDto] })
  @IsArray()
  @ArrayMaxSize(50, { message: 'Maximum 50 messages per batch.' })
  @ValidateNested({ each: true })
  @Type(() => SaveMessageDto)
  messages: SaveMessageDto[];
}

// UpdateSessionTitleDto는 update-step.dto.ts에서 정의됨
