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
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { ItineraryTemplateService } from './itinerary-template.service';
import { CurrentUser } from '../../common/decorators/user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces';
import {
  TemplateDto,
  TemplateQueryDto,
  CreateTemplateDto,
  UpdateTemplateDto,
} from './dto';
import {
  ErrorResponseDto,
  SuccessResponseDto,
  PaginationMetaDto,
} from '../../common/dto';

class TemplateListResponseDto {
  data: TemplateDto[];
  meta: PaginationMetaDto;
}

@ApiTags('일정 템플릿')
@ApiBearerAuth('access-token')
@SkipThrottle({ default: true, strict: true })
@Controller('itinerary-templates')
export class ItineraryTemplateController {
  constructor(private templateService: ItineraryTemplateService) {}

  @Get()
  @ApiOperation({
    summary: '템플릿 목록 조회',
    description: '저장된 일정 템플릿 목록을 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '조회 성공',
    type: TemplateListResponseDto,
  })
  async getTemplates(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: TemplateQueryDto,
  ) {
    return this.templateService.getTemplates({
      userId: user?.id,
      page: query.page,
      limit: query.limit,
      region: query.region,
      category: query.category,
    });
  }

  @Get(':id')
  @ApiOperation({
    summary: '템플릿 상세 조회',
    description: '특정 템플릿의 상세 정보를 조회합니다.',
  })
  @ApiParam({ name: 'id', description: '템플릿 ID' })
  @ApiResponse({ status: 200, description: '조회 성공', type: TemplateDto })
  @ApiResponse({
    status: 404,
    description: '템플릿 없음',
    type: ErrorResponseDto,
  })
  async getTemplate(@Param('id', ParseIntPipe) id: number) {
    return this.templateService.getTemplate(id);
  }

  @Post()
  @ApiOperation({
    summary: '템플릿 생성',
    description: '새로운 일정 템플릿을 생성합니다.',
  })
  @ApiResponse({ status: 201, description: '생성 성공', type: TemplateDto })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청',
    type: ErrorResponseDto,
  })
  async createTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateTemplateDto,
  ) {
    return this.templateService.createTemplate({
      ...body,
      userId: user?.id,
    });
  }

  @Patch(':id')
  @ApiOperation({
    summary: '템플릿 수정',
    description: '기존 템플릿을 수정합니다.',
  })
  @ApiParam({ name: 'id', description: '템플릿 ID' })
  @ApiResponse({ status: 200, description: '수정 성공', type: TemplateDto })
  @ApiResponse({
    status: 404,
    description: '템플릿 없음',
    type: ErrorResponseDto,
  })
  async updateTemplate(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateTemplateDto,
  ) {
    return this.templateService.updateTemplate(id, body);
  }

  @Post(':id/duplicate')
  @ApiOperation({
    summary: '템플릿 복제',
    description: '기존 템플릿을 복제하여 새 템플릿을 생성합니다.',
  })
  @ApiParam({ name: 'id', description: '템플릿 ID' })
  @ApiResponse({ status: 201, description: '복제 성공', type: TemplateDto })
  @ApiResponse({
    status: 404,
    description: '템플릿 없음',
    type: ErrorResponseDto,
  })
  async duplicateTemplate(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.templateService.duplicateTemplate(id, user?.id);
  }

  @Delete(':id')
  @ApiOperation({
    summary: '템플릿 삭제',
    description: '템플릿을 삭제합니다.',
  })
  @ApiParam({ name: 'id', description: '템플릿 ID' })
  @ApiResponse({
    status: 200,
    description: '삭제 성공',
    type: SuccessResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '템플릿 없음',
    type: ErrorResponseDto,
  })
  async deleteTemplate(@Param('id', ParseIntPipe) id: number) {
    return this.templateService.deleteTemplate(id);
  }
}
