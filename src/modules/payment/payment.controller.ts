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
} from '@nestjs/swagger';
import { PaymentService } from './payment.service';
import { Public } from '../../common/decorators/public.decorator';
import {
  PaymentDto,
  PaymentQueryDto,
  CreatePaymentDto,
  UpdatePaymentStatusDto,
  ProcessRefundDto,
  PaymentStatsDto,
} from './dto';
import {
  ErrorResponseDto,
  SuccessResponseDto,
  PaginationMetaDto,
} from '../../common/dto';

class PaymentListResponseDto {
  data: PaymentDto[];
  meta: PaginationMetaDto;
}

@ApiTags('결제')
@ApiBearerAuth('access-token')
@Controller('payments')
export class PaymentController {
  constructor(private paymentService: PaymentService) {}

  @Get()
  @ApiOperation({
    summary: '결제 목록 조회',
    description: '필터와 페이지네이션을 적용하여 결제 목록을 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '조회 성공',
    type: PaymentListResponseDto,
  })
  async getPayments(@Query() query: PaymentQueryDto) {
    return this.paymentService.getPayments({
      page: query.page,
      limit: query.limit,
      status: query.status,
      bookingId: query.bookingId,
      estimateId: query.estimateId,
      paymentMethod: query.paymentMethod,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
    });
  }

  @Get('stats')
  @ApiOperation({
    summary: '결제 통계 조회',
    description: '결제 상태별 통계와 금액 합계를 조회합니다.',
  })
  @ApiResponse({ status: 200, description: '조회 성공', type: PaymentStatsDto })
  async getStats() {
    return this.paymentService.getStats();
  }

  @Public()
  @Get('paypal/:paypalOrderId')
  @ApiOperation({
    summary: 'PayPal 주문 ID로 결제 상태 조회',
    description:
      'PayPal 주문 ID로 결제 상태를 조회합니다. 결제 확인용으로 최소 정보만 반환합니다.',
  })
  @ApiParam({ name: 'paypalOrderId', description: 'PayPal 주문 ID' })
  @ApiResponse({ status: 200, description: '조회 성공' })
  @ApiResponse({
    status: 404,
    description: '결제 없음',
    type: ErrorResponseDto,
  })
  async getPaymentByPaypalOrderId(
    @Param('paypalOrderId') paypalOrderId: string,
  ) {
    return this.paymentService.getPaymentStatusByPaypalOrderId(paypalOrderId);
  }

  @Get(':id')
  @ApiOperation({
    summary: '결제 상세 조회',
    description: '특정 결제의 상세 정보를 조회합니다.',
  })
  @ApiParam({ name: 'id', description: '결제 ID' })
  @ApiResponse({ status: 200, description: '조회 성공', type: PaymentDto })
  @ApiResponse({
    status: 404,
    description: '결제 없음',
    type: ErrorResponseDto,
  })
  async getPayment(@Param('id', ParseIntPipe) id: number) {
    return this.paymentService.getPayment(id);
  }

  @Post()
  @ApiOperation({
    summary: '결제 생성',
    description: '새로운 결제 레코드를 생성합니다.',
  })
  @ApiResponse({ status: 201, description: '생성 성공', type: PaymentDto })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청',
    type: ErrorResponseDto,
  })
  async createPayment(@Body() body: CreatePaymentDto) {
    return this.paymentService.createPayment(body);
  }

  @Patch(':id')
  @ApiOperation({
    summary: '결제 수정',
    description: '기존 결제 정보를 수정합니다.',
  })
  @ApiParam({ name: 'id', description: '결제 ID' })
  @ApiResponse({ status: 200, description: '수정 성공', type: PaymentDto })
  @ApiResponse({
    status: 404,
    description: '결제 없음',
    type: ErrorResponseDto,
  })
  async updatePayment(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: CreatePaymentDto,
  ) {
    return this.paymentService.updatePayment(id, body);
  }

  @Patch(':id/status')
  @ApiOperation({
    summary: '결제 상태 변경',
    description: '결제의 상태를 변경합니다 (완료, 실패, 환불 등).',
  })
  @ApiParam({ name: 'id', description: '결제 ID' })
  @ApiResponse({ status: 200, description: '변경 성공', type: PaymentDto })
  @ApiResponse({
    status: 404,
    description: '결제 없음',
    type: ErrorResponseDto,
  })
  async updatePaymentStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdatePaymentStatusDto,
  ) {
    return this.paymentService.updatePaymentStatus(id, body.status, {
      paypalCaptureId: body.paypalCaptureId,
      paidAt:
        body.paidAt && !isNaN(new Date(body.paidAt).getTime())
          ? new Date(body.paidAt)
          : undefined,
      failureReason: body.failureReason,
    });
  }

  @Post(':id/refund')
  @ApiOperation({
    summary: '환불 처리',
    description: '결제에 대한 환불을 처리합니다.',
  })
  @ApiParam({ name: 'id', description: '결제 ID' })
  @ApiResponse({ status: 200, description: '환불 성공', type: PaymentDto })
  @ApiResponse({
    status: 404,
    description: '결제 없음',
    type: ErrorResponseDto,
  })
  async processRefund(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: ProcessRefundDto,
  ) {
    return this.paymentService.processRefund(id, body);
  }

  @Delete(':id')
  @ApiOperation({
    summary: '결제 삭제',
    description: '결제 레코드를 삭제합니다.',
  })
  @ApiParam({ name: 'id', description: '결제 ID' })
  @ApiResponse({
    status: 200,
    description: '삭제 성공',
    type: SuccessResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '결제 없음',
    type: ErrorResponseDto,
  })
  async deletePayment(@Param('id', ParseIntPipe) id: number) {
    return this.paymentService.deletePayment(id);
  }
}
