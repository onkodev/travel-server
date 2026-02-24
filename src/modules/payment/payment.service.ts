import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { convertDecimalFields } from '../../common/utils/decimal.util';
import {
  calculateSkip,
  createPaginatedResponse,
} from '../../common/dto/pagination.dto';

const VALID_PAYMENT_STATUSES = [
  'pending',
  'completed',
  'failed',
  'refunded',
  'cancelled',
] as const;

@Injectable()
export class PaymentService {
  constructor(private prisma: PrismaService) {}

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
