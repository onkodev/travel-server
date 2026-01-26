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
import { ChatbotAnalyticsService } from './chatbot-analytics.service';
import { AiEstimateService } from './ai-estimate.service';
import { ConversationalEstimateService } from './conversational-estimate.service';
import { Public } from '../../common/decorators/public.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/user.decorator';
import { RequireUserId } from '../../common/decorators/require-user.decorator';
import { SupabaseService } from '../../supabase/supabase.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  StartFlowDto,
  UpdateStep1Dto,
  UpdateStep2Dto,
  UpdateStep3MainDto,
  UpdateStep3SubDto,
  UpdateStep4Dto,
  UpdatePlanDto,
  UpdateStep5Dto,
  UpdateStep6Dto,
  UpdateStep7Dto,
  TrackPageDto,
  SaveMessageDto,
  SaveMessageBatchDto,
  UpdateSessionTitleDto,
  RespondToEstimateDto,
  ModifyEstimateDto,
  GenerateEstimateResponseDto,
  ModifyEstimateResponseDto,
  ModifyItineraryMessageDto,
  ModifyItineraryResponseDto,
  RegenerateDayResponseDto,
  FinalizeItineraryResponseDto,
  TravelChatDto,
  TravelChatResponseDto,
} from './dto';
import { StepResponseDto, FlowStartResponseDto } from './dto/step-response.dto';
import { ChatbotFlowDto } from './dto/chatbot-flow.dto';
import { ErrorResponseDto } from '../../common/dto';

@ApiTags('챗봇')
@Controller('chatbot')
export class ChatbotController {
  constructor(
    private chatbotService: ChatbotService,
    private chatbotAnalyticsService: ChatbotAnalyticsService,
    private aiEstimateService: AiEstimateService,
    private conversationalEstimateService: ConversationalEstimateService,
    private supabaseService: SupabaseService,
    private prisma: PrismaService,
  ) {}

  @Post('start')
  @Public()
  @SkipThrottle()
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
  @SkipThrottle()
  @ApiOperation({
    summary: '카테고리 목록 조회',
    description: '투어 타입, 관심사, 지역 등 모든 카테고리 목록을 조회합니다.',
  })
  @ApiResponse({ status: 200, description: '조회 성공' })
  async getCategories() {
    return this.chatbotService.getCategories();
  }

  // ============ 정적 라우트 (동적 라우트보다 먼저 정의) ============

  @Get('sessions/user')
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard)
  @SkipThrottle()
  @ApiOperation({
    summary: '사용자 세션 목록 조회',
    description: '로그인한 사용자의 챗봇 세션 목록을 조회합니다.',
  })
  @ApiResponse({ status: 200, description: '조회 성공' })
  @ApiResponse({ status: 401, description: '인증 필요', type: ErrorResponseDto })
  async getUserSessions(@RequireUserId() userId: string) {
    return this.chatbotService.getUserSessions(userId);
  }

  @Get('admin/flows')
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard)
  @SkipThrottle()
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
  @SkipThrottle()
  @ApiOperation({
    summary: '챗봇 플로우 통계 (관리자)',
    description: '플로우 전환율, 투어타입별, UTM 소스별 통계를 조회합니다.',
  })
  @ApiResponse({ status: 200, description: '조회 성공' })
  async getFlowStats() {
    return this.chatbotAnalyticsService.getFlowStats();
  }

  @Get('admin/funnel')
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard)
  @SkipThrottle()
  @ApiOperation({
    summary: '퍼널 분석 (관리자)',
    description: '단계별 전환율과 이탈률을 분석합니다.',
  })
  @ApiQuery({ name: 'days', required: false, description: '조회 기간 (일)' })
  @ApiResponse({ status: 200, description: '조회 성공' })
  async getFunnelAnalysis(@Query('days') days?: string) {
    return this.chatbotAnalyticsService.getFunnelAnalysis(days ? parseInt(days) : 30);
  }

  @Get('admin/leads')
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard)
  @SkipThrottle()
  @ApiOperation({
    summary: '유망 리드 목록 (관리자)',
    description: '리드 스코어 기반으로 유망 고객을 분석합니다.',
  })
  @ApiQuery({ name: 'limit', required: false, description: '조회 개수' })
  @ApiResponse({ status: 200, description: '조회 성공' })
  async getLeadScores(@Query('limit') limit?: string) {
    return this.chatbotAnalyticsService.getLeadScores(limit ? parseInt(limit) : 50);
  }

  @Get('admin/countries')
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard)
  @SkipThrottle()
  @ApiOperation({
    summary: '국가별 통계 (관리자)',
    description: '국가별 방문 및 전환율을 분석합니다.',
  })
  @ApiQuery({ name: 'days', required: false, description: '조회 기간 (일)' })
  @ApiResponse({ status: 200, description: '조회 성공' })
  async getCountryStats(@Query('days') days?: string) {
    return this.chatbotAnalyticsService.getCountryStats(days ? parseInt(days) : 30);
  }

  @Get('admin/flow/:sessionId')
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard)
  @SkipThrottle()
  @ApiOperation({
    summary: '플로우 상세 조회 (관리자)',
    description: '플로우 상세 정보와 방문자의 사이트 브라우징 기록을 조회합니다.',
  })
  @ApiParam({ name: 'sessionId', description: '세션 ID' })
  @ApiResponse({ status: 200, description: '조회 성공', type: ChatbotFlowDto })
  @ApiResponse({ status: 404, description: '플로우 없음', type: ErrorResponseDto })
  async getFlowAdmin(@Param('sessionId') sessionId: string) {
    return this.chatbotService.getFlow(sessionId, true);
  }

  @Post(':sessionId/create-estimate')
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard)
  @SkipThrottle()
  @ApiOperation({
    summary: '챗봇에서 견적 생성 (관리자)',
    description: '챗봇 상담 데이터를 기반으로 새 견적을 생성하고 세션에 연결합니다.',
  })
  @ApiParam({ name: 'sessionId', description: '세션 ID' })
  @ApiResponse({ status: 201, description: '견적 생성 성공' })
  @ApiResponse({ status: 400, description: '이미 견적이 연결됨', type: ErrorResponseDto })
  @ApiResponse({ status: 401, description: '인증 필요', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: '플로우 없음', type: ErrorResponseDto })
  async createEstimateFromChatbot(
    @Param('sessionId') sessionId: string,
    @Body() body: { title?: string },
    @RequireUserId() _userId: string, // 인증 확인용
  ) {
    return this.chatbotService.createEstimateFromFlow(sessionId, body.title);
  }

  @Get('by-estimate/:estimateId')
  @Public()
  @SkipThrottle()
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
  @SkipThrottle()
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
  @SkipThrottle()
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
  @SkipThrottle()
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
  @SkipThrottle()
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
  @SkipThrottle()
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
  @SkipThrottle()
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
  @SkipThrottle()
  @ApiOperation({ summary: 'Step 4 업데이트', description: '지역 선택' })
  @ApiParam({ name: 'sessionId', description: '세션 ID' })
  @ApiResponse({ status: 200, description: '업데이트 성공', type: ChatbotFlowDto })
  async updateStep4(
    @Param('sessionId') sessionId: string,
    @Body() dto: UpdateStep4Dto,
  ) {
    return this.chatbotService.updateStep4(sessionId, dto);
  }

  @Patch(':sessionId/plan')
  @Public()
  @SkipThrottle()
  @ApiOperation({ summary: '계획유무 업데이트', description: '여행 계획 유무 및 상세 정보 저장' })
  @ApiParam({ name: 'sessionId', description: '세션 ID' })
  @ApiResponse({ status: 200, description: '업데이트 성공', type: ChatbotFlowDto })
  async updatePlan(
    @Param('sessionId') sessionId: string,
    @Body() dto: UpdatePlanDto,
  ) {
    return this.chatbotService.updatePlan(sessionId, dto);
  }

  @Patch(':sessionId/step/5')
  @Public()
  @SkipThrottle()
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
  @UseGuards(AuthGuard) // Public이지만 토큰이 있으면 사용자 정보 추출
  @SkipThrottle()
  @ApiOperation({ summary: 'Step 6 업데이트', description: '여행 정보 입력' })
  @ApiParam({ name: 'sessionId', description: '세션 ID' })
  @ApiResponse({ status: 200, description: '업데이트 성공', type: ChatbotFlowDto })
  async updateStep6(
    @Param('sessionId') sessionId: string,
    @Body() dto: UpdateStep6Dto,
    @CurrentUser('id') userId?: string, // 로그인된 경우 자동 연결
  ) {
    return this.chatbotService.updateStep6(sessionId, dto, userId);
  }

  @Patch(':sessionId/step/7')
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard)
  @SkipThrottle()
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
    @RequireUserId() userId: string,
  ) {
    return this.chatbotService.updateStep7(sessionId, dto, userId);
  }

  @Post(':sessionId/track')
  @Public()
  @SkipThrottle()
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
  @Public()
  @UseGuards(AuthGuard) // Public이지만 토큰 있으면 userId 추출
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // 1분에 5회 제한
  @ApiOperation({
    summary: '플로우 완료 및 견적 생성',
    description:
      '7단계 질문 플로우를 완료하고 초기 견적을 생성합니다. Step 6이 완료되어야 합니다.',
  })
  @ApiParam({ name: 'sessionId', description: '세션 ID' })
  @ApiResponse({ status: 201, description: '견적 생성 성공' })
  @ApiResponse({ status: 400, description: '설문 미완료', type: ErrorResponseDto })
  async completeFlow(
    @Param('sessionId') sessionId: string,
    @CurrentUser('id') userId?: string,
  ) {
    return this.chatbotService.completeFlow(sessionId, userId);
  }

  @Post(':sessionId/send-to-expert')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // 1분에 5회 제한
  @ApiOperation({
    summary: '전문가에게 보내기',
    description:
      '상담 요청을 전문가에게 전송합니다. 견적이 있으면 검토 대기 상태로 변경하고, 없으면 상담 요청만 전송합니다.',
  })
  @ApiParam({ name: 'sessionId', description: '세션 ID' })
  @ApiResponse({ status: 200, description: '전문가에게 전달 성공' })
  async sendToExpert(
    @Param('sessionId') sessionId: string,
  ) {
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
    @RequireUserId() _userId: string, // 인증 확인용
  ) {
    return this.chatbotService.respondToEstimate(
      sessionId,
      dto.response,
      dto.modificationRequest,
    );
  }

  // ============ 메시지 API ============

  @Post(':sessionId/messages')
  @Public()
  @SkipThrottle()
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

  @Post(':sessionId/messages/batch')
  @Public()
  @SkipThrottle()
  @ApiOperation({
    summary: '메시지 배치 저장',
    description: '여러 메시지를 한 번에 저장합니다. Rate limit 적용 제외.',
  })
  @ApiParam({ name: 'sessionId', description: '세션 ID' })
  @ApiResponse({ status: 201, description: '메시지 배치 저장 성공' })
  @ApiResponse({ status: 404, description: '세션 없음', type: ErrorResponseDto })
  async saveMessagesBatch(
    @Param('sessionId') sessionId: string,
    @Body() dto: SaveMessageBatchDto,
  ) {
    return this.chatbotService.saveMessagesBatch(sessionId, dto.messages);
  }

  @Get(':sessionId/messages')
  @Public()
  @SkipThrottle()
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
  @SkipThrottle()
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

  @Patch(':sessionId/link-user')
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard)
  @SkipThrottle()
  @ApiOperation({
    summary: '세션을 현재 사용자에게 연결',
    description: '비로그인 상태에서 생성된 세션을 현재 로그인한 사용자에게 연결합니다.',
  })
  @ApiParam({ name: 'sessionId', description: '세션 ID' })
  @ApiResponse({ status: 200, description: '연결 성공' })
  @ApiResponse({ status: 404, description: '세션 없음', type: ErrorResponseDto })
  async linkSessionToUser(
    @Param('sessionId') sessionId: string,
    @RequireUserId() userId: string,
  ) {
    return this.chatbotService.linkSessionToUser(sessionId, userId);
  }

  @Delete(':sessionId')
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard)
  @SkipThrottle()
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
    @CurrentUser('role') userRole: string,
  ) {
    return this.chatbotService.deleteSession(sessionId, userId, userRole);
  }

  // ============ AI 견적 API ============

  @Post(':sessionId/estimate/generate')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({
    summary: 'AI 견적 생성 (향상된 버전)',
    description: '설문 완료 후 AI가 템플릿 기반으로 맞춤 견적을 생성합니다. Gemini AI를 활용하여 최적의 템플릿을 선택하고, 사용자가 선택한 명소를 반영합니다.',
  })
  @ApiParam({ name: 'sessionId', description: '세션 ID' })
  @ApiResponse({
    status: 201,
    description: '견적 생성 성공',
    type: GenerateEstimateResponseDto,
  })
  @ApiResponse({ status: 400, description: '설문 미완료', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: '세션 없음', type: ErrorResponseDto })
  async generateAiEstimate(
    @Param('sessionId') sessionId: string,
  ) {
    const result = await this.aiEstimateService.generateFirstEstimate(sessionId);

    // 생성된 견적의 items 조회
    const estimate = await this.prisma.estimate.findUnique({
      where: { id: result.estimateId },
      select: { items: true },
    });

    const items = (estimate?.items || []) as unknown as Array<{
      isTbd?: boolean;
      dayNumber?: number;
      orderIndex?: number;
      itemId?: number;
      type?: string;
      note?: string;
      itemInfo?: {
        nameKor?: string;
        nameEng?: string;
        descriptionEng?: string;
        images?: Array<{ url: string; type?: string }>;
        lat?: number;
        lng?: number;
        addressEnglish?: string;
      };
    }>;

    // images 배열에서 URL만 추출하는 헬퍼
    const extractImageUrls = (images?: Array<{ url: string; type?: string }>): string[] => {
      if (!images || !Array.isArray(images)) return [];
      return images.map(img => img.url).filter(Boolean);
    };

    return {
      ...result,
      items: items.map(item => ({
        id: String(item.itemId || `tbd-${item.dayNumber}`),
        type: item.type || 'place',
        itemId: item.itemId || null,
        itemName: item.itemInfo?.nameKor || item.itemInfo?.nameEng,
        name: item.itemInfo?.nameKor,
        nameEng: item.itemInfo?.nameEng,
        dayNumber: item.dayNumber || 1,
        orderIndex: item.orderIndex || 0,
        isTbd: item.isTbd || false,
        note: item.note,
        itemInfo: item.itemInfo ? {
          nameKor: item.itemInfo.nameKor,
          nameEng: item.itemInfo.nameEng,
          descriptionEng: item.itemInfo.descriptionEng,
          images: extractImageUrls(item.itemInfo.images),
          lat: item.itemInfo.lat,
          lng: item.itemInfo.lng,
          addressEnglish: item.itemInfo.addressEnglish,
        } : undefined,
      })),
      hasTbdDays: items.some(item => item.isTbd),
    };
  }

  @Patch('estimate/:estimateId/modify')
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({
    summary: 'AI 견적 수정',
    description: '기존 AI 견적의 아이템을 교체/추가/삭제합니다. 관심사와 지역을 고려하여 최적의 대체 장소를 AI가 선택합니다.',
  })
  @ApiParam({ name: 'estimateId', description: '견적 ID' })
  @ApiResponse({
    status: 200,
    description: '수정 성공',
    type: ModifyEstimateResponseDto,
  })
  @ApiResponse({ status: 400, description: '잘못된 요청', type: ErrorResponseDto })
  @ApiResponse({ status: 401, description: '인증 필요', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: '견적 없음', type: ErrorResponseDto })
  async modifyAiEstimate(
    @Param('estimateId') estimateId: string,
    @Body() dto: ModifyEstimateDto,
    @RequireUserId() _userId: string,
  ) {
    return this.aiEstimateService.modifyEstimate(parseInt(estimateId, 10), {
      dayNumber: dto.dayNumber,
      replaceItemId: dto.replaceItemId,
      action: dto.action,
      preference: dto.preference,
    });
  }

  // ============ AI 대화형 일정 수정 API (Step 7) ============

  @Post(':sessionId/chat')
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({
    summary: '여행 도우미 대화',
    description: 'AI 여행 도우미와 대화합니다. 여행 관련 질문에 답변하고, 일정 수정 요청도 처리합니다.',
  })
  @ApiParam({ name: 'sessionId', description: '세션 ID' })
  @ApiResponse({
    status: 200,
    description: '응답 성공',
    type: TravelChatResponseDto,
  })
  @ApiResponse({ status: 404, description: '세션 없음', type: ErrorResponseDto })
  async travelChat(
    @Param('sessionId') sessionId: string,
    @Body() dto: TravelChatDto,
  ): Promise<TravelChatResponseDto> {
    return this.conversationalEstimateService.chat(sessionId, dto.message);
  }

  @Post(':sessionId/itinerary/modify')
  @Public()
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({
    summary: '대화형 일정 수정',
    description: '사용자의 자연어 메시지를 분석하여 AI가 일정을 수정합니다. Step 7에서 사용됩니다.',
  })
  @ApiParam({ name: 'sessionId', description: '세션 ID' })
  @ApiResponse({
    status: 200,
    description: '수정 성공',
    type: ModifyItineraryResponseDto,
  })
  @ApiResponse({ status: 400, description: '견적 없음', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: '세션 없음', type: ErrorResponseDto })
  async modifyItineraryConversational(
    @Param('sessionId') sessionId: string,
    @Body() dto: ModifyItineraryMessageDto,
  ) {
    return this.conversationalEstimateService.modifyItinerary(sessionId, dto.message);
  }

  @Post(':sessionId/itinerary/regenerate-day/:dayNumber')
  @Public()
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({
    summary: '특정 일차 일정 재생성',
    description: '지정된 일차의 일정을 AI가 새로 생성합니다.',
  })
  @ApiParam({ name: 'sessionId', description: '세션 ID' })
  @ApiParam({ name: 'dayNumber', description: '재생성할 일차' })
  @ApiResponse({
    status: 200,
    description: '재생성 성공',
    type: RegenerateDayResponseDto,
  })
  @ApiResponse({ status: 400, description: '잘못된 요청', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: '세션 없음', type: ErrorResponseDto })
  async regenerateDay(
    @Param('sessionId') sessionId: string,
    @Param('dayNumber') dayNumber: string,
  ) {
    return this.conversationalEstimateService.regenerateDay(sessionId, parseInt(dayNumber, 10));
  }

  @Post(':sessionId/itinerary/finalize')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({
    summary: '일정 확정 및 전문가에게 전송',
    description: 'Step 7에서 수정한 일정을 확정하고 전문가에게 전송합니다.',
  })
  @ApiParam({ name: 'sessionId', description: '세션 ID' })
  @ApiResponse({
    status: 200,
    description: '전송 성공',
    type: FinalizeItineraryResponseDto,
  })
  @ApiResponse({ status: 400, description: '견적 없음', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: '세션 없음', type: ErrorResponseDto })
  async finalizeItinerary(@Param('sessionId') sessionId: string) {
    return this.conversationalEstimateService.finalizeItinerary(sessionId);
  }
}
