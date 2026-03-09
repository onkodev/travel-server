import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { convertDecimalFields } from '../../common/utils/decimal.util';
import {
  calculateSkip,
  createPaginatedResponse,
} from '../../common/dto/pagination.dto';
import { NotificationService } from '../notification/notification.service';

const VALID_PAYMENT_STATUSES = [
  'pending',
  'completed',
  'failed',
  'refunded',
  'cancelled',
] as const;

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);
  private readonly paypalBaseUrl: string;

  constructor(
    private prisma: PrismaService,
    private notificationService: NotificationService,
  ) {
    const mode = process.env.PAYPAL_MODE || 'sandbox';
    this.paypalBaseUrl =
      mode === 'live'
        ? 'https://api-m.paypal.com'
        : 'https://api-m.sandbox.paypal.com';
    this.logger.log(`PayPal mode: ${mode} | API: ${this.paypalBaseUrl}`);
  }

  /** PayPal REST API로 주문 정보를 조회하여 실제 캡처 금액을 검증 */
  private async verifyPayPalOrder(
    paypalOrderId: string,
    expectedAmount: number,
    expectedCurrency: string,
  ): Promise<void> {
    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      this.logger.warn(
        'PAYPAL_CLIENT_ID 또는 PAYPAL_CLIENT_SECRET이 설정되지 않아 금액 검증을 건너뜁니다',
      );
      return;
    }

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
      'base64',
    );

    const response = await fetch(
      `${this.paypalBaseUrl}/v2/checkout/orders/${paypalOrderId}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/json',
        },
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(
        `PayPal 주문 조회 실패: ${response.status} ${errorText}`,
      );
      throw new BadRequestException(
        'PayPal 주문을 확인할 수 없습니다. 잠시 후 다시 시도해주세요.',
      );
    }

    const order = await response.json();

    // 주문 상태 확인 — COMPLETED여야 캡처 완료
    if (order.status !== 'COMPLETED') {
      throw new BadRequestException(
        `PayPal 주문 상태가 유효하지 않습니다: ${order.status}`,
      );
    }

    // 실제 캡처된 금액 확인
    const capturedAmount =
      order.purchase_units?.[0]?.payments?.captures?.[0]?.amount;

    if (!capturedAmount) {
      throw new BadRequestException(
        'PayPal 캡처 정보를 찾을 수 없습니다',
      );
    }

    const actualAmount = parseFloat(capturedAmount.value);
    const actualCurrency = capturedAmount.currency_code;

    if (actualCurrency !== expectedCurrency) {
      this.logger.error(
        `통화 불일치: expected=${expectedCurrency}, actual=${actualCurrency}`,
      );
      throw new BadRequestException('결제 통화가 일치하지 않습니다');
    }

    // 부동소수점 오차를 고려하여 0.01 이내 차이 허용
    if (Math.abs(actualAmount - expectedAmount) > 0.01) {
      this.logger.error(
        `금액 불일치: expected=${expectedAmount}, actual=${actualAmount}`,
      );
      throw new BadRequestException(
        '결제 금액이 요청 금액과 일치하지 않습니다',
      );
    }
  }

  // 결제 목록 조회
  async getPayments(params: {
    page?: number;
    limit?: number;
    status?: string;
    bookingId?: number;
    estimateId?: number;
    paymentMethod?: string;
    dateFrom?: string;
    dateTo?: string;
  }) {
    const {
      page = 1,
      limit = 20,
      status,
      bookingId,
      estimateId,
      paymentMethod,
      dateFrom,
      dateTo,
    } = params;
    const skip = calculateSkip(page, limit);

    const where: Prisma.PaymentWhereInput = {};

    if (status) {
      where.status = status;
    }

    if (bookingId) {
      where.bookingId = bookingId;
    }

    if (estimateId) {
      where.estimateId = estimateId;
    }

    if (paymentMethod) {
      where.paymentMethod = paymentMethod;
    }

    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo);
    }

    const [payments, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          booking: {
            select: {
              confirmationCode: true,
              customerEmail: true,
              customerFirstName: true,
              customerLastName: true,
            },
          },
        },
      }),
      this.prisma.payment.count({ where }),
    ]);

    return createPaginatedResponse(
      payments.map(convertDecimalFields),
      total,
      page,
      limit,
    );
  }

  // 결제 상세 조회
  async getPayment(id: number) {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: {
        booking: true,
      },
    });

    if (!payment) {
      throw new NotFoundException('결제를 찾을 수 없습니다');
    }

    return convertDecimalFields(payment);
  }

  // PayPal Order ID로 결제 조회 (내부용 — 전체 정보)
  async getPaymentByPaypalOrderId(paypalOrderId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { paypalOrderId },
      include: {
        booking: true,
      },
    });

    if (!payment) {
      throw new NotFoundException('결제를 찾을 수 없습니다');
    }

    return convertDecimalFields(payment);
  }

  // PayPal Order ID로 결제 상태 조회 (공개용 — 최소 정보만 반환)
  async getPaymentStatusByPaypalOrderId(paypalOrderId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { paypalOrderId },
      select: {
        id: true,
        status: true,
        amount: true,
        currency: true,
        paidAt: true,
      },
    });

    if (!payment) {
      throw new NotFoundException('결제를 찾을 수 없습니다');
    }

    return convertDecimalFields(payment);
  }

  // 결제 생성
  async createPayment(data: Prisma.PaymentCreateInput) {
    return this.prisma.payment.create({
      data,
      include: {
        booking: true,
      },
    });
  }

  // 결제 업데이트
  async updatePayment(id: number, data: Prisma.PaymentUpdateInput) {
    return this.prisma.payment.update({
      where: { id },
      data,
    });
  }

  // 결제 상태 변경
  async updatePaymentStatus(
    id: number,
    status: string,
    additionalData?: {
      paypalCaptureId?: string;
      paidAt?: Date;
      failureReason?: string;
    },
  ) {
    if (
      !VALID_PAYMENT_STATUSES.includes(
        status as (typeof VALID_PAYMENT_STATUSES)[number],
      )
    ) {
      throw new BadRequestException(`유효하지 않은 결제 상태: ${status}`);
    }
    const data: Prisma.PaymentUpdateInput = { status };

    if (status === 'completed' && additionalData?.paypalCaptureId) {
      data.paypalCaptureId = additionalData.paypalCaptureId;
      data.paidAt = additionalData.paidAt || new Date();
    }

    if (status === 'failed' && additionalData?.failureReason) {
      data.failureReason = additionalData.failureReason;
    }

    return this.prisma.payment.update({
      where: { id },
      data,
    });
  }

  // 환불 처리 (FOR UPDATE 락으로 동시 환불 방지)
  async processRefund(
    id: number,
    data: {
      refundedAmount: number;
      refundReason?: string;
      paypalRefundId?: string;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      // FOR UPDATE로 행 잠금 — 동시 환불 요청 직렬화
      const [payment] = await tx.$queryRaw<
        Array<{
          id: number;
          status: string;
          amount: number;
          refunded_amount: number | null;
        }>
      >`SELECT id, status, amount, refunded_amount FROM payments WHERE id = ${id} FOR UPDATE`;

      if (!payment) {
        throw new NotFoundException('결제를 찾을 수 없습니다');
      }
      if (payment.status !== 'completed') {
        throw new BadRequestException('완료된 결제만 환불할 수 있습니다');
      }
      if (data.refundedAmount <= 0) {
        throw new BadRequestException('환불 금액은 0보다 커야 합니다');
      }
      const alreadyRefunded = Number(payment.refunded_amount || 0);
      if (alreadyRefunded + data.refundedAmount > Number(payment.amount)) {
        throw new BadRequestException(
          '누적 환불 금액이 결제 금액을 초과할 수 없습니다',
        );
      }

      return tx.payment.update({
        where: { id },
        data: {
          status: 'refunded',
          refundedAmount: alreadyRefunded + data.refundedAmount,
          refundReason: data.refundReason,
          paypalRefundId: data.paypalRefundId,
          refundedAt: new Date(),
        },
      });
    });
  }

  // 견적서 공개 결제 생성 (비회원 PayPal 결제)
  async createEstimatePayment(data: {
    shareHash: string;
    paypalOrderId: string;
    paypalCaptureId: string;
    payerEmail?: string;
  }) {
    // 1. shareHash → Estimate 조회
    const estimate = await this.prisma.estimate.findUnique({
      where: { shareHash: data.shareHash },
      select: {
        id: true,
        title: true,
        payableAmount: true,
        currency: true,
        validDate: true,
      },
    });

    if (!estimate) {
      throw new NotFoundException('견적서를 찾을 수 없습니다');
    }

    if (
      !estimate.payableAmount ||
      Number(estimate.payableAmount) <= 0
    ) {
      throw new BadRequestException(
        '결제 가능 금액이 설정되지 않았습니다',
      );
    }

    // 유효기간 확인
    if (estimate.validDate && new Date(estimate.validDate) < new Date()) {
      throw new BadRequestException('만료된 견적서입니다');
    }

    // 2. 중복 결제 방지
    const existingPayment = await this.prisma.payment.findFirst({
      where: { estimateId: estimate.id, status: 'completed' },
    });

    if (existingPayment) {
      throw new BadRequestException('이미 결제가 완료된 견적서입니다');
    }

    // 3. PayPal 주문 금액 검증 — 클라이언트 조작 방지
    const expectedAmount = Number(estimate.payableAmount);
    const expectedCurrency = estimate.currency || 'USD';
    await this.verifyPayPalOrder(
      data.paypalOrderId,
      expectedAmount,
      expectedCurrency,
    );

    // 4. Payment 생성
    const payment = await this.prisma.payment.create({
      data: {
        estimateId: estimate.id,
        amount: estimate.payableAmount,
        currency: estimate.currency || 'USD',
        paymentMethod: 'paypal',
        status: 'completed',
        paypalOrderId: data.paypalOrderId,
        paypalCaptureId: data.paypalCaptureId,
        payerEmail: data.payerEmail,
        paidAt: new Date(),
      },
    });

    // 5. 어드민 결제 완료 알림 (비블로킹)
    this.notificationService
      .notifyPaymentCompleted({
        estimateId: estimate.id,
        customerName: data.payerEmail,
        amount: Number(estimate.payableAmount),
        currency: estimate.currency || 'USD',
      })
      .catch((err) =>
        this.logger.error('결제 완료 알림 전송 실패:', err),
      );

    return convertDecimalFields(payment);
  }

  // 견적서 결제 상태 조회 (공개)
  async getPaymentByShareHash(shareHash: string) {
    const estimate = await this.prisma.estimate.findUnique({
      where: { shareHash },
      select: { id: true },
    });

    if (!estimate) {
      throw new NotFoundException('견적서를 찾을 수 없습니다');
    }

    const payment = await this.prisma.payment.findFirst({
      where: { estimateId: estimate.id, status: 'completed' },
      select: {
        id: true,
        status: true,
        amount: true,
        currency: true,
        paidAt: true,
        payerEmail: true,
      },
    });

    return payment ? convertDecimalFields(payment) : null;
  }

  // 견적서 ID로 결제 상세 조회 (어드민용)
  async getPaymentByEstimateId(estimateId: number) {
    const payment = await this.prisma.payment.findFirst({
      where: { estimateId, status: 'completed' },
      select: {
        id: true,
        status: true,
        amount: true,
        currency: true,
        paymentMethod: true,
        paypalOrderId: true,
        paypalCaptureId: true,
        payerEmail: true,
        payerId: true,
        paidAt: true,
        createdAt: true,
      },
    });

    return payment ? convertDecimalFields(payment) : null;
  }

  // 결제 삭제
  async deletePayment(id: number) {
    return this.prisma.payment.delete({
      where: { id },
    });
  }

  // 결제 통계
  async getStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [total, pending, completed, refunded, todayPayments, totalRevenue] =
      await Promise.all([
        this.prisma.payment.count(),
        this.prisma.payment.count({ where: { status: 'pending' } }),
        this.prisma.payment.count({ where: { status: 'completed' } }),
        this.prisma.payment.count({ where: { status: 'refunded' } }),
        this.prisma.payment.count({
          where: { createdAt: { gte: today } },
        }),
        this.prisma.payment.aggregate({
          where: { status: 'completed' },
          _sum: { amount: true },
        }),
      ]);

    return {
      total,
      pending,
      completed,
      refunded,
      todayPayments,
      totalRevenue: totalRevenue._sum.amount || 0,
    };
  }
}
