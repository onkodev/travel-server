import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiBearerAuth,
  ApiBody,
  ApiParam,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/user.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../common/types';
import { ContactService } from './contact.service';
import {
  CreateContactDto,
  ContactDto,
  ContactQueryDto,
  ContactListDto,
  ReplyContactDto,
  UpdateContactStatusDto,
  ContactSuccessDto,
} from './dto/contact.dto';
import { ErrorResponseDto } from '../../common/dto';

@ApiTags('문의')
@Controller('contact')
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  // ==================== 공개 API ====================

  @Post()
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '문의 제출',
    description: '일반 사용자가 문의를 제출합니다. 인증 없이 접근 가능합니다.',
  })
  @ApiBody({ type: CreateContactDto })
  @ApiResponse({
    status: 200,
    description: '문의 제출 성공',
    type: ContactSuccessDto,
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청 (유효성 검사 실패)',
    type: ErrorResponseDto,
  })
  async createContact(
    @Body() dto: CreateContactDto,
  ): Promise<ContactSuccessDto> {
    await this.contactService.createContact(dto);
    return { success: true };
  }

  // ==================== 관리자 API ====================

  @Get()
  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: '문의 목록 조회',
    description: '관리자가 문의 목록을 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '문의 목록 조회 성공',
    type: ContactListDto,
  })
  @ApiUnauthorizedResponse({
    description: '인증 실패',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: '권한 없음 (관리자만 접근 가능)',
    type: ErrorResponseDto,
  })
  async getContacts(@Query() query: ContactQueryDto): Promise<ContactListDto> {
    return this.contactService.getContacts(query);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: '문의 상세 조회',
    description: '관리자가 특정 문의의 상세 정보를 조회합니다.',
  })
  @ApiParam({
    name: 'id',
    description: '문의 ID',
    type: Number,
    example: 1,
  })
  @ApiResponse({
    status: 200,
    description: '문의 상세 조회 성공',
    type: ContactDto,
  })
  @ApiUnauthorizedResponse({
    description: '인증 실패',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: '문의를 찾을 수 없음',
    type: ErrorResponseDto,
  })
  async getContact(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ContactDto | null> {
    return this.contactService.getContact(id);
  }

  @Patch(':id/reply')
  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: '문의 답변 작성',
    description:
      '관리자가 문의에 답변을 작성합니다. 답변 작성 시 이메일이 발송됩니다.',
  })
  @ApiParam({
    name: 'id',
    description: '문의 ID',
    type: Number,
    example: 1,
  })
  @ApiBody({ type: ReplyContactDto })
  @ApiResponse({
    status: 200,
    description: '답변 작성 성공',
    type: ContactSuccessDto,
  })
  @ApiUnauthorizedResponse({
    description: '인증 실패',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: '문의를 찾을 수 없음',
    type: ErrorResponseDto,
  })
  async replyToContact(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReplyContactDto,
  ): Promise<ContactSuccessDto> {
    await this.contactService.replyToContact(id, dto.reply, userId);
    return { success: true };
  }

  @Patch(':id/status')
  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: '문의 상태 변경',
    description: '관리자가 문의의 상태를 변경합니다.',
  })
  @ApiParam({
    name: 'id',
    description: '문의 ID',
    type: Number,
    example: 1,
  })
  @ApiBody({ type: UpdateContactStatusDto })
  @ApiResponse({
    status: 200,
    description: '상태 변경 성공',
    type: ContactSuccessDto,
  })
  @ApiUnauthorizedResponse({
    description: '인증 실패',
    type: ErrorResponseDto,
  })
  async updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateContactStatusDto,
  ): Promise<ContactSuccessDto> {
    await this.contactService.updateStatus(id, dto.status);
    return { success: true };
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: '문의 삭제',
    description: '관리자가 문의를 삭제합니다.',
  })
  @ApiParam({
    name: 'id',
    description: '문의 ID',
    type: Number,
    example: 1,
  })
  @ApiResponse({
    status: 200,
    description: '문의 삭제 성공',
    type: ContactSuccessDto,
  })
  @ApiUnauthorizedResponse({
    description: '인증 실패',
    type: ErrorResponseDto,
  })
  async deleteContact(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ContactSuccessDto> {
    await this.contactService.deleteContact(id);
    return { success: true };
  }
}
