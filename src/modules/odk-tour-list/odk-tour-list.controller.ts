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
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { OdkTourListService } from './odk-tour-list.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../common/types';
import {
  OdkTourListDto,
  OdkTourListQueryDto,
  CreateOdkTourListDto,
  UpdateOdkTourListDto,
} from './dto';
import {
  ErrorResponseDto,
  SuccessResponseDto,
  PaginationMetaDto,
} from '../../common/dto';

class OdkTourListResponseDto {
  data: OdkTourListDto[];
  meta: PaginationMetaDto;
}

@ApiTags('ODK 투어 목록 (관리자)')
@ApiBearerAuth('access-token')
@SkipThrottle({ default: true, strict: true })
@Controller('admin/odk-tour-list')
@Roles(UserRole.ADMIN)
@UseGuards(RolesGuard)
export class OdkTourListController {
  constructor(private odkTourListService: OdkTourListService) {}

  @Get()
  @ApiOperation({ summary: 'ODK 투어 목록 조회' })
  @ApiResponse({ status: 200, type: OdkTourListResponseDto })
  async getList(@Query() query: OdkTourListQueryDto) {
    return this.odkTourListService.getList({
      page: query.page,
      limit: query.limit,
      search: query.search,
      region: query.region,
      isActive: query.isActive,
    });
  }

  @Get('stats')
  @ApiOperation({ summary: 'ODK 투어 통계' })
  @ApiResponse({ status: 200 })
  async getStats() {
    return this.odkTourListService.getStats();
  }

  @Get(':id')
  @ApiOperation({ summary: 'ODK 투어 상세 조회' })
  @ApiParam({ name: 'id', description: '투어 ID' })
  @ApiResponse({ status: 200, type: OdkTourListDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto })
  async getById(@Param('id') id: string) {
    return this.odkTourListService.getById(parseInt(id));
  }

  @Post()
  @ApiOperation({ summary: 'ODK 투어 생성' })
  @ApiResponse({ status: 201, type: OdkTourListDto })
  @ApiResponse({ status: 400, type: ErrorResponseDto })
  async create(@Body() body: CreateOdkTourListDto) {
    return this.odkTourListService.create(body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'ODK 투어 수정' })
  @ApiParam({ name: 'id', description: '투어 ID' })
  @ApiResponse({ status: 200, type: OdkTourListDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto })
  async update(@Param('id') id: string, @Body() body: UpdateOdkTourListDto) {
    return this.odkTourListService.update(parseInt(id), body);
  }

  @Patch(':id/toggle-active')
  @ApiOperation({ summary: 'ODK 투어 활성/비활성 토글' })
  @ApiParam({ name: 'id', description: '투어 ID' })
  @ApiResponse({ status: 200, type: OdkTourListDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto })
  async toggleActive(@Param('id') id: string) {
    return this.odkTourListService.toggleActive(parseInt(id));
  }

  @Delete(':id')
  @ApiOperation({ summary: 'ODK 투어 삭제' })
  @ApiParam({ name: 'id', description: '투어 ID' })
  @ApiResponse({ status: 200, type: SuccessResponseDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto })
  async delete(@Param('id') id: string) {
    return this.odkTourListService.delete(parseInt(id));
  }
}
