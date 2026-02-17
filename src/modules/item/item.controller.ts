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
import { ItemService } from './item.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../common/types';
import { ItemDto, ItemQueryDto, CreateItemDto, UpdateItemDto } from './dto';
import {
  ErrorResponseDto,
  SuccessResponseDto,
  PaginationMetaDto,
} from '../../common/dto';

class ItemListResponseDto {
  data: ItemDto[];
  meta: PaginationMetaDto;
}

@ApiTags('아이템')
@ApiBearerAuth('access-token')
@SkipThrottle({ default: true, strict: true })
@Controller('items')
@Roles(UserRole.ADMIN, UserRole.AGENT)
@UseGuards(RolesGuard)
export class ItemController {
  constructor(private itemService: ItemService) {}

  @Get()
  @ApiOperation({
    summary: '아이템 목록 조회',
    description: '필터와 페이지네이션을 적용하여 아이템 목록을 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '조회 성공',
    type: ItemListResponseDto,
  })
  async getItems(@Query() query: ItemQueryDto) {
    return this.itemService.getItems({
      page: query.page,
      limit: query.limit,
      type: query.type,
      region: query.region,
      search: query.search,
    });
  }

  @Post('batch')
  @ApiOperation({
    summary: '아이템 배치 조회',
    description: '여러 아이템을 ID 목록으로 한번에 조회합니다.',
  })
  @ApiResponse({ status: 200, description: '조회 성공', type: [ItemDto] })
  async getItemsByIds(@Body() body: { ids: number[] }) {
    return this.itemService.getItemsByIds(body.ids);
  }

  @Get('type/:type')
  @ApiOperation({
    summary: '타입별 아이템 조회',
    description: '특정 타입의 모든 아이템을 조회합니다.',
  })
  @ApiParam({
    name: 'type',
    description: '아이템 타입 (place, accommodation, transportation, contents)',
  })
  @ApiResponse({ status: 200, description: '조회 성공', type: [ItemDto] })
  async getItemsByType(@Param('type') type: string) {
    return this.itemService.getItemsByType(type);
  }

  @Get('region/:region')
  @ApiOperation({
    summary: '지역별 아이템 조회',
    description: '특정 지역의 모든 아이템을 조회합니다.',
  })
  @ApiParam({ name: 'region', description: '지역명' })
  @ApiResponse({ status: 200, description: '조회 성공', type: [ItemDto] })
  async getItemsByRegion(@Param('region') region: string) {
    return this.itemService.getItemsByRegion(region);
  }

  @Get(':id')
  @ApiOperation({
    summary: '아이템 상세 조회',
    description: '특정 아이템의 상세 정보를 조회합니다.',
  })
  @ApiParam({ name: 'id', description: '아이템 ID' })
  @ApiResponse({ status: 200, description: '조회 성공', type: ItemDto })
  @ApiResponse({
    status: 404,
    description: '아이템 없음',
    type: ErrorResponseDto,
  })
  async getItem(@Param('id', ParseIntPipe) id: number) {
    return this.itemService.getItem(id);
  }

  @Post()
  @ApiOperation({
    summary: '아이템 생성',
    description: '새로운 아이템 (여행지/숙소/교통 등)을 생성합니다.',
  })
  @ApiResponse({ status: 201, description: '생성 성공', type: ItemDto })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청',
    type: ErrorResponseDto,
  })
  async createItem(@Body() body: CreateItemDto) {
    return this.itemService.createItem(body);
  }

  @Patch(':id')
  @ApiOperation({
    summary: '아이템 수정',
    description: '기존 아이템 정보를 수정합니다.',
  })
  @ApiParam({ name: 'id', description: '아이템 ID' })
  @ApiResponse({ status: 200, description: '수정 성공', type: ItemDto })
  @ApiResponse({
    status: 404,
    description: '아이템 없음',
    type: ErrorResponseDto,
  })
  async updateItem(@Param('id', ParseIntPipe) id: number, @Body() body: UpdateItemDto) {
    return this.itemService.updateItem(id, body);
  }

  @Post(':id/duplicate')
  @ApiOperation({
    summary: '아이템 복제',
    description: '기존 아이템을 복제하여 새로운 아이템을 생성합니다.',
  })
  @ApiParam({ name: 'id', description: '복제할 아이템 ID' })
  @ApiResponse({ status: 201, description: '복제 성공', type: ItemDto })
  @ApiResponse({
    status: 404,
    description: '아이템 없음',
    type: ErrorResponseDto,
  })
  async duplicateItem(@Param('id', ParseIntPipe) id: number) {
    return this.itemService.duplicateItem(id);
  }

  @Delete(':id')
  @ApiOperation({
    summary: '아이템 삭제',
    description: '아이템을 삭제합니다.',
  })
  @ApiParam({ name: 'id', description: '아이템 ID' })
  @ApiResponse({
    status: 200,
    description: '삭제 성공',
    type: SuccessResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '아이템 없음',
    type: ErrorResponseDto,
  })
  async deleteItem(@Param('id', ParseIntPipe) id: number) {
    return this.itemService.deleteItem(id);
  }
}
