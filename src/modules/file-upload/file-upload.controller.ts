import {
  Controller,
  Post,
  Get,
  Query,
  UseInterceptors,
  UploadedFile,
  Body,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { FileUploadService } from './file-upload.service';
import { UnsplashService } from './unsplash.service';

@ApiTags('파일 업로드')
@ApiBearerAuth('access-token')
@SkipThrottle({ default: true, strict: true })
@Controller('file-upload')
export class FileUploadController {
  constructor(
    private fileUploadService: FileUploadService,
    private unsplashService: UnsplashService,
  ) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB
      },
      fileFilter: (req, file, cb) => {
        const allowedMimes = [
          'image/jpeg',
          'image/png',
          'image/gif',
          'image/webp',
        ];
        if (!allowedMimes.includes(file.mimetype)) {
          return cb(
            new BadRequestException(
              '이미지 파일만 업로드 가능합니다 (JPEG, PNG, GIF, WebP)',
            ),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  @ApiOperation({
    summary: 'S3 파일 업로드',
    description:
      '이미지 파일을 AWS S3에 업로드합니다. (최대 10MB, JPEG/PNG/GIF/WebP)',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        folder: { type: 'string', default: 'items' },
      },
    },
  })
  @ApiResponse({ status: 200, description: '업로드 성공' })
  @ApiResponse({ status: 400, description: '잘못된 파일 형식' })
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body('folder') folder?: string,
  ) {
    if (!file) {
      throw new BadRequestException('파일이 제공되지 않았습니다');
    }
    return this.fileUploadService.uploadFile(file, folder || 'items');
  }

  @Get('unsplash/search')
  @ApiOperation({
    summary: 'Unsplash 이미지 검색',
    description: 'Unsplash에서 무료 이미지를 검색합니다.',
  })
  @ApiQuery({ name: 'query', description: '검색어' })
  @ApiQuery({ name: 'page', required: false, description: '페이지 번호' })
  @ApiQuery({
    name: 'perPage',
    required: false,
    description: '페이지당 결과 수',
  })
  @ApiResponse({ status: 200, description: '검색 성공' })
  async searchUnsplash(
    @Query('query') query: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    return this.unsplashService.search(
      query,
      page ? parseInt(page) : 1,
      perPage ? parseInt(perPage) : 20,
    );
  }
}
