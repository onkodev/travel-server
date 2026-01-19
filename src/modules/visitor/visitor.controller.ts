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
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { VisitorService } from './visitor.service';
import { AuthGuard } from '../../common/guards/auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CreateSessionDto, TrackPageViewDto, UpdatePageViewDto } from './dto';

@ApiTags('Visitor Tracking')
@Controller('visitor')
export class VisitorController {
  constructor(private visitorService: VisitorService) {}

  // IP 추출 헬퍼
  private getIpAddress(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0].trim();
    }
    return req.ip || req.socket.remoteAddress || '';
  }

  @Post('session')
  @Public()
  @SkipThrottle()
  @ApiOperation({
    summary: '방문자 세션 생성',
    description: '새 방문자 세션을 생성하거나 기존 세션을 반환합니다.',
  })
  @ApiResponse({ status: 201, description: '세션 생성 성공' })
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
    description: '페이지 방문을 기록합니다. sendBeacon 지원.',
  })
  @ApiResponse({ status: 201, description: '기록 성공' })
  async trackPageView(@Body() body: any) {
    // Analytics용이라 모든 에러를 무시하고 성공 반환
    try {
      if (!body?.visitorId || !body?.path) {
        return { success: false, message: 'Missing required fields' };
      }
      await this.visitorService.trackPageView(body);
      return { success: true };
    } catch (error) {
      // 에러가 발생해도 클라이언트에는 성공 반환
      console.error('Track page view error:', error);
      return { success: false, message: 'Internal error' };
    }
  }

  @Patch('track/:id')
  @Public()
  @SkipThrottle()
  @ApiOperation({
    summary: '페이지뷰 업데이트',
    description: '체류 시간, 스크롤 깊이 등을 업데이트합니다.',
  })
  @ApiResponse({ status: 200, description: '업데이트 성공' })
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
  @ApiResponse({ status: 200, description: '조회 성공' })
  async getSession(@Param('id') id: string) {
    return this.visitorService.getSession(id);
  }

  // ============ 관리자 API ============

  @Get('admin/sessions')
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard)
  @SkipThrottle()
  @ApiOperation({
    summary: '방문자 세션 목록 (관리자)',
    description: '모든 방문자 세션 목록을 조회합니다.',
  })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'country', required: false })
  @ApiQuery({ name: 'hasChatbot', required: false })
  @ApiQuery({ name: 'hasEstimate', required: false })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiResponse({ status: 200, description: '조회 성공' })
  async getSessions(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('country') country?: string,
    @Query('hasChatbot') hasChatbot?: string,
    @Query('hasEstimate') hasEstimate?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.visitorService.getSessions({
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
      country,
      hasChatbot: hasChatbot !== undefined ? hasChatbot === 'true' : undefined,
      hasEstimate: hasEstimate !== undefined ? hasEstimate === 'true' : undefined,
      startDate,
      endDate,
    });
  }

  @Get('admin/stats')
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard)
  @SkipThrottle()
  @ApiOperation({
    summary: '방문자 통계 (관리자)',
    description: '방문자 통계를 조회합니다.',
  })
  @ApiResponse({ status: 200, description: '조회 성공' })
  async getStats() {
    return this.visitorService.getStats();
  }

  @Get('admin/session/:id')
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard)
  @SkipThrottle()
  @ApiOperation({
    summary: '세션 상세 (관리자)',
    description: '방문자 세션 상세 정보를 조회합니다.',
  })
  @ApiResponse({ status: 200, description: '조회 성공' })
  async getSessionAdmin(@Param('id') id: string) {
    return this.visitorService.getSession(id);
  }
}
