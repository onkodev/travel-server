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

    // Magic bytes 검증 (MIME type 스푸핑 방지)
    if (!this.isValidImageMagicBytes(file.buffer)) {
      throw new BadRequestException(
        '유효하지 않은 이미지 파일입니다. 실제 이미지 파일만 업로드 가능합니다.',
      );
    }

    return this.fileUploadService.uploadFile(file, folder || 'items');
  }

  /**
   * 파일의 magic bytes를 검사하여 실제 이미지 파일인지 확인
   */
  private isValidImageMagicBytes(buffer: Buffer): boolean {
    if (!buffer || buffer.length < 4) return false;

    // JPEG: FF D8 FF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return true;
    }
    // PNG: 89 50 4E 47
    if (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    ) {
      return true;
    }
    // GIF: 47 49 46 38
    if (
      buffer[0] === 0x47 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x38
    ) {
      return true;
    }
    // WebP: 52 49 46 46 ... 57 45 42 50
    if (
      buffer.length >= 12 &&
      buffer[0] === 0x52 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x46 &&
      buffer[8] === 0x57 &&
      buffer[9] === 0x45 &&
      buffer[10] === 0x42 &&
      buffer[11] === 0x50
    ) {
      return true;
    }

    return false;
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
      page ? parseInt(page, 10) || 1 : 1,
      perPage ? parseInt(perPage, 10) || 20 : 20,
    );
  }
}
