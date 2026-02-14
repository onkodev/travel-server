import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/types';
import { AiPromptService } from './ai-prompt.service';
import { UpdateAiPromptDto, AiPromptQueryDto, UpdateFaqChatConfigDto } from './dto';

@ApiTags('AI Prompts')
@ApiBearerAuth('access-token')
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN)
@SkipThrottle({ default: true, strict: true })
@Controller('admin/ai-prompts')
export class AiPromptController {
  constructor(private aiPromptService: AiPromptService) {}

  @Get()
  @ApiOperation({ summary: 'AI 프롬프트 목록' })
  async getAll(@Query() query: AiPromptQueryDto) {
    return this.aiPromptService.getAllPrompts(query.category);
  }

  @Get('faq-chat-config')
  @ApiOperation({ summary: 'FAQ 챗봇 설정 조회' })
  async getFaqChatConfig() {
    return this.aiPromptService.getFaqChatConfig();
  }

  @Patch('faq-chat-config')
  @ApiOperation({ summary: 'FAQ 챗봇 설정 수정' })
  async updateFaqChatConfig(@Body() dto: UpdateFaqChatConfigDto) {
    return this.aiPromptService.updateFaqChatConfig(dto);
  }

  @Get(':key')
  @ApiOperation({ summary: 'AI 프롬프트 상세' })
  async getOne(@Param('key') key: string) {
    return this.aiPromptService.getPromptDetail(key);
  }

  @Patch(':key')
  @ApiOperation({ summary: 'AI 프롬프트 수정' })
  async update(
    @Param('key') key: string,
    @Body() dto: UpdateAiPromptDto,
  ) {
    return this.aiPromptService.updatePrompt(key, dto);
  }

  @Post(':key/reset')
  @ApiOperation({ summary: 'AI 프롬프트 기본값 복원' })
  async reset(@Param('key') key: string) {
    return this.aiPromptService.resetPrompt(key);
  }
}
