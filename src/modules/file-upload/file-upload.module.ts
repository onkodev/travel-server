import { Module } from '@nestjs/common';
import { FileUploadController } from './file-upload.controller';
import { FileUploadService } from './file-upload.service';
import { UnsplashService } from './unsplash.service';

@Module({
  controllers: [FileUploadController],
  providers: [FileUploadService, UnsplashService],
  exports: [FileUploadService, UnsplashService],
})
export class FileUploadModule {}
