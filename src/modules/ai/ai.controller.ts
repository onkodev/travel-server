import { Controller, Post, Body, Query, Get } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import {
  GeminiService,
  EstimateItemForAnalysis,
  TimelineItem,
} from './gemini.service';
import { TourApiService, TourAPISearchItem } from './tour-api.service';
import {
  AnalyzeEstimateDto,
  AnalyzeEstimateResponseDto,
  GenerateTimelineDto,
  GenerateItemContentDto,
  TourApiSearchQueryDto,
  TourApiSearchDto,
  GenerateItemContentV2Dto,
  AnalyzeEstimateV2Dto,
  GenerateTimelineV2Dto,
} from './dto';

@ApiTags('AI')
@ApiBearerAuth('access-token')
@Controller('ai')
export class AiController {
  constructor(
    private geminiService: GeminiService,
    private tourApiService: TourApiService,
  ) {}

  @Post('analyze-estimate')
  @ApiOperation({
    summary: '견적 요청 분석',
    description: 'AI가 고객의 견적 요청 내용을 분석하여 정보를 추출합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '분석 성공',
    type: AnalyzeEstimateResponseDto,
  })
  async analyzeEstimate(@Body() body: AnalyzeEstimateDto) {
    return this.geminiService.analyzeEstimateRequest(body.content);
  }

  @Post('generate-timeline')
  @ApiOperation({
    summary: '여행 일정 생성',
    description: 'AI가 여행 조건에 맞는 일정을 자동 생성합니다.',
  })
  @ApiResponse({ status: 200, description: '생성 성공' })
  async generateTimeline(@Body() body: GenerateTimelineDto) {
    return this.geminiService.generateTimeline(body);
  }

  @Post('generate-item-content')
  @ApiOperation({
    summary: '아이템 설명 생성',
    description: 'AI가 여행지/숙소 등의 설명 콘텐츠를 생성합니다.',
  })
  @ApiResponse({ status: 200, description: '생성 성공' })
  async generateItemContent(@Body() body: GenerateItemContentDto) {
    return this.geminiService.generateItemContent(body);
  }

  @Get('tour-api/search')
  @ApiOperation({
    summary: '한국 관광 API 검색',
    description: '한국관광공사 API를 통해 관광지 정보를 검색합니다.',
  })
  @ApiResponse({ status: 200, description: '검색 성공' })
  async searchTourApi(@Query() query: TourApiSearchQueryDto) {
    return this.tourApiService.search({
      keyword: query.keyword,
      areaCode: query.areaCode,
      contentTypeId: query.contentTypeId,
      pageNo: query.pageNo || 1,
    });
  }

  @Post('tour-api-search')
  @ApiOperation({
    summary: 'Tour API 검색 (DB 존재 여부 확인)',
    description: '관광 API 검색 및 아이템 추가를 처리합니다.',
  })
  @ApiResponse({ status: 200, description: '처리 성공' })
  async searchTourAPIWithExistence(@Body() body: TourApiSearchDto) {
    if (body.action === 'search') {
      return this.tourApiService.searchWithExistence(
        body.keyword || '',
        body.contentTypeId,
      );
    } else if (body.action === 'add' && body.contentId && body.itemData) {
      return this.tourApiService.addItem(
        body.contentId,
        body.itemData as TourAPISearchItem,
      );
    }
    return { error: 'Invalid action' };
  }

  @Post('generate-item-content-v2')
  @ApiOperation({
    summary: '아이템 콘텐츠 AI 생성 V2',
    description: 'AI가 아이템의 한글/영문 설명을 생성합니다.',
  })
  @ApiResponse({ status: 200, description: '생성 성공' })
  async generateItemContentV2(@Body() body: GenerateItemContentV2Dto) {
    return this.geminiService.generateItemContentV2(body);
  }

  @Post('analyze-estimate-v2')
  @ApiOperation({
    summary: '견적 분석 V2',
    description: '견적 내용을 분석하여 AI 추천 사항을 생성합니다.',
  })
  @ApiResponse({ status: 200, description: '분석 성공' })
  async analyzeEstimateV2(@Body() body: AnalyzeEstimateV2Dto) {
    return this.geminiService.analyzeEstimateV2({
      estimateId: body.estimateId,
      requestContent: body.requestContent || null,
      items: body.items as EstimateItemForAnalysis[],
    });
  }

  @Post('generate-timeline-v2')
  @ApiOperation({
    summary: '타임라인 생성 V2',
    description: 'AI가 단일 일차의 상세 일정을 생성합니다.',
  })
  @ApiResponse({ status: 200, description: '생성 성공' })
  async generateTimelineV2(@Body() body: GenerateTimelineV2Dto) {
    return this.geminiService.generateTimelineV2({
      dayNumber: body.dayNumber,
      date: body.date || null,
      items: body.items as TimelineItem[],
    });
  }
}
