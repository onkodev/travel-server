import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { convertDecimalFields } from '../../common/utils/decimal.util';

@Injectable()
export class ReviewService {
  constructor(private prisma: PrismaService) {}

  // 리뷰 목록 조회
  async getReviews(params: {
    page?: number;
    limit?: number;
    tourId?: number;
    isVisible?: boolean;
  }) {
    const { page = 1, limit = 20, tourId, isVisible } = params;
    const skip = (page - 1) * limit;

    const where: Prisma.ReviewWhereInput = {};

    if (tourId) {
      where.tourId = tourId;
    }

    if (isVisible !== undefined) {
      where.isVisible = isVisible;
    }

    const [reviews, total] = await Promise.all([
      this.prisma.review.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          tour: { select: { title: true, thumbnailUrl: true } },
        },
      }),
      this.prisma.review.count({ where }),
    ]);

    return {
      data: reviews.map(convertDecimalFields),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // 투어별 공개 리뷰 조회
  async getPublicReviewsByTour(tourId: number, page = 1, limit = 10) {
    const skip = (page - 1) * limit;

    const where: Prisma.ReviewWhereInput = {
      tourId,
      isVisible: true,
    };

    const [reviews, total] = await Promise.all([
      this.prisma.review.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.review.count({ where }),
    ]);

    return {
      data: reviews.map(convertDecimalFields),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // 리뷰 상세 조회
  async getReview(id: number) {
    const review = await this.prisma.review.findUnique({
      where: { id },
      include: {
        tour: true,
        booking: true,
      },
    });

    if (!review) {
      throw new NotFoundException('리뷰를 찾을 수 없습니다');
    }

    return convertDecimalFields(review);
  }

  // 리뷰 생성 (트랜잭션으로 리뷰 + 통계 업데이트 atomic 처리)
  async createReview(data: Prisma.ReviewCreateInput) {
    return this.prisma.$transaction(async (tx) => {
      const review = await tx.review.create({ data });

      // 투어의 리뷰 통계 업데이트
      await this.updateTourReviewStatsWithTx(tx, review.tourId);

      return review;
    });
  }

  // 리뷰 업데이트 (트랜잭션으로 리뷰 + 통계 업데이트 atomic 처리)
  async updateReview(id: number, data: Prisma.ReviewUpdateInput) {
    return this.prisma.$transaction(async (tx) => {
      const review = await tx.review.update({
        where: { id },
        data,
      });

      // 투어의 리뷰 통계 업데이트
      await this.updateTourReviewStatsWithTx(tx, review.tourId);

      return review;
    });
  }

  // 리뷰 삭제 (트랜잭션으로 리뷰 + 통계 업데이트 atomic 처리)
  async deleteReview(id: number) {
    return this.prisma.$transaction(async (tx) => {
      const review = await tx.review.delete({
        where: { id },
      });

      // 투어의 리뷰 통계 업데이트
      await this.updateTourReviewStatsWithTx(tx, review.tourId);

      return review;
    });
  }

  // 리뷰 표시/숨김 토글 (트랜잭션으로 리뷰 + 통계 업데이트 atomic 처리)
  async toggleVisibility(id: number) {
    return this.prisma.$transaction(async (tx) => {
      const review = await tx.review.findUnique({ where: { id } });

      if (!review) {
        throw new NotFoundException('리뷰를 찾을 수 없습니다');
      }

      const updated = await tx.review.update({
        where: { id },
        data: { isVisible: !review.isVisible },
      });

      // 투어의 리뷰 통계 업데이트
      await this.updateTourReviewStatsWithTx(tx, review.tourId);

      return updated;
    });
  }

  // 투어 리뷰 통계 업데이트 (트랜잭션 클라이언트 사용)
  private async updateTourReviewStatsWithTx(
    tx: Prisma.TransactionClient,
    tourId: number,
  ) {
    const stats = await tx.review.aggregate({
      where: { tourId, isVisible: true },
      _count: true,
      _avg: { rating: true },
    });

    await tx.tour.update({
      where: { id: tourId },
      data: {
        reviewCount: stats._count,
        averageRating: stats._avg.rating || 0,
      },
    });
  }
}
