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
  ParseIntPipe,
} from '@nestjs/common';
import type { Request } from 'express';
import { extractIpAddress, parseBooleanQuery } from '../../common/utils';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { UserRole } from '../../common/types';
import { CurrentUser } from '../../common/decorators/user.decorator';
import { FaqService } from './faq.service';
import { FaqEmbeddingService } from './faq-embedding.service';
import { FaqChatService } from './faq-chat.service';
import { FaqReviewService } from './faq-review.service';
import { FaqCategorizeService } from './faq-categorize.service';
import { FaqChatLogService } from './faq-chat-log.service';
import {
  FaqQueryDto,
  CreateFaqDto,
  UpdateFaqDto,
  ApproveFaqDto,
  RejectFaqDto,
  BulkActionDto,
  FaqSearchQueryDto,
  FaqChatDto,
  FaqFeedbackDto,
  FaqRegenerateDto,
  FaqChatLogQueryDto,
  CheckDuplicateDto,
  ScanDuplicatesDto,
  AutoReviewFaqsDto,
  TranslateFaqDto,
} from './dto';

@ApiTags('FAQ')
@ApiBearerAuth('access-token')
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN, UserRole.AGENT)
@SkipThrottle({ default: true, strict: true })
@Controller('faq')
export class FaqController {
  constructor(
    private faqService: FaqService,
    private faqEmbeddingService: FaqEmbeddingService,
    private faqChatService: FaqChatService,
    private faqReviewService: FaqReviewService,
    private faqCategorizeService: FaqCategorizeService,
    private faqChatLogService: FaqChatLogService,
  ) {}

  // ============================================================================
  // FAQ CRUD
  // ============================================================================

  @Get()
  @ApiOperation({ summary: 'FAQ 목록 조회' })
  async getFaqs(@Query() query: FaqQueryDto) {
    return this.faqService.getFaqs({
      page: query.page,
      limit: query.limit,
      status: query.status,
      source: query.source,
      search: query.search,
      category: query.category,
    });
  }

  @Get('search')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'FAQ 유사 검색 (챗봇용)' })
  async searchSimilar(@Query() query: FaqSearchQueryDto) {
    return this.faqEmbeddingService.searchSimilar(query.q, query.limit);
  }

  @Post('chat')
  @Public()
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @ApiOperation({ summary: 'FAQ 기반 AI 채팅' })
  async chatWithFaq(@Body() dto: FaqChatDto, @Req() req: Request) {
    return this.faqChatService.chatWithFaq(dto.message, dto.history, {
      ipAddress: extractIpAddress(req),
      visitorId: dto.visitorId,
    });
  }

  @Post('feedback')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'FAQ 챗봇 응답 피드백 (👍/👎)' })
  async submitFeedback(@Body() dto: FaqFeedbackDto) {
    return this.faqChatService.submitFeedback(dto.chatLogId, dto.helpful);
  }

  @Post('regenerate')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'FAQ 답변 재생성 (다른 유사 FAQ 기반)' })
  async regenerateAnswer(@Body() dto: FaqRegenerateDto) {
    return this.faqChatService.regenerateAnswer(dto.chatLogId);
  }

  @Get('answer/:id')
  @Public()
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @ApiOperation({ summary: 'FAQ 원문 답변 조회 (제안 질문 클릭용)' })
  @ApiParam({ name: 'id', description: 'FAQ ID' })
  async getDirectFaqAnswer(@Param('id', ParseIntPipe) id: number) {
    return this.faqChatService.getDirectFaqAnswer(id);
  }

  @Post('translate')
  @ApiOperation({ summary: 'FAQ 텍스트 번역 (한↔영)' })
  async translateText(@Body() body: TranslateFaqDto) {
    return this.faqService.translateText(body.text, body.targetLanguage);
  }

  @Post('remove-duplicates')
  @ApiOperation({ summary: '텍스트 기반 중복 제거 + 저품질 FAQ 삭제' })
  async removeDuplicates() {
    return this.faqService.removeDuplicates();
  }

  @Post('scan-duplicates')
  @ApiOperation({ summary: '기존 FAQ 간 중복 스캔 (임베딩 기반)' })
  async scanDuplicates(@Body() body: ScanDuplicatesDto) {
    return this.faqService.scanDuplicates(body.threshold);
  }

  @Post('auto-categorize')
  @ApiOperation({ summary: 'AI 자동 카테고리 분류 (미분류 FAQ 대상)' })
  async autoCategorize() {
    return this.faqCategorizeService.autoCategorizeFaqs();
  }

  @Post('check-duplicate')
  @ApiOperation({ summary: 'FAQ 중복 체크' })
  async checkDuplicate(@Body() body: CheckDuplicateDto) {
    return this.faqEmbeddingService.checkDuplicates(
      body.question,
      body.threshold,
      body.excludeId,
    );
  }

  @Get('embedding-status')
  @ApiOperation({ summary: 'FAQ 임베딩 상태 (관리자)' })
  async getEmbeddingStatus() {
    return this.faqEmbeddingService.getEmbeddingStatus();
  }

  @Get('stats')
  @ApiOperation({ summary: 'FAQ 통계' })
  async getStats() {
    return this.faqService.getStats();
  }

  @Get('chat-logs')
  @ApiOperation({ summary: 'FAQ 채팅 로그 목록 (관리자)' })
  async getChatLogs(@Query() query: FaqChatLogQueryDto) {
    return this.faqChatLogService.getFaqChatLogs({
      page: query.page,
      limit: query.limit,
      noMatch: parseBooleanQuery(query.noMatch),
      startDate: query.startDate,
      endDate: query.endDate,
      search: query.search,
      responseTier: query.responseTier,
      visitorId: query.visitorId,
    });
  }

  @Get('chat-stats')
  @ApiOperation({ summary: 'FAQ 채팅 통계 (관리자)' })
  async getChatStats() {
    return this.faqChatLogService.getFaqChatStats();
  }

  @Delete('chat-logs')
  @ApiOperation({ summary: '채팅 로그 삭제' })
  async deleteChatLogs(@Body() body: { ids: number[] }) {
    return this.faqChatLogService.deleteChatLogs(body.ids);
  }

  @Get(':id')
  @ApiOperation({ summary: 'FAQ 상세 조회' })
  @ApiParam({ name: 'id', description: 'FAQ ID' })
  async getFaq(@Param('id', ParseIntPipe) id: number) {
    return this.faqService.getFaq(id);
  }

  @Post()
  @ApiOperation({ summary: 'FAQ 생성 (수동)' })
  async createFaq(@Body() body: CreateFaqDto) {
    return this.faqService.createFaq({
      question: body.question,
      questionKo: body.questionKo,
      tags: body.tags,
      category: body.category,
      guideline: body.guideline,
      reference: body.reference,
      source: 'manual',
    });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'FAQ 수정' })
  @ApiParam({ name: 'id', description: 'FAQ ID' })
  async updateFaq(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateFaqDto,
  ) {
    const data: Record<string, unknown> = {};
    if (body.question !== undefined) data.question = body.question;
    if (body.questionKo !== undefined) data.questionKo = body.questionKo;
    if (body.tags !== undefined) data.tags = body.tags;
    if (body.category !== undefined) data.category = body.category;
    if (body.guideline !== undefined) data.guideline = body.guideline;
    if (body.reference !== undefined) data.reference = body.reference;
    return this.faqService.updateFaq(id, data);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'FAQ 삭제' })
  @ApiParam({ name: 'id', description: 'FAQ ID' })
  async deleteFaq(@Param('id', ParseIntPipe) id: number) {
    return this.faqService.deleteFaq(id);
  }

  // ============================================================================
  // 승인 / 거절
  // ============================================================================

  @Patch(':id/approve')
  @ApiOperation({ summary: 'FAQ 승인' })
  @ApiParam({ name: 'id', description: 'FAQ ID' })
  async approveFaq(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('id') userId: string,
    @Body() body: ApproveFaqDto,
  ) {
    return this.faqService.approveFaq(id, userId, body);
  }

  @Patch(':id/reject')
  @ApiOperation({ summary: 'FAQ 거절' })
  @ApiParam({ name: 'id', description: 'FAQ ID' })
  async rejectFaq(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('id') userId: string,
    @Body() body: RejectFaqDto,
  ) {
    return this.faqService.rejectFaq(id, userId, body.reason || undefined);
  }

  @Post('bulk')
  @ApiOperation({ summary: 'FAQ 일괄 처리' })
  async bulkAction(
    @CurrentUser('id') userId: string,
    @Body() body: BulkActionDto,
  ) {
    return this.faqService.bulkAction(
      body.ids,
      body.action,
      userId,
      body.reason,
      body.category,
    );
  }

  @Post('auto-review')
  @ApiOperation({
    summary: 'AI 자동 리뷰 (pending FAQ 일괄 승인/거절)',
    description:
      'Gemini AI가 pending FAQ를 배치로 평가하여 자동 승인/거절/보류 처리합니다. dryRun=true로 미리보기 가능.',
  })
  async autoReview(
    @CurrentUser('id') userId: string,
    @Body() body: AutoReviewFaqsDto,
  ) {
    return this.faqReviewService.autoReviewFaqs(userId, {
      batchSize: body.batchSize,
      dryRun: body.dryRun,
    });
  }

  @Post('regenerate-embeddings')
  @ApiOperation({
    summary: '승인된 FAQ 전체 임베딩 재생성 (enriched text 기반)',
    description:
      '대안 질문 자동 생성 + enriched text 임베딩. regenerate=true로 대안 질문 강제 재생성.',
  })
  async regenerateEmbeddings(
    @Query('regenerate') regenerate?: string,
  ) {
    return this.faqEmbeddingService.regenerateAllEmbeddings({
      regenerateAlternatives: regenerate === 'true',
    });
  }
}
