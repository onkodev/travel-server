import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { TourService } from './tour.service';
import { Public } from '../../common/decorators/public.decorator';
import {
  TourDto,
  PublicTourQueryDto,
  AdminTourQueryDto,
  CreateTourDto,
  UpdateTourDto,
} from './dto';
import {
  ErrorResponseDto,
  SuccessResponseDto,
  PaginationMetaDto,
} from '../../common/dto';

class TourListResponseDto {
  data: TourDto[];
  meta: PaginationMetaDto;
}

@ApiTags('투어')
@SkipThrottle()
@Controller('tours')
export class TourController {
  constructor(private tourService: TourService) {}

  @Public()
  @Get('public')
  @ApiOperation({
    summary: '공개 투어 목록 조회',
    description:
      '게시된 투어 목록을 조회합니다. source=auth는 tumakrguide(온라인투어), source=admin은 tumakr(히스토리/그룹투어)를 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '조회 성공',
    type: TourListResponseDto,
  })
  async getPublicTours(@Query() query: PublicTourQueryDto) {
    return this.tourService.getPublicTours({
      page: query.page,
      limit: query.limit,
      category: query.category,
      tags: query.tags ? query.tags.split(',') : undefined,
      search: query.search,
      source: query.source,
    });
  }

  @Public()
  @Get('categories')
  @ApiOperation({
    summary: '카테고리 목록 조회',
    description: '사용 가능한 투어 카테고리 목록을 조회합니다.',
  })
  @ApiResponse({ status: 200, description: '조회 성공', type: [String] })
  async getCategories() {
    return this.tourService.getCategories();
  }

  @Public()
  @Get('tags')
  @ApiOperation({
    summary: '태그 목록 조회',
    description: '사용 가능한 투어 태그 목록을 조회합니다.',
  })
  @ApiResponse({ status: 200, description: '조회 성공', type: [String] })
  async getTags() {
    return this.tourService.getTags();
  }

  @Get()
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: '관리자용 투어 목록 조회',
    description: '관리자용 투어 목록을 조회합니다 (모든 상태 포함).',
  })
  @ApiResponse({
    status: 200,
    description: '조회 성공',
    type: TourListResponseDto,
  })
  async getTours(@Query() query: AdminTourQueryDto) {
    return this.tourService.getTours({
      page: query.page,
      limit: query.limit,
      status: query.status,
      search: query.search,
    });
  }

  @Public()
  @Get(':id')
  @ApiOperation({
    summary: '투어 상세 조회',
    description: '특정 투어의 상세 정보를 조회합니다.',
  })
  @ApiParam({ name: 'id', description: '투어 ID' })
  @ApiQuery({
    name: 'source',
    required: false,
    description: '데이터 소스 (auth/admin)',
  })
  @ApiResponse({ status: 200, description: '조회 성공', type: TourDto })
  @ApiResponse({
    status: 404,
    description: '투어 없음',
    type: ErrorResponseDto,
  })
  async getTour(@Param('id') id: string, @Query('source') source?: string) {
    return this.tourService.getTour(parseInt(id), source);
  }

  @Post()
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: '투어 생성',
    description: '새로운 투어를 생성합니다.',
  })
  @ApiResponse({ status: 201, description: '생성 성공', type: TourDto })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청',
    type: ErrorResponseDto,
  })
  async createTour(@Body() body: CreateTourDto) {
    return this.tourService.createTour(body);
  }

  @Patch(':id')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: '투어 수정',
    description: '기존 투어 정보를 수정합니다.',
  })
  @ApiParam({ name: 'id', description: '투어 ID' })
  @ApiResponse({ status: 200, description: '수정 성공', type: TourDto })
  @ApiResponse({
    status: 404,
    description: '투어 없음',
    type: ErrorResponseDto,
  })
  async updateTour(@Param('id') id: string, @Body() body: UpdateTourDto) {
    return this.tourService.updateTour(parseInt(id), body);
  }

  @Delete(':id')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: '투어 삭제',
    description: '투어를 삭제합니다.',
  })
  @ApiParam({ name: 'id', description: '투어 ID' })
  @ApiResponse({
    status: 200,
    description: '삭제 성공',
    type: SuccessResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '투어 없음',
    type: ErrorResponseDto,
  })
  async deleteTour(@Param('id') id: string) {
    return this.tourService.deleteTour(parseInt(id));
  }
}
