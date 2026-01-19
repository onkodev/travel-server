import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { BookingService } from './booking.service';
import { Public } from '../../common/decorators/public.decorator';
import {
  BookingDto,
  BookingQueryDto,
  CreateBookingDto,
  UpdateBookingDto,
  UpdateBookingStatusDto,
  BookingStatsDto,
} from './dto';
import {
  ErrorResponseDto,
  SuccessResponseDto,
  PaginationMetaDto,
} from '../../common/dto';

class BookingListResponseDto {
  data: BookingDto[];
  meta: PaginationMetaDto;
}

@ApiTags('예약')
@ApiBearerAuth('access-token')
@UseGuards(RolesGuard)
@Roles('admin', 'agent')
@Controller('bookings')
export class BookingController {
  constructor(private bookingService: BookingService) {}

  @Get()
  @ApiOperation({
    summary: '예약 목록 조회',
    description: '필터와 페이지네이션을 적용하여 예약 목록을 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '조회 성공',
    type: BookingListResponseDto,
  })
  async getBookings(@Query() query: BookingQueryDto) {
    return this.bookingService.getBookings({
      page: query.page,
      limit: query.limit,
      status: query.status,
      tourId: query.tourId,
      search: query.search,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
    });
  }

  @Get('stats')
  @ApiOperation({
    summary: '예약 통계 조회',
    description: '예약 상태별 통계를 조회합니다.',
  })
  @ApiResponse({ status: 200, description: '조회 성공', type: BookingStatsDto })
  async getStats() {
    return this.bookingService.getStats();
  }

  @Public()
  @Get('code/:code')
  @ApiOperation({
    summary: '확인 코드로 예약 조회',
    description:
      '예약 확인 코드로 예약 정보를 조회합니다. 인증 없이 접근 가능합니다.',
  })
  @ApiParam({ name: 'code', description: '예약 확인 코드' })
  @ApiResponse({ status: 200, description: '조회 성공', type: BookingDto })
  @ApiResponse({
    status: 404,
    description: '예약 없음',
    type: ErrorResponseDto,
  })
  async getBookingByCode(@Param('code') code: string) {
    return this.bookingService.getBookingByCode(code);
  }

  @Get(':id')
  @ApiOperation({
    summary: '예약 상세 조회',
    description: '특정 예약의 상세 정보를 조회합니다.',
  })
  @ApiParam({ name: 'id', description: '예약 ID' })
  @ApiResponse({ status: 200, description: '조회 성공', type: BookingDto })
  @ApiResponse({
    status: 404,
    description: '예약 없음',
    type: ErrorResponseDto,
  })
  async getBooking(@Param('id', ParseIntPipe) id: number) {
    return this.bookingService.getBooking(id);
  }

  @Post()
  @ApiOperation({
    summary: '예약 생성',
    description: '새로운 예약을 생성합니다.',
  })
  @ApiResponse({ status: 201, description: '생성 성공', type: BookingDto })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청',
    type: ErrorResponseDto,
  })
  async createBooking(@Body() body: CreateBookingDto) {
    return this.bookingService.createBooking({
      tour: { connect: { id: body.tourId } },
      tourTitle: body.tourTitle,
      bookingDate: new Date(body.bookingDate),
      startTime: body.startTime,
      customerFirstName: body.customerFirstName,
      customerLastName: body.customerLastName,
      customerEmail: body.customerEmail,
      customerPhone: body.customerPhone,
      customerCountry: body.customerCountry,
      participantCount: body.participantCount,
      unitPrice: body.unitPrice,
      totalAmount: body.totalAmount,
      currency: body.currency || 'USD',
      specialRequests: body.specialRequests,
    });
  }

  @Patch(':id')
  @ApiOperation({
    summary: '예약 수정',
    description: '기존 예약 정보를 수정합니다.',
  })
  @ApiParam({ name: 'id', description: '예약 ID' })
  @ApiResponse({ status: 200, description: '수정 성공', type: BookingDto })
  @ApiResponse({
    status: 404,
    description: '예약 없음',
    type: ErrorResponseDto,
  })
  async updateBooking(@Param('id', ParseIntPipe) id: number, @Body() body: UpdateBookingDto) {
    const updateData: any = { ...body };
    if (body.bookingDate) {
      updateData.bookingDate = new Date(body.bookingDate);
    }
    return this.bookingService.updateBooking(id, updateData);
  }

  @Patch(':id/status')
  @ApiOperation({
    summary: '예약 상태 변경',
    description: '예약의 상태를 변경합니다 (확정, 취소 등).',
  })
  @ApiParam({ name: 'id', description: '예약 ID' })
  @ApiResponse({ status: 200, description: '변경 성공', type: BookingDto })
  @ApiResponse({
    status: 404,
    description: '예약 없음',
    type: ErrorResponseDto,
  })
  async updateBookingStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateBookingStatusDto,
  ) {
    return this.bookingService.updateBookingStatus(
      id,
      body.status,
      body.reason,
    );
  }

  @Delete(':id')
  @ApiOperation({
    summary: '예약 삭제',
    description: '예약을 삭제합니다.',
  })
  @ApiParam({ name: 'id', description: '예약 ID' })
  @ApiResponse({
    status: 200,
    description: '삭제 성공',
    type: SuccessResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '예약 없음',
    type: ErrorResponseDto,
  })
  async deleteBooking(@Param('id', ParseIntPipe) id: number) {
    return this.bookingService.deleteBooking(id);
  }
}
