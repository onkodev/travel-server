import { Module } from '@nestjs/common';
import { SuggestedPlaceController } from './suggested-place.controller';
import { SuggestedPlaceService } from './suggested-place.service';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [AiModule],
  controllers: [SuggestedPlaceController],
  providers: [SuggestedPlaceService],
  exports: [SuggestedPlaceService],
})
export class SuggestedPlaceModule {}
