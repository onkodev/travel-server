import { Module } from '@nestjs/common';
import { ItineraryTemplateController } from './itinerary-template.controller';
import { ItineraryTemplateService } from './itinerary-template.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ItineraryTemplateController],
  providers: [ItineraryTemplateService],
  exports: [ItineraryTemplateService],
})
export class ItineraryTemplateModule {}
