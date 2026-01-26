import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';

// Core
import { GeminiCoreService } from './core/gemini-core.service';

// Domain Services
import { EstimateAiService } from './services/estimate-ai.service';
import { ItemAiService } from './services/item-ai.service';
import { ItineraryAiService } from './services/itinerary-ai.service';
import { TravelAssistantService } from './services/travel-assistant.service';

// Other services
import { TourApiService } from './tour-api.service';

// Module imports
import { EstimateModule } from '../estimate/estimate.module';
import { ItemModule } from '../item/item.module';
import { FileUploadModule } from '../file-upload/file-upload.module';

@Module({
  imports: [EstimateModule, ItemModule, FileUploadModule],
  controllers: [AiController],
  providers: [
    // Core
    GeminiCoreService,

    // Domain Services
    EstimateAiService,
    ItemAiService,
    ItineraryAiService,
    TravelAssistantService,

    // Other
    TourApiService,
  ],
  exports: [
    // Core
    GeminiCoreService,

    // Domain Services
    EstimateAiService,
    ItemAiService,
    ItineraryAiService,
    TravelAssistantService,

    // Other
    TourApiService,
  ],
})
export class AiModule {}
