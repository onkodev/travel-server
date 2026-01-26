import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ModifyItineraryMessageDto {
  @ApiProperty({
    description: 'User message for itinerary modification',
    example: 'I want to add Namsan Tower',
    minLength: 1,
    maxLength: 1000,
  })
  @IsString()
  @MinLength(1, { message: 'Message cannot be empty.' })
  @MaxLength(1000, { message: 'Message cannot exceed 1000 characters.' })
  message: string;
}

export class ModifyItineraryResponseDto {
  @ApiProperty({ description: 'Operation success status' })
  success: boolean;

  @ApiProperty({ description: 'Updated estimate items' })
  updatedItems: any[];

  @ApiProperty({ description: 'Bot response message' })
  botMessage: string;

  @ApiProperty({
    description: 'Parsed modification intent',
    required: false,
  })
  intent?: {
    action: 'regenerate_day' | 'add_item' | 'remove_item' | 'replace_item' | 'general_feedback';
    dayNumber?: number;
    itemName?: string;
    category?: string;
    confidence: number;
  };
}

export class RegenerateDayResponseDto {
  @ApiProperty({ description: 'Operation success status' })
  success: boolean;

  @ApiProperty({ description: 'Updated estimate items' })
  updatedItems: any[];

  @ApiProperty({ description: 'Bot response message' })
  botMessage: string;
}

export class FinalizeItineraryResponseDto {
  @ApiProperty({ description: 'Operation success status' })
  success: boolean;

  @ApiProperty({ description: 'Success message' })
  message: string;

  @ApiProperty({ description: 'Estimate ID' })
  estimateId: number;
}

// 여행 도우미 대화 DTO
export class TravelChatDto {
  @ApiProperty({
    description: 'User message',
    example: 'What is the best time to visit Korea?',
    minLength: 1,
    maxLength: 1000,
  })
  @IsString()
  @MinLength(1, { message: 'Message cannot be empty.' })
  @MaxLength(1000, { message: 'Message cannot exceed 1000 characters.' })
  message: string;
}

export class TravelChatResponseDto {
  @ApiProperty({ description: 'AI response message' })
  response: string;

  @ApiProperty({
    description: 'Message intent classification',
    enum: ['question', 'modification', 'feedback', 'other'],
  })
  intent: 'question' | 'modification' | 'feedback' | 'other';

  @ApiProperty({
    description: 'Updated estimate items (only for modification intent)',
    required: false,
  })
  updatedItems?: any[];

  @ApiProperty({
    description: 'Whether modification was successful (only for modification intent)',
    required: false,
  })
  modificationSuccess?: boolean;
}
