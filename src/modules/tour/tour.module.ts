import { Module } from '@nestjs/common';
import { TourController } from './tour.controller';
import { TourService } from './tour.service';
import { SupabaseModule } from '../../supabase/supabase.module';

@Module({
  imports: [SupabaseModule],
  controllers: [TourController],
  providers: [TourService],
  exports: [TourService],
})
export class TourModule {}
