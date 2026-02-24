import { Controller, Post, Body, Query, Get, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { EstimateAiService } from './services/estimate-ai.service';
import { ItemAiService } from './services/item-ai.service';
import { ItineraryAiService } from './services/itinerary-ai.service';
import { TourApiService, TourAPISearchItem } from './tour-api.service';
import { EstimateItemForAnalysis, TimelineItem } from './types';
import {
  AnalyzeEstimateResponseDto,
  TourApiSearchQueryDto,
  TourApiSearchDto,
  GenerateItemContentV2Dto,
  AnalyzeEstimateV2Dto,
  GenerateTimelineV2Dto,
} from './dto';

@ApiTags('AI')
@ApiBearerAuth('access-token')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('ai')
export class AiController {
  constructor(
    private estimateAiService: EstimateAiService,
    private itemAiService: ItemAiService,
    private itineraryAiService: ItineraryAiService,
    private tourApiService: TourApiService,
    private prisma: PrismaService,
  ) {}

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
    summary: '아이템 콘텐츠 AI 생성',
    description: 'AI가 아이템의 한글/영문 설명을 생성합니다.',
  })
  @ApiResponse({ status: 200, description: '생성 성공' })
  async generateItemContentV2(@Body() body: GenerateItemContentV2Dto) {
    const { itemId, nameKor, nameEng, itemType, existingDescription } = body;

    // 기존 한글 설명이 있으면 번역 + 빈 필드 채우기
    if (existingDescription) {
      const item = await this.prisma.item.findUnique({
        where: { id: itemId },
        select: { keyword: true },
      });
      const missingKeyword = !item?.keyword;

      const result = await this.itemAiService.translateAndFillMissing({
        description: existingDescription,
        nameKor,
        nameEng,
        missingKeyword,
      });

      if (result) {
        const updateData: Record<string, string> = {};
        if (result.descriptionEng)
          updateData.descriptionEng = result.descriptionEng;
        if (missingKeyword && result.keyword)
          updateData.keyword = result.keyword;

        await this.prisma.item.update({
          where: { id: itemId },
          data: updateData,
        });

        return {
          success: true,
          keyword: result.keyword || '',
          description: '',
          descriptionEng: result.descriptionEng || '',
        };
      }

      return {
        success: false,
        keyword: '',
        description: '',
        descriptionEng: '',
      };
    }

    const result = await this.itemAiService.generateItemContent({
      nameKor,
      nameEng,
      itemType,
    });

    if (result) {
      await this.prisma.item.update({
        where: { id: itemId },
        data: {
          keyword: result.keyword,
          description: result.description,
          descriptionEng: result.descriptionEng,
        },
      });

      return { success: true, ...result };
    }

    return {
      success: false,
      keyword: '',
      description: '',
      descriptionEng: '',
    };
  }

  @Post('analyze-estimate-v2')
  @ApiOperation({
    summary: '견적 분석',
    description: '견적 내용을 분석하여 AI 추천 사항을 생성합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '분석 성공',
    type: AnalyzeEstimateResponseDto,
  })
  async analyzeEstimateV2(@Body() body: AnalyzeEstimateV2Dto) {
    const { estimateId, requestContent, items } = body;

    const result = await this.estimateAiService.analyzeEstimate({
      requestContent: requestContent || null,
      items: items as EstimateItemForAnalysis[],
    });

    if (result) {
      // DB 업데이트
      await this.prisma.estimate.update({
        where: { id: estimateId },
        data: {
          regions: result.regions,
          interests: result.interests,
          keywords: result.keywords,
          tourType: result.tourType,
          travelerType: result.travelerType,
          priceRange: result.priceRange,
          specialNeeds: result.specialNeeds,
        },
      });

      return { success: true, ...result };
    }

    return {
      success: false,
      regions: [],
      interests: [],
      keywords: [],
      tourType: null,
      travelerType: null,
      priceRange: null,
      specialNeeds: [],
    };
  }

  @Post('generate-timeline-v2')
  @ApiOperation({
    summary: '타임라인 생성',
    description: 'AI가 단일 일차의 상세 일정을 생성합니다.',
  })
  @ApiResponse({ status: 200, description: '생성 성공' })
  async generateTimelineV2(@Body() body: GenerateTimelineV2Dto) {
    return this.itineraryAiService.generateDayTimeline({
      dayNumber: body.dayNumber,
      items: body.items as TimelineItem[],
    });
  }
}
