import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { ReviewService } from './review.service';
import { Public } from '../../common/decorators/public.decorator';
import {
  ReviewDto,
  ReviewQueryDto,
  CreateReviewDto,
  UpdateReviewDto,
} from './dto';
import {
  ErrorResponseDto,
  SuccessResponseDto,
  PaginationMetaDto,
} from '../../common/dto';

class ReviewListResponseDto {
  data: ReviewDto[];
  meta: PaginationMetaDto;
}

@ApiTags('리뷰')
@Controller('reviews')
export class ReviewController {
  constructor(private reviewService: ReviewService) {}

  @Get()
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: '관리자용 리뷰 목록 조회',
    description: '필터와 페이지네이션을 적용하여 리뷰 목록을 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '조회 성공',
    type: ReviewListResponseDto,
  })
  async getReviews(@Query() query: ReviewQueryDto) {
    return this.reviewService.getReviews({
      page: query.page,
      limit: query.limit,
      tourId: query.tourId,
      isVisible: query.isVisible,
    });
  }

  @Public()
  @Get('tour/:tourId')
  @ApiOperation({
    summary: '투어별 공개 리뷰 조회',
    description: '특정 투어의 공개된 리뷰 목록을 조회합니다.',
  })
  @ApiParam({ name: 'tourId', description: '투어 ID' })
  @ApiQuery({ name: 'page', required: false, description: '페이지 번호' })
  @ApiQuery({ name: 'limit', required: false, description: '페이지당 항목 수' })
  @ApiResponse({
    status: 200,
    description: '조회 성공',
    type: ReviewListResponseDto,
  })
  async getPublicReviewsByTour(
    @Param('tourId', ParseIntPipe) tourId: number,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.reviewService.getPublicReviewsByTour(
      tourId,
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 10,
    );
  }

  @Get(':id')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: '리뷰 상세 조회',
    description: '특정 리뷰의 상세 정보를 조회합니다.',
  })
  @ApiParam({ name: 'id', description: '리뷰 ID' })
  @ApiResponse({ status: 200, description: '조회 성공', type: ReviewDto })
  @ApiResponse({
    status: 404,
    description: '리뷰 없음',
    type: ErrorResponseDto,
  })
  async getReview(@Param('id', ParseIntPipe) id: number) {
    return this.reviewService.getReview(id);
  }

  @Post()
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: '리뷰 작성',
    description: '새로운 리뷰를 작성합니다.',
  })
  @ApiResponse({ status: 201, description: '생성 성공', type: ReviewDto })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청',
    type: ErrorResponseDto,
  })
  async createReview(@Body() body: CreateReviewDto) {
    return this.reviewService.createReview({
      tour: { connect: { id: body.tourId } },
      booking: body.bookingId ? { connect: { id: body.bookingId } } : undefined,
      rating: body.rating,
      content: body.content,
      images: body.images || [],
      reviewerName: body.reviewerName,
      reviewerEmail: body.reviewerEmail,
      isAdminCreated: body.isAdminCreated ?? false,
    });
  }

  @Patch(':id')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: '리뷰 수정',
    description: '기존 리뷰를 수정합니다.',
  })
  @ApiParam({ name: 'id', description: '리뷰 ID' })
  @ApiResponse({ status: 200, description: '수정 성공', type: ReviewDto })
  @ApiResponse({
    status: 404,
    description: '리뷰 없음',
    type: ErrorResponseDto,
  })
  async updateReview(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateReviewDto,
  ) {
    return this.reviewService.updateReview(id, body);
  }

  @Patch(':id/toggle-visibility')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: '리뷰 표시/숨김 토글',
    description: '리뷰의 표시 상태를 토글합니다.',
  })
  @ApiParam({ name: 'id', description: '리뷰 ID' })
  @ApiResponse({ status: 200, description: '변경 성공', type: ReviewDto })
  @ApiResponse({
    status: 404,
    description: '리뷰 없음',
    type: ErrorResponseDto,
  })
  async toggleVisibility(@Param('id', ParseIntPipe) id: number) {
    return this.reviewService.toggleVisibility(id);
  }

  @Delete(':id')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: '리뷰 삭제',
    description: '리뷰를 삭제합니다.',
  })
  @ApiParam({ name: 'id', description: '리뷰 ID' })
  @ApiResponse({
    status: 200,
    description: '삭제 성공',
    type: SuccessResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '리뷰 없음',
    type: ErrorResponseDto,
  })
  async deleteReview(@Param('id', ParseIntPipe) id: number) {
    return this.reviewService.deleteReview(id);
  }
}
