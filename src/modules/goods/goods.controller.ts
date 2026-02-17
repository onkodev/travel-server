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
import { GoodsService } from './goods.service';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../common/types';
import {
  GoodsDto,
  GoodsQueryDto,
  CreateGoodsDto,
  UpdateGoodsDto,
  GOODS_CATEGORIES,
} from './dto';
import type { GoodsCategory } from './dto';
import {
  ErrorResponseDto,
  SuccessResponseDto,
  PaginationMetaDto,
} from '../../common/dto';

class GoodsListResponseDto {
  data: GoodsDto[];
  meta: PaginationMetaDto;
}

// ============ 공개 API ============
@ApiTags('굿즈 (공개)')
@SkipThrottle({ default: true, strict: true })
@Controller('goods')
export class GoodsPublicController {
  constructor(private goodsService: GoodsService) {}

  @Get()
  @Public()
  @ApiOperation({
    summary: '굿즈 목록 조회',
    description: '공개된 굿즈 목록을 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '조회 성공',
    type: GoodsListResponseDto,
  })
  async getPublicGoods(@Query() query: GoodsQueryDto) {
    return this.goodsService.getPublicGoods({
      page: query.page,
      limit: query.limit,
      category: query.category,
      featured: query.featured,
      search: query.search,
    });
  }

  @Get('featured')
  @Public()
  @ApiOperation({
    summary: '추천 굿즈 목록',
    description: '추천 굿즈 목록을 조회합니다.',
  })
  @ApiResponse({ status: 200, description: '조회 성공', type: [GoodsDto] })
  async getFeaturedGoods() {
    return this.goodsService.getFeaturedGoods();
  }

  @Get('category/:category')
  @Public()
  @ApiOperation({
    summary: '카테고리별 굿즈 조회',
    description: '특정 카테고리의 굿즈를 조회합니다.',
  })
  @ApiParam({
    name: 'category',
    description: '굿즈 카테고리',
    enum: GOODS_CATEGORIES,
  })
  @ApiResponse({ status: 200, description: '조회 성공', type: [GoodsDto] })
  async getGoodsByCategory(@Param('category') category: GoodsCategory) {
    return this.goodsService.getGoodsByCategory(category);
  }

  @Get(':id')
  @Public()
  @ApiOperation({
    summary: '굿즈 상세 조회',
    description: '특정 굿즈의 상세 정보를 조회합니다.',
  })
  @ApiParam({ name: 'id', description: '굿즈 ID' })
  @ApiResponse({ status: 200, description: '조회 성공', type: GoodsDto })
  @ApiResponse({
    status: 404,
    description: '굿즈 없음',
    type: ErrorResponseDto,
  })
  async getGoods(@Param('id', ParseIntPipe) id: number) {
    return this.goodsService.getGoodsById(id, true);
  }
}

// ============ 관리자 API ============
@ApiTags('굿즈 (관리자)')
@ApiBearerAuth('access-token')
@SkipThrottle({ default: true, strict: true })
@Controller('admin/goods')
@Roles(UserRole.ADMIN)
@UseGuards(RolesGuard)
export class GoodsAdminController {
  constructor(private goodsService: GoodsService) {}

  @Get()
  @ApiOperation({
    summary: '굿즈 목록 조회 (관리자)',
    description: '모든 굿즈 목록을 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '조회 성공',
    type: GoodsListResponseDto,
  })
  async getGoods(@Query() query: GoodsQueryDto) {
    return this.goodsService.getGoods({
      page: query.page,
      limit: query.limit,
      category: query.category,
      status: query.status,
      featured: query.featured,
      search: query.search,
    });
  }

  @Get(':id')
  @ApiOperation({
    summary: '굿즈 상세 조회 (관리자)',
    description: '특정 굿즈의 상세 정보를 조회합니다.',
  })
  @ApiParam({ name: 'id', description: '굿즈 ID' })
  @ApiResponse({ status: 200, description: '조회 성공', type: GoodsDto })
  @ApiResponse({
    status: 404,
    description: '굿즈 없음',
    type: ErrorResponseDto,
  })
  async getGoodsById(@Param('id', ParseIntPipe) id: number) {
    return this.goodsService.getGoodsById(id, false);
  }

  @Post()
  @ApiOperation({
    summary: '굿즈 생성',
    description: '새로운 굿즈를 생성합니다.',
  })
  @ApiResponse({ status: 201, description: '생성 성공', type: GoodsDto })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청',
    type: ErrorResponseDto,
  })
  async createGoods(@Body() body: CreateGoodsDto) {
    return this.goodsService.createGoods(body);
  }

  @Patch(':id')
  @ApiOperation({
    summary: '굿즈 수정',
    description: '기존 굿즈 정보를 수정합니다.',
  })
  @ApiParam({ name: 'id', description: '굿즈 ID' })
  @ApiResponse({ status: 200, description: '수정 성공', type: GoodsDto })
  @ApiResponse({
    status: 404,
    description: '굿즈 없음',
    type: ErrorResponseDto,
  })
  async updateGoods(@Param('id', ParseIntPipe) id: number, @Body() body: UpdateGoodsDto) {
    return this.goodsService.updateGoods(id, body);
  }

  @Post(':id/duplicate')
  @ApiOperation({
    summary: '굿즈 복제',
    description: '기존 굿즈를 복제하여 새로운 굿즈를 생성합니다.',
  })
  @ApiParam({ name: 'id', description: '복제할 굿즈 ID' })
  @ApiResponse({ status: 201, description: '복제 성공', type: GoodsDto })
  @ApiResponse({
    status: 404,
    description: '굿즈 없음',
    type: ErrorResponseDto,
  })
  async duplicateGoods(@Param('id', ParseIntPipe) id: number) {
    return this.goodsService.duplicateGoods(id);
  }

  @Delete(':id')
  @ApiOperation({
    summary: '굿즈 삭제',
    description: '굿즈를 삭제합니다.',
  })
  @ApiParam({ name: 'id', description: '굿즈 ID' })
  @ApiResponse({
    status: 200,
    description: '삭제 성공',
    type: SuccessResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '굿즈 없음',
    type: ErrorResponseDto,
  })
  async deleteGoods(@Param('id', ParseIntPipe) id: number) {
    return this.goodsService.deleteGoods(id);
  }
}
