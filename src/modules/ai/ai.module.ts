import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { GeminiService } from './gemini.service';
import { TourApiService } from './tour-api.service';
import { EstimateModule } from '../estimate/estimate.module';
import { ItemModule } from '../item/item.module';
import { FileUploadModule } from '../file-upload/file-upload.module';

@Module({
  imports: [EstimateModule, ItemModule, FileUploadModule],
  controllers: [AiController],
  providers: [GeminiService, TourApiService],
  exports: [GeminiService, TourApiService],
})
export class AiModule {}
