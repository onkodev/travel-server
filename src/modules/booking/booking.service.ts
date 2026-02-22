import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { convertDecimalFields } from '../../common/utils/decimal.util';
import { sanitizeSearch } from '../../common/utils/validation.util';
import { DASHBOARD_EVENTS } from '../../common/events';
import {
  calculateSkip,
  createPaginatedResponse,
} from '../../common/dto/pagination.dto';

const VALID_BOOKING_STATUSES = [
  'pending',
  'confirmed',
  'cancelled',
  'completed',
] as const;

@Injectable()
export class BookingService {
  constructor(
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
  ) {}

  // 예약 목록 조회
  async getBookings(params: {
    page?: number;
    limit?: number;
    status?: string;
    tourId?: number;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    paymentStatus?: string;
  }) {
    const {
      page = 1,
      limit = 20,
      status,
      tourId,
      search,
      dateFrom,
      dateTo,
      paymentStatus,
    } = params;
    const skip = calculateSkip(page, limit);

    const where: Prisma.BookingWhereInput = {};

    if (status) {
      if (
        !VALID_BOOKING_STATUSES.includes(
          status as (typeof VALID_BOOKING_STATUSES)[number],
        )
      ) {
        throw new BadRequestException(`유효하지 않은 예약 상태: ${status}`);
      }
      where.status = status;
    }

    if (tourId) {
      where.tourId = tourId;
    }

    const sanitized = sanitizeSearch(search);
    if (sanitized) {
      where.OR = [
        { confirmationCode: { contains: sanitized, mode: 'insensitive' } },
        { customerEmail: { contains: sanitized, mode: 'insensitive' } },
        { customerFirstName: { contains: sanitized, mode: 'insensitive' } },
        { customerLastName: { contains: sanitized, mode: 'insensitive' } },
      ];
    }

    if (dateFrom || dateTo) {
      where.bookingDate = {};
      if (dateFrom) where.bookingDate.gte = new Date(dateFrom);
      if (dateTo) where.bookingDate.lte = new Date(dateTo);
    }

    if (paymentStatus) {
      where.payments = { some: { status: paymentStatus } };
    }

    const [bookings, total] = await Promise.all([
      this.prisma.booking.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          tour: { select: { title: true, thumbnailUrl: true } },
          payments: {
            select: { id: true, status: true, amount: true, paidAt: true },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      }),
      this.prisma.booking.count({ where }),
    ]);

    return createPaginatedResponse(
      bookings.map(convertDecimalFields),
      total,
      page,
      limit,
    );
  }

  // 예약 상세 조회
  async getBooking(id: number) {
    const booking = await this.prisma.booking.findUnique({
      where: { id },
      include: {
        tour: {
          select: {
            id: true,
            title: true,
            thumbnailUrl: true,
            price: true,
            currency: true,
            durationMinutes: true,
            meetingPoint: true,
          },
        },
        payments: {
          select: {
            id: true,
            amount: true,
            currency: true,
            status: true,
            paymentMethod: true,
            paidAt: true,
            createdAt: true,
          },
        },
        reviews: {
          select: {
            id: true,
            rating: true,
            content: true,
            createdAt: true,
          },
        },
      },
    });

    if (!booking) {
      throw new NotFoundException('예약을 찾을 수 없습니다');
    }

    return convertDecimalFields(booking);
  }

  // 확인 코드로 예약 조회
  async getBookingByCode(confirmationCode: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { confirmationCode },
      include: {
        tour: true,
        payments: true,
      },
    });

    if (!booking) {
      throw new NotFoundException('예약을 찾을 수 없습니다');
    }

    return convertDecimalFields(booking);
  }

  // 예약 생성
  async createBooking(
    data: Omit<Prisma.BookingCreateInput, 'confirmationCode'>,
  ) {
    // 투어 존재 여부 검증 (FK 에러 대신 명확한 400 응답)
    if ((data as any).tourId) {
      const tour = await this.prisma.tour.findUnique({
        where: { id: (data as any).tourId },
        select: { id: true },
      });
      if (!tour) {
        throw new BadRequestException('존재하지 않는 투어입니다');
      }
    }

    // 확인 코드 생성 (8자리 영숫자)
    const confirmationCode = randomBytes(4).toString('hex').toUpperCase();

    const booking = await this.prisma.booking.create({
      data: {
        ...data,
        confirmationCode,
      } as Prisma.BookingCreateInput,
    });
    this.eventEmitter.emit(DASHBOARD_EVENTS.INVALIDATE);
    return booking;
  }

  // 예약 업데이트
  async updateBooking(id: number, data: Prisma.BookingUpdateInput) {
    const booking = await this.prisma.booking.update({
      where: { id },
      data,
    });
    this.eventEmitter.emit(DASHBOARD_EVENTS.INVALIDATE);
    return booking;
  }

  // 예약 상태 변경
  async updateBookingStatus(id: number, status: string, reason?: string) {
    if (
      !VALID_BOOKING_STATUSES.includes(
        status as (typeof VALID_BOOKING_STATUSES)[number],
      )
    ) {
      throw new BadRequestException(`유효하지 않은 예약 상태: ${status}`);
    }
    const data: Prisma.BookingUpdateInput = { status };

    if (status === 'cancelled') {
      data.cancelledAt = new Date();
      data.cancelReason = reason;
    }

    const booking = await this.prisma.booking.update({
      where: { id },
      data,
    });
    this.eventEmitter.emit(DASHBOARD_EVENTS.INVALIDATE);
    return booking;
  }

  // 예약 삭제
  async deleteBooking(id: number) {
    const booking = await this.prisma.booking.delete({
      where: { id },
    });
    this.eventEmitter.emit(DASHBOARD_EVENTS.INVALIDATE);
    return booking;
  }

  // 예약 통계
  async getStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [total, pending, confirmed, todayBookings] = await Promise.all([
      this.prisma.booking.count(),
      this.prisma.booking.count({ where: { status: 'pending' } }),
      this.prisma.booking.count({ where: { status: 'confirmed' } }),
      this.prisma.booking.count({
        where: { bookingDate: { gte: today, lt: tomorrow } },
      }),
    ]);

    return { total, pending, confirmed, todayBookings };
  }
}
