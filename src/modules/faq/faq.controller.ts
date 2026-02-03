import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
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
import {
  FaqQueryDto,
  CreateFaqDto,
  UpdateFaqDto,
  ApproveFaqDto,
  RejectFaqDto,
  BulkActionDto,
  FaqSearchQueryDto,
} from './dto';

@ApiTags('FAQ')
@ApiBearerAuth('access-token')
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN, UserRole.AGENT)
@SkipThrottle({ default: true, strict: true })
@Controller('faq')
export class FaqController {
  constructor(private faqService: FaqService) {}

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
    });
  }

  @Get('search')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'FAQ 유사 검색 (챗봇용)' })
  async searchSimilar(@Query() query: FaqSearchQueryDto) {
    return this.faqService.searchSimilar(query.q, query.limit);
  }

  @Get('stats')
  @ApiOperation({ summary: 'FAQ 통계' })
  async getStats() {
    return this.faqService.getStats();
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
      answer: body.answer,
      questionKo: body.questionKo,
      answerKo: body.answerKo,
      tags: body.tags,
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
    if (body.answer !== undefined) data.answer = body.answer;
    if (body.questionKo !== undefined) data.questionKo = body.questionKo;
    if (body.answerKo !== undefined) data.answerKo = body.answerKo;
    if (body.tags !== undefined) data.tags = body.tags;
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
    return this.faqService.bulkAction(body.ids, body.action, userId, body.reason);
  }

}
