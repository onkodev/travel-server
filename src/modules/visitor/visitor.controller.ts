import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
  ApiParam,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { VisitorService } from './visitor.service';
import { AuthGuard } from '../../common/guards/auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import {
  CreateSessionDto,
  TrackPageViewDto,
  UpdatePageViewDto,
  AdminSessionQueryDto,
  SessionListDto,
  VisitorStatsDto,
  VisitorSuccessDto,
  CreateSessionResponseDto,
  VisitorSessionDto,
} from './dto';
import { ErrorResponseDto } from '../../common/dto';

@ApiTags('방문자 추적')
@Controller('visitor')
export class VisitorController {
  private readonly logger = new Logger(VisitorController.name);

  constructor(private visitorService: VisitorService) {}

  // IP 추출 헬퍼
  private getIpAddress(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0].trim();
    }
    return req.ip || req.socket.remoteAddress || '';
  }

  // ==================== 공개 API ====================

  @Post('session')
  @Public()
  @SkipThrottle()
  @ApiOperation({
    summary: '방문자 세션 생성',
    description: '새 방문자 세션을 생성하거나 기존 세션을 반환합니다. 핑거프린트가 있으면 기존 세션을 찾습니다.',
  })
  @ApiBody({ type: CreateSessionDto })
  @ApiResponse({
    status: 201,
    description: '세션 생성 성공',
    type: CreateSessionResponseDto,
  })
  async createSession(
    @Req() req: Request,
    @Body() body: CreateSessionDto,
  ) {
    const ipAddress = this.getIpAddress(req);
    const userAgent = req.headers['user-agent'];

    // fingerprint가 있으면 기존 세션 찾기
    if (body.fingerprint) {
      return this.visitorService.getOrCreateSession(body.fingerprint, {
        ...body,
        ipAddress,
        userAgent,
      });
    }

    // 새 세션 생성
    return this.visitorService.createSession({
      ...body,
      ipAddress,
      userAgent,
    });
  }

  @Post('track')
  @Public()
  @SkipThrottle()
  @ApiOperation({
    summary: '페이지뷰 기록',
    description: '페이지 방문을 기록합니다. sendBeacon API를 지원합니다.',
  })
  @ApiBody({ type: TrackPageViewDto })
  @ApiResponse({
    status: 201,
    description: '기록 성공',
    type: VisitorSuccessDto,
  })
  async trackPageView(@Body() body: TrackPageViewDto): Promise<VisitorSuccessDto> {
    // Analytics용이라 모든 에러를 무시하고 성공 반환
    try {
      if (!body?.visitorId || !body?.path) {
        return { success: false, message: 'Missing required fields' };
      }
      await this.visitorService.trackPageView(body);
      return { success: true };
    } catch (error) {
      // 에러가 발생해도 클라이언트에는 성공 반환
      this.logger.error('Track page view error:', error);
      return { success: false, message: 'Internal error' };
    }
  }

  @Patch('track/:id')
  @Public()
  @SkipThrottle()
  @ApiOperation({
    summary: '페이지뷰 업데이트',
    description: '체류 시간, 스크롤 깊이, 클릭 수 등을 업데이트합니다.',
  })
  @ApiParam({
    name: 'id',
    description: '페이지뷰 ID',
    type: Number,
    example: 123,
  })
  @ApiBody({ type: UpdatePageViewDto })
  @ApiResponse({
    status: 200,
    description: '업데이트 성공',
    type: VisitorSuccessDto,
  })
  async updatePageView(
    @Param('id') id: string,
    @Body() body: UpdatePageViewDto,
  ) {
    return this.visitorService.updatePageView(parseInt(id), body);
  }

  @Get('session/:id')
  @Public()
  @SkipThrottle()
  @ApiOperation({
    summary: '세션 상세 조회',
    description: '방문자 세션의 상세 정보와 페이지뷰 목록을 조회합니다.',
  })
  @ApiParam({
    name: 'id',
    description: '세션 ID',
    type: String,
    example: 'visitor_abc123',
  })
  @ApiResponse({
    status: 200,
    description: '조회 성공',
    type: VisitorSessionDto,
  })
  async getSession(@Param('id') id: string) {
    return this.visitorService.getSession(id);
  }

  // ==================== 관리자 API ====================

  @Get('admin/sessions')
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard)
  @SkipThrottle()
  @ApiOperation({
    summary: '방문자 세션 목록 조회 (관리자)',
    description: '모든 방문자 세션 목록을 조회합니다. 필터링 및 페이지네이션을 지원합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '조회 성공',
    type: SessionListDto,
  })
  @ApiUnauthorizedResponse({
    description: '인증 실패',
    type: ErrorResponseDto,
  })
  async getSessions(@Query() query: AdminSessionQueryDto) {
    return this.visitorService.getSessions({
      page: query.page,
      limit: query.limit,
      country: query.country,
      hasChatbot: query.hasChatbot,
      hasEstimate: query.hasEstimate,
      startDate: query.startDate,
      endDate: query.endDate,
    });
  }

  @Get('admin/stats')
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard)
  @SkipThrottle()
  @ApiOperation({
    summary: '방문자 통계 조회 (관리자)',
    description: '일별, 주별, 월별 방문자 통계와 국가별 분포를 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '조회 성공',
    type: VisitorStatsDto,
  })
  @ApiUnauthorizedResponse({
    description: '인증 실패',
    type: ErrorResponseDto,
  })
  async getStats() {
    return this.visitorService.getStats();
  }

  @Get('admin/session/:id')
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard)
  @SkipThrottle()
  @ApiOperation({
    summary: '세션 상세 조회 (관리자)',
    description: '방문자 세션의 상세 정보를 조회합니다. 페이지뷰 목록 및 사용자 행동 정보를 포함합니다.',
  })
  @ApiParam({
    name: 'id',
    description: '세션 ID',
    type: String,
    example: 'visitor_abc123',
  })
  @ApiResponse({
    status: 200,
    description: '조회 성공',
    type: VisitorSessionDto,
  })
  @ApiUnauthorizedResponse({
    description: '인증 실패',
    type: ErrorResponseDto,
  })
  async getSessionAdmin(@Param('id') id: string) {
    return this.visitorService.getSession(id);
  }
}
