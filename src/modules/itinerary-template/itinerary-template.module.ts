import { Module } from '@nestjs/common';
import { ItineraryTemplateController } from './itinerary-template.controller';
import { ItineraryTemplateService } from './itinerary-template.service';

@Module({
  controllers: [ItineraryTemplateController],
  providers: [ItineraryTemplateService],
  exports: [ItineraryTemplateService],
})
export class ItineraryTemplateModule {}
