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
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/types';
import { EstimateService } from './estimate.service';
import { EstimateSchedulerService } from './estimate-scheduler.service';
import { Public } from '../../common/decorators/public.decorator';
import {
  EstimateDto,
  EstimateListItemDto,
  EstimateListQueryDto,
  CreateEstimateDto,
  UpdateEstimateDto,
  UpdateStatusDto,
  UpdatePinnedDto,
  UpdateItemsDto,
  UpdateAdjustmentDto,
  BulkDeleteDto,
  BulkStatusDto,
  EstimateStatsDto,
  ManualEstimateStatsDto,
  AIEstimateStatsDto,
  AdjacentIdsDto,
} from './dto';
import {
  ErrorResponseDto,
  SuccessResponseDto,
  PaginationMetaDto,
} from '../../common/dto';

class EstimateListResponseDto {
  data: EstimateListItemDto[];
  meta: PaginationMetaDto;
  total: number;
}

@ApiTags('견적')
@ApiBearerAuth('access-token')
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN, UserRole.AGENT)
@SkipThrottle()
@Controller('estimates')
export class EstimateController {
  constructor(
    private estimateService: EstimateService,
    private estimateSchedulerService: EstimateSchedulerService,
  ) {}

  @Get()
  @ApiOperation({
    summary: '견적 목록 조회',
    description: '필터와 페이지네이션을 적용하여 견적 목록을 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '조회 성공',
    type: EstimateListResponseDto,
  })
  async getEstimates(@Query() query: EstimateListQueryDto) {
    return this.estimateService.getEstimates({
      page: query.page,
      limit: query.limit,
      source: query.source,
      statusManual: query.statusManual,
      statusAi: query.statusAi,
      excludeStatusManual: query.excludeStatusManual,
      excludeStatusAi: query.excludeStatusAi,
      search: query.search,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      isPinned: query.isPinned,
      upcoming: query.upcoming,
    });
  }

  @Get('stats')
  @ApiOperation({
    summary: '견적 통계 조회',
    description: '전체 견적의 기본 통계 (총 수, 수동/AI별 수)를 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '조회 성공',
    type: EstimateStatsDto,
  })
  async getStats() {
    return this.estimateService.getStats();
  }

  @Get('stats/manual')
  @ApiOperation({
    summary: '수동 견적 통계 조회',
    description: '수동 견적의 상태별 통계를 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '조회 성공',
    type: ManualEstimateStatsDto,
  })
  async getManualStats() {
    return this.estimateService.getManualStats();
  }

  @Get('stats/ai')
  @ApiOperation({
    summary: 'AI 견적 통계 조회',
    description: 'AI 견적의 상태별 통계를 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '조회 성공',
    type: AIEstimateStatsDto,
  })
  async getAIStats() {
    return this.estimateService.getAIStats();
  }

  @Public()
  @Get('share/:shareHash')
  @ApiOperation({
    summary: '공유 링크로 견적 조회',
    description:
      '공유 해시를 사용하여 견적을 조회합니다. 인증 없이 접근 가능합니다.',
  })
  @ApiParam({ name: 'shareHash', description: '공유 해시' })
  @ApiResponse({ status: 200, description: '조회 성공', type: EstimateDto })
  @ApiResponse({
    status: 404,
    description: '견적 없음',
    type: ErrorResponseDto,
  })
  async getEstimateByShareHash(@Param('shareHash') shareHash: string) {
    return this.estimateService.getEstimateByShareHash(shareHash);
  }

  @Post('bulk-delete')
  @ApiOperation({
    summary: '견적 일괄 삭제',
    description: '여러 견적을 한 번에 삭제합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '삭제 성공',
    type: SuccessResponseDto,
  })
  async bulkDelete(@Body() body: BulkDeleteDto) {
    return this.estimateService.bulkDelete(body.ids);
  }

  @Post('bulk-status')
  @ApiOperation({
    summary: '견적 일괄 상태 변경',
    description: '여러 견적의 상태를 한 번에 변경합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '변경 성공',
    type: SuccessResponseDto,
  })
  async bulkUpdateStatus(@Body() body: BulkStatusDto) {
    return this.estimateService.bulkUpdateStatus(body.ids, body.status);
  }

  @Post('sync-status')
  @ApiOperation({
    summary: '견적 상태 자동 동기화',
    description:
      '여행 날짜 기준으로 견적 상태를 자동 업데이트합니다. (planning→in_progress→completed)',
  })
  @ApiResponse({
    status: 200,
    description: '동기화 성공',
    type: SuccessResponseDto,
  })
  async syncEstimateStatus() {
    await this.estimateSchedulerService.runManualStatusUpdate();
    return { success: true, message: '견적 상태가 동기화되었습니다.' };
  }

  @Get(':id')
  @ApiOperation({
    summary: '견적 상세 조회',
    description: '특정 견적의 상세 정보를 조회합니다.',
  })
  @ApiParam({ name: 'id', description: '견적 ID' })
  @ApiResponse({ status: 200, description: '조회 성공', type: EstimateDto })
  @ApiResponse({
    status: 404,
    description: '견적 없음',
    type: ErrorResponseDto,
  })
  async getEstimate(@Param('id', ParseIntPipe) id: number) {
    return this.estimateService.getEstimate(id);
  }

  @Get(':id/adjacent')
  @ApiOperation({
    summary: '이전/다음 견적 ID 조회',
    description: '현재 견적의 이전/다음 견적 ID를 조회합니다.',
  })
  @ApiParam({ name: 'id', description: '견적 ID' })
  @ApiResponse({ status: 200, description: '조회 성공', type: AdjacentIdsDto })
  async getAdjacentIds(@Param('id', ParseIntPipe) id: number) {
    return this.estimateService.getAdjacentIds(id);
  }

  @Post()
  @ApiOperation({
    summary: '견적 생성',
    description: '새로운 견적을 생성합니다.',
  })
  @ApiResponse({ status: 201, description: '생성 성공', type: EstimateDto })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청',
    type: ErrorResponseDto,
  })
  async createEstimate(@Body() body: CreateEstimateDto) {
    return this.estimateService.createEstimate(body);
  }

  @Post(':id/duplicate')
  @ApiOperation({
    summary: '견적 복제',
    description: '기존 견적을 복제하여 새로운 견적을 생성합니다.',
  })
  @ApiParam({ name: 'id', description: '견적 ID' })
  @ApiResponse({ status: 201, description: '복제 성공', type: EstimateDto })
  @ApiResponse({
    status: 404,
    description: '견적 없음',
    type: ErrorResponseDto,
  })
  async duplicateEstimate(@Param('id', ParseIntPipe) id: number) {
    return this.estimateService.duplicate(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: '견적 수정',
    description: '기존 견적 정보를 수정합니다.',
  })
  @ApiParam({ name: 'id', description: '견적 ID' })
  @ApiResponse({ status: 200, description: '수정 성공', type: EstimateDto })
  @ApiResponse({
    status: 404,
    description: '견적 없음',
    type: ErrorResponseDto,
  })
  async updateEstimate(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateEstimateDto,
  ) {
    return this.estimateService.updateEstimate(id, body);
  }

  @Patch(':id/status/manual')
  @ApiOperation({
    summary: '수동 견적 상태 변경',
    description: '수동 견적의 상태를 변경합니다.',
  })
  @ApiParam({ name: 'id', description: '견적 ID' })
  @ApiResponse({ status: 200, description: '변경 성공', type: EstimateDto })
  @ApiResponse({
    status: 404,
    description: '견적 없음',
    type: ErrorResponseDto,
  })
  async updateManualStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateStatusDto,
  ) {
    return this.estimateService.updateManualStatus(id, body.status);
  }

  @Patch(':id/status/ai')
  @ApiOperation({
    summary: 'AI 견적 상태 변경',
    description: 'AI 견적의 상태를 변경합니다.',
  })
  @ApiParam({ name: 'id', description: '견적 ID' })
  @ApiResponse({ status: 200, description: '변경 성공', type: EstimateDto })
  @ApiResponse({
    status: 404,
    description: '견적 없음',
    type: ErrorResponseDto,
  })
  async updateAIStatus(@Param('id', ParseIntPipe) id: number, @Body() body: UpdateStatusDto) {
    return this.estimateService.updateAIStatus(id, body.status);
  }

  @Patch(':id/pinned')
  @ApiOperation({
    summary: '견적 고정 토글',
    description: '견적의 고정 상태를 변경합니다.',
  })
  @ApiParam({ name: 'id', description: '견적 ID' })
  @ApiResponse({ status: 200, description: '변경 성공', type: EstimateDto })
  async togglePinned(@Param('id', ParseIntPipe) id: number, @Body() body: UpdatePinnedDto) {
    return this.estimateService.togglePinned(id, body.isPinned);
  }

  @Patch(':id/items')
  @ApiOperation({
    summary: '견적 아이템 수정',
    description: '견적의 아이템 목록을 수정합니다.',
  })
  @ApiParam({ name: 'id', description: '견적 ID' })
  @ApiResponse({ status: 200, description: '수정 성공', type: EstimateDto })
  async updateItems(@Param('id', ParseIntPipe) id: number, @Body() body: UpdateItemsDto) {
    return this.estimateService.updateItems(id, body.items);
  }

  @Patch(':id/adjustment')
  @ApiOperation({
    summary: '조정 금액 수정',
    description: '견적의 조정 금액과 사유를 수정합니다.',
  })
  @ApiParam({ name: 'id', description: '견적 ID' })
  @ApiResponse({ status: 200, description: '수정 성공', type: EstimateDto })
  async updateAdjustment(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateAdjustmentDto,
  ) {
    return this.estimateService.updateAdjustment(
      id,
      body.amount,
      body.reason,
    );
  }

  @Post(':id/send')
  @ApiOperation({
    summary: '견적 발송',
    description: '견적을 고객에게 발송합니다.',
  })
  @ApiParam({ name: 'id', description: '견적 ID' })
  @ApiResponse({
    status: 200,
    description: '발송 성공',
    type: SuccessResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '견적 없음',
    type: ErrorResponseDto,
  })
  async sendEstimate(@Param('id', ParseIntPipe) id: number) {
    return this.estimateService.sendEstimate(id);
  }

  @Delete(':id')
  @ApiOperation({
    summary: '견적 삭제',
    description: '견적을 삭제합니다.',
  })
  @ApiParam({ name: 'id', description: '견적 ID' })
  @ApiResponse({
    status: 200,
    description: '삭제 성공',
    type: SuccessResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '견적 없음',
    type: ErrorResponseDto,
  })
  async deleteEstimate(@Param('id', ParseIntPipe) id: number) {
    return this.estimateService.deleteEstimate(id);
  }
}
