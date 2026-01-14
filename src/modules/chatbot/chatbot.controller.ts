import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ChatbotService } from './chatbot.service';
import { Public } from '../../common/decorators/public.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/user.decorator';
import { SupabaseService } from '../../supabase/supabase.service';
import {
  StartFlowDto,
  UpdateStep1Dto,
  UpdateStep2Dto,
  UpdateStep3MainDto,
  UpdateStep3SubDto,
  UpdateStep4Dto,
  UpdateStep5Dto,
  UpdateStep6Dto,
  UpdateStep7Dto,
  TrackPageDto,
  SaveMessageDto,
  UpdateSessionTitleDto,
  RespondToEstimateDto,
} from './dto';
import { StepResponseDto, FlowStartResponseDto } from './dto/step-response.dto';
import { ChatbotFlowDto } from './dto/chatbot-flow.dto';
import { ErrorResponseDto } from '../../common/dto';

@ApiTags('챗봇')
@Controller('chatbot')
export class ChatbotController {
  constructor(
    private chatbotService: ChatbotService,
    private supabaseService: SupabaseService,
  ) {}

  @Post('start')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // 1분에 5회로 제한 (스팸 방지)
  @ApiOperation({
    summary: '챗봇 플로우 시작',
    description: '새로운 챗봇 플로우를 시작하고 세션 ID를 반환합니다.',
  })
  @ApiResponse({
    status: 201,
    description: '플로우 시작 성공',
    type: FlowStartResponseDto,
  })
  async startFlow(@Body() dto: StartFlowDto, @Req() req: Request) {
    const ipAddress =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0] ||
      req.ip ||
      req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];
    const referer = req.headers['referer'] as string;

    // 선택적으로 userId 추출 (로그인한 경우)
    let userId: string | undefined;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const token = authHeader.split(' ')[1];
        const user = await this.supabaseService.getUserFromToken(token);
        userId = user?.id;
      } catch {
        // 토큰이 유효하지 않아도 무시 (비로그인 사용자로 처리)
      }
    }

    return this.chatbotService.startFlow(dto, ipAddress, userAgent, referer, userId);
  }

  @Get('categories')
  @Public()
  @ApiOperation({
    summary: '카테고리 목록 조회',
    description: '투어 타입, 관심사, 지역 등 모든 카테고리 목록을 조회합니다.',
  })
  @ApiResponse({ status: 200, description: '조회 성공' })
  getCategories() {
    return this.chatbotService.getCategories();
  }

  // ============ 정적 라우트 (동적 라우트보다 먼저 정의) ============

  @Get('sessions/user')
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: '사용자 세션 목록 조회',
    description: '로그인한 사용자의 챗봇 세션 목록을 조회합니다.',
  })
  @ApiResponse({ status: 200, description: '조회 성공' })
  @ApiResponse({ status: 401, description: '인증 필요', type: ErrorResponseDto })
  async getUserSessions(@CurrentUser('id') userId: string) {
    if (!userId) {
      throw new ForbiddenException('로그인이 필요합니다.');
    }
    return this.chatbotService.getUserSessions(userId);
  }

  @Get('admin/flows')
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: '챗봇 플로우 목록 조회 (관리자)',
    description: '모든 챗봇 플로우 목록을 조회합니다.',
  })
  @ApiQuery({ name: 'page', required: false, description: '페이지 번호' })
  @ApiQuery({ name: 'limit', required: false, description: '페이지당 개수' })
  @ApiQuery({
    name: 'isCompleted',
    required: false,
    description: '완료 여부 필터',
  })
  @ApiQuery({ name: 'startDate', required: false, description: '시작일 필터' })
  @ApiQuery({ name: 'endDate', required: false, description: '종료일 필터' })
  @ApiQuery({ name: 'utmSource', required: false, description: 'UTM 소스 필터' })
  @ApiResponse({ status: 200, description: '조회 성공' })
  async getFlows(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('isCompleted') isCompleted?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('utmSource') utmSource?: string,
  ) {
    return this.chatbotService.getFlows({
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
      isCompleted: isCompleted ? isCompleted === 'true' : undefined,
      startDate,
      endDate,
      utmSource,
    });
  }

  @Get('admin/stats')
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: '챗봇 플로우 통계 (관리자)',
    description: '플로우 전환율, 투어타입별, UTM 소스별 통계를 조회합니다.',
  })
  @ApiResponse({ status: 200, description: '조회 성공' })
  async getFlowStats() {
    return this.chatbotService.getFlowStats();
  }

  @Get('by-estimate/:estimateId')
  @Public()
  @ApiOperation({
    summary: 'estimateId로 플로우 조회',
    description: '견적 ID로 연결된 챗봇 플로우를 조회합니다.',
  })
  @ApiParam({ name: 'estimateId', description: '견적 ID' })
  @ApiResponse({ status: 200, description: '조회 성공', type: ChatbotFlowDto })
  @ApiResponse({ status: 404, description: '플로우 없음' })
  async getFlowByEstimateId(@Param('estimateId') estimateId: string) {
    const id = parseInt(estimateId, 10);
    return this.chatbotService.getFlowByEstimateId(id);
  }

  // ============ 동적 라우트 ============

  @Get(':sessionId')
  @Public()
  @ApiOperation({
    summary: '플로우 상태 조회',
    description: '현재 플로우의 전체 상태를 조회합니다.',
  })
  @ApiParam({ name: 'sessionId', description: '세션 ID' })
  @ApiResponse({ status: 200, description: '조회 성공', type: ChatbotFlowDto })
  @ApiResponse({ status: 404, description: '플로우 없음', type: ErrorResponseDto })
  async getFlow(@Param('sessionId') sessionId: string) {
    return this.chatbotService.getFlow(sessionId);
  }

  @Get(':sessionId/step/:step')
  @Public()
  @ApiOperation({
    summary: '단계별 질문 조회',
    description: '특정 단계의 질문과 선택지를 조회합니다.',
  })
  @ApiParam({ name: 'sessionId', description: '세션 ID' })
  @ApiParam({ name: 'step', description: '단계 번호 (1-7)' })
  @ApiQuery({
    name: 'subStep',
    required: false,
    description: 'Step 3의 경우 main 또는 sub',
  })
  @ApiResponse({ status: 200, description: '조회 성공', type: StepResponseDto })
  async getStep(
    @Param('sessionId') sessionId: string,
    @Param('step') step: string,
    @Query('subStep') subStep?: string,
  ) {
    return this.chatbotService.getStep(sessionId, parseInt(step), subStep);
  }

  @Patch(':sessionId/step/1')
  @Public()
  @ApiOperation({ summary: 'Step 1 업데이트', description: '투어 타입 선택' })
  @ApiParam({ name: 'sessionId', description: '세션 ID' })
  @ApiResponse({ status: 200, description: '업데이트 성공', type: ChatbotFlowDto })
  async updateStep1(
    @Param('sessionId') sessionId: string,
    @Body() dto: UpdateStep1Dto,
  ) {
    return this.chatbotService.updateStep1(sessionId, dto);
  }

  @Patch(':sessionId/step/2')
  @Public()
  @ApiOperation({ summary: 'Step 2 업데이트', description: '첫 방문 여부 선택' })
  @ApiParam({ name: 'sessionId', description: '세션 ID' })
  @ApiResponse({ status: 200, description: '업데이트 성공', type: ChatbotFlowDto })
  async updateStep2(
    @Param('sessionId') sessionId: string,
    @Body() dto: UpdateStep2Dto,
  ) {
    return this.chatbotService.updateStep2(sessionId, dto);
  }

  @Patch(':sessionId/step/3/main')
  @Public()
  @ApiOperation({
    summary: 'Step 3 메인 관심사 업데이트',
    description: '메인 관심사 카테고리 선택',
  })
  @ApiParam({ name: 'sessionId', description: '세션 ID' })
  @ApiResponse({ status: 200, description: '업데이트 성공', type: ChatbotFlowDto })
  async updateStep3Main(
    @Param('sessionId') sessionId: string,
    @Body() dto: UpdateStep3MainDto,
  ) {
    return this.chatbotService.updateStep3Main(sessionId, dto);
  }

  @Patch(':sessionId/step/3/sub')
  @Public()
  @ApiOperation({
    summary: 'Step 3 서브 관심사 업데이트',
    description: '세부 관심사 선택',
  })
  @ApiParam({ name: 'sessionId', description: '세션 ID' })
  @ApiResponse({ status: 200, description: '업데이트 성공', type: ChatbotFlowDto })
  async updateStep3Sub(
    @Param('sessionId') sessionId: string,
    @Body() dto: UpdateStep3SubDto,
  ) {
    return this.chatbotService.updateStep3Sub(sessionId, dto);
  }

  @Patch(':sessionId/step/4')
  @Public()
  @ApiOperation({ summary: 'Step 4 업데이트', description: '지역 선택' })
  @ApiParam({ name: 'sessionId', description: '세션 ID' })
  @ApiResponse({ status: 200, description: '업데이트 성공', type: ChatbotFlowDto })
  async updateStep4(
    @Param('sessionId') sessionId: string,
    @Body() dto: UpdateStep4Dto,
  ) {
    return this.chatbotService.updateStep4(sessionId, dto);
  }

  @Patch(':sessionId/step/5')
  @Public()
  @ApiOperation({ summary: 'Step 5 업데이트', description: '명소 선택' })
  @ApiParam({ name: 'sessionId', description: '세션 ID' })
  @ApiResponse({ status: 200, description: '업데이트 성공', type: ChatbotFlowDto })
  async updateStep5(
    @Param('sessionId') sessionId: string,
    @Body() dto: UpdateStep5Dto,
  ) {
    return this.chatbotService.updateStep5(sessionId, dto);
  }

  @Patch(':sessionId/step/6')
  @Public()
  @ApiOperation({ summary: 'Step 6 업데이트', description: '여행 정보 입력' })
  @ApiParam({ name: 'sessionId', description: '세션 ID' })
  @ApiResponse({ status: 200, description: '업데이트 성공', type: ChatbotFlowDto })
  async updateStep6(
    @Param('sessionId') sessionId: string,
    @Body() dto: UpdateStep6Dto,
  ) {
    return this.chatbotService.updateStep6(sessionId, dto);
  }

  @Patch(':sessionId/step/7')
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: 'Step 7 업데이트 (로그인 필수)',
    description: '연락처 정보 입력 - 로그인이 필요합니다.',
  })
  @ApiParam({ name: 'sessionId', description: '세션 ID' })
  @ApiResponse({ status: 200, description: '업데이트 성공', type: ChatbotFlowDto })
  @ApiResponse({ status: 401, description: '인증 필요', type: ErrorResponseDto })
  async updateStep7(
    @Param('sessionId') sessionId: string,
    @Body() dto: UpdateStep7Dto,
    @CurrentUser('id') userId: string,
  ) {
    if (!userId) {
      throw new ForbiddenException(
        '로그인이 필요합니다. Please sign in to continue.',
      );
    }
    return this.chatbotService.updateStep7(sessionId, dto, userId);
  }

  @Post(':sessionId/track')
  @Public()
  @ApiOperation({
    summary: '페이지 방문 기록',
    description: '사용자의 페이지 이동을 기록합니다.',
  })
  @ApiParam({ name: 'sessionId', description: '세션 ID' })
  @ApiResponse({ status: 200, description: '기록 성공' })
  async trackPage(
    @Param('sessionId') sessionId: string,
    @Body() dto: TrackPageDto,
  ) {
    return this.chatbotService.trackPageVisit(sessionId, dto.path);
  }

  @Post(':sessionId/complete')
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // 1분에 5회 제한
  @ApiOperation({
    summary: '플로우 완료 및 견적 생성 (로그인 필수)',
    description:
      '7단계 질문 플로우를 완료하고 초기 견적을 생성합니다. Step 7이 완료되어야 합니다.',
  })
  @ApiParam({ name: 'sessionId', description: '세션 ID' })
  @ApiResponse({ status: 201, description: '견적 생성 성공' })
  @ApiResponse({ status: 400, description: 'Step 7 미완료', type: ErrorResponseDto })
  @ApiResponse({ status: 401, description: '인증 필요', type: ErrorResponseDto })
  async completeFlow(
    @Param('sessionId') sessionId: string,
    @CurrentUser('id') userId: string,
  ) {
    if (!userId) {
      throw new ForbiddenException(
        '로그인이 필요합니다. Please sign in to continue.',
      );
    }
    return this.chatbotService.completeFlow(sessionId, userId);
  }

  @Post(':sessionId/send-to-expert')
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // 1분에 5회 제한
  @ApiOperation({
    summary: '전문가에게 보내기 (로그인 필수)',
    description:
      'AI 견적을 전문가 검토 대기 상태로 변경합니다. 견적이 먼저 생성되어 있어야 합니다.',
  })
  @ApiParam({ name: 'sessionId', description: '세션 ID' })
  @ApiResponse({ status: 200, description: '전문가에게 전달 성공' })
  @ApiResponse({ status: 400, description: '견적 미생성', type: ErrorResponseDto })
  @ApiResponse({ status: 401, description: '인증 필요', type: ErrorResponseDto })
  async sendToExpert(
    @Param('sessionId') sessionId: string,
    @CurrentUser('id') userId: string,
  ) {
    if (!userId) {
      throw new ForbiddenException(
        '로그인이 필요합니다. Please sign in to continue.',
      );
    }
    return this.chatbotService.sendToExpert(sessionId);
  }

  @Post(':sessionId/respond')
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // 1분에 10회 제한
  @ApiOperation({
    summary: '고객 응답 (승인/거절/수정요청)',
    description: '전문가가 보낸 견적에 대해 고객이 응답합니다.',
  })
  @ApiParam({ name: 'sessionId', description: '세션 ID' })
  @ApiResponse({ status: 200, description: '응답 처리 성공' })
  @ApiResponse({ status: 400, description: '견적 없음', type: ErrorResponseDto })
  @ApiResponse({ status: 401, description: '인증 필요', type: ErrorResponseDto })
  async respondToEstimate(
    @Param('sessionId') sessionId: string,
    @Body() dto: RespondToEstimateDto,
    @CurrentUser('id') userId: string,
  ) {
    if (!userId) {
      throw new ForbiddenException(
        '로그인이 필요합니다. Please sign in to continue.',
      );
    }
    return this.chatbotService.respondToEstimate(
      sessionId,
      dto.response,
      dto.modificationRequest,
    );
  }

  // ============ 메시지 API ============

  @Post(':sessionId/messages')
  @Public()
  @ApiOperation({
    summary: '메시지 저장',
    description: '챗봇 세션에 새 메시지를 저장합니다.',
  })
  @ApiParam({ name: 'sessionId', description: '세션 ID' })
  @ApiResponse({ status: 201, description: '메시지 저장 성공' })
  @ApiResponse({ status: 404, description: '세션 없음', type: ErrorResponseDto })
  async saveMessage(
    @Param('sessionId') sessionId: string,
    @Body() dto: SaveMessageDto,
  ) {
    return this.chatbotService.saveMessage(sessionId, dto);
  }

  @Get(':sessionId/messages')
  @Public()
  @ApiOperation({
    summary: '메시지 목록 조회',
    description: '챗봇 세션의 모든 메시지를 조회합니다.',
  })
  @ApiParam({ name: 'sessionId', description: '세션 ID' })
  @ApiResponse({ status: 200, description: '조회 성공' })
  @ApiResponse({ status: 404, description: '세션 없음', type: ErrorResponseDto })
  async getMessages(@Param('sessionId') sessionId: string) {
    return this.chatbotService.getMessages(sessionId);
  }

  @Patch(':sessionId/title')
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: '세션 제목 업데이트',
    description: '챗봇 세션의 제목을 변경합니다.',
  })
  @ApiParam({ name: 'sessionId', description: '세션 ID' })
  @ApiResponse({ status: 200, description: '업데이트 성공' })
  @ApiResponse({ status: 403, description: '권한 없음', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: '세션 없음', type: ErrorResponseDto })
  async updateSessionTitle(
    @Param('sessionId') sessionId: string,
    @Body() dto: UpdateSessionTitleDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.chatbotService.updateSessionTitle(sessionId, dto.title, userId);
  }

  @Delete(':sessionId')
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: '세션 삭제',
    description: '챗봇 세션과 관련 메시지를 삭제합니다.',
  })
  @ApiParam({ name: 'sessionId', description: '세션 ID' })
  @ApiResponse({ status: 200, description: '삭제 성공' })
  @ApiResponse({ status: 403, description: '권한 없음', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: '세션 없음', type: ErrorResponseDto })
  async deleteSession(
    @Param('sessionId') sessionId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.chatbotService.deleteSession(sessionId, userId);
  }
}
