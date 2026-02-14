import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { AuthGuard } from '../../common/guards/auth.guard';
import { SuggestedPlaceService } from './suggested-place.service';
import {
  SuggestedPlaceQueryDto,
  SuggestedPlaceUpdateStatusDto,
  SuggestedPlaceBulkStatusDto,
  AddToItemDto,
  ApproveMatchDto,
  AddFromTourApiDto,
  EnhancedStatsQueryDto,
} from './dto';

@ApiTags('추천 장소')
@Controller('suggested-places')
@ApiBearerAuth('access-token')
@UseGuards(AuthGuard)
@SkipThrottle({ default: true, strict: true })
export class SuggestedPlaceController {
  constructor(private service: SuggestedPlaceService) {}

  @Get()
  @ApiOperation({ summary: '추천 장소 목록 조회' })
  @ApiResponse({ status: 200, description: '조회 성공' })
  async getList(@Query() query: SuggestedPlaceQueryDto) {
    return this.service.getList({
      page: query.page,
      limit: query.limit,
      status: query.status,
      region: query.region,
      search: query.search,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
    });
  }

  @Get('stats')
  @ApiOperation({ summary: '추천 장소 통계' })
  @ApiResponse({ status: 200, description: '조회 성공' })
  async getStats() {
    return this.service.getStats();
  }

  @Get('enhanced-stats')
  @ApiOperation({ summary: '확장 통계 (차트 데이터)' })
  @ApiResponse({ status: 200, description: '조회 성공' })
  async getEnhancedStats(@Query() query: EnhancedStatsQueryDto) {
    return this.service.getEnhancedStats(query.days);
  }

  @Get(':id/tour-api-search')
  @ApiOperation({ summary: 'Tour API 검색' })
  @ApiParam({ name: 'id', description: '추천 장소 ID' })
  @ApiResponse({ status: 200, description: '검색 완료' })
  async tourApiSearch(@Param('id', ParseIntPipe) id: number) {
    return this.service.searchTourApiForPlace(id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: '추천 장소 상태 변경' })
  @ApiParam({ name: 'id', description: '추천 장소 ID' })
  @ApiResponse({ status: 200, description: '변경 성공' })
  async updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SuggestedPlaceUpdateStatusDto,
  ) {
    return this.service.updateStatus(id, dto);
  }

  @Post('bulk-status')
  @ApiOperation({ summary: '일괄 상태 변경' })
  @ApiResponse({ status: 200, description: '변경 성공' })
  async bulkUpdateStatus(@Body() dto: SuggestedPlaceBulkStatusDto) {
    return this.service.bulkUpdateStatus(dto.ids, dto.status);
  }

  @Post('scan')
  @ApiOperation({ summary: '기존 견적에서 TBD 추출' })
  @ApiResponse({ status: 200, description: '스캔 완료' })
  async scanEstimates() {
    return this.service.scanEstimates();
  }

  @Post('compute-matches')
  @ApiOperation({ summary: '전체 퍼지 매칭 일괄 계산' })
  @ApiResponse({ status: 200, description: '계산 완료' })
  async computeMatches() {
    return this.service.scanAndComputeAllMatches();
  }

  @Post(':id/approve-match')
  @ApiOperation({ summary: '매칭 승인' })
  @ApiParam({ name: 'id', description: '추천 장소 ID' })
  @ApiResponse({ status: 200, description: '승인 완료' })
  async approveMatch(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ApproveMatchDto,
  ) {
    return this.service.approveMatch(id, dto.itemId);
  }

  @Post(':id/add-to-items')
  @ApiOperation({ summary: 'Item DB에 추가' })
  @ApiParam({ name: 'id', description: '추천 장소 ID' })
  @ApiResponse({ status: 201, description: '추가 성공' })
  async addToItems(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddToItemDto,
  ) {
    return this.service.addToItems(id, dto);
  }

  @Post(':id/add-from-tour-api')
  @ApiOperation({ summary: 'Tour API → Item 추가 + 연결' })
  @ApiParam({ name: 'id', description: '추천 장소 ID' })
  @ApiResponse({ status: 201, description: '추가 성공' })
  async addFromTourApi(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddFromTourApiDto,
  ) {
    return this.service.addFromTourApi(id, dto.contentId, dto.itemData);
  }

  @Delete(':id')
  @ApiOperation({ summary: '추천 장소 삭제' })
  @ApiParam({ name: 'id', description: '추천 장소 ID' })
  @ApiResponse({ status: 200, description: '삭제 성공' })
  async delete(@Param('id', ParseIntPipe) id: number) {
    return this.service.delete(id);
  }
}
