import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';

// Core
import { GeminiCoreService } from './core/gemini-core.service';
import { EmbeddingService } from './core/embedding.service';

// Domain Services
import { EstimateAiService } from './services/estimate-ai.service';
import { ItemAiService } from './services/item-ai.service';
import { ItineraryAiService } from './services/itinerary-ai.service';
import { TravelAssistantService } from './services/travel-assistant.service';
import { FaqAiService } from './services/faq-ai.service';

// Other services
import { TourApiService } from './tour-api.service';

// Module imports
import { ItemModule } from '../item/item.module';
import { FileUploadModule } from '../file-upload/file-upload.module';

@Module({
  imports: [ItemModule, FileUploadModule],
  controllers: [AiController],
  providers: [
    // Core
    GeminiCoreService,
    EmbeddingService,

    // Domain Services
    EstimateAiService,
    ItemAiService,
    ItineraryAiService,
    TravelAssistantService,
    FaqAiService,

    // Other
    TourApiService,
  ],
  exports: [
    // Core
    GeminiCoreService,
    EmbeddingService,

    // Domain Services
    EstimateAiService,
    ItemAiService,
    ItineraryAiService,
    TravelAssistantService,
    FaqAiService,

    // Other
    TourApiService,
  ],
})
export class AiModule {}
