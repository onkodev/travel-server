import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  Body,
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
import { UserService } from './user.service';
import { CurrentUser } from '../../common/decorators/user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../common/types';
import {
  UserDetailDto,
  UserListItemDto,
  UserStatsDto,
  UserListQueryDto,
  UpdateUserStatusDto,
  UpdateUserRoleDto,
} from './dto';
import { ErrorResponseDto, PaginationMetaDto } from '../../common/dto';

class UserListResponseDto {
  data: UserListItemDto[];
  meta: PaginationMetaDto;
}

@ApiTags('사용자')
@ApiBearerAuth('access-token')
@Controller('users')
export class UserController {
  constructor(private userService: UserService) {}

  @Get()
  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @ApiOperation({
    summary: '사용자 목록 조회',
    description: '관리자용 사용자 목록을 페이지네이션과 함께 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '조회 성공',
    type: UserListResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: '인증 필요',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: '권한 없음',
    type: ErrorResponseDto,
  })
  async getUserList(@Query() query: UserListQueryDto) {
    return this.userService.getUserList({
      page: query.page,
      limit: query.limit,
      keyword: query.keyword,
      isActive: query.isActive,
      sortColumn: query.sortColumn,
      sortDirection: query.sortDirection,
    });
  }

  @Get('stats')
  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @ApiOperation({
    summary: '사용자 통계 조회',
    description:
      '전체 사용자 통계 (총 수, 활성/비활성, 역할별 수)를 조회합니다.',
  })
  @ApiResponse({ status: 200, description: '조회 성공', type: UserStatsDto })
  @ApiResponse({
    status: 401,
    description: '인증 필요',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: '권한 없음',
    type: ErrorResponseDto,
  })
  async getUserStats() {
    return this.userService.getUserStats();
  }

  @Get('me/estimates')
  @SkipThrottle({ default: true, strict: true })
  @ApiOperation({
    summary: '내 견적 목록',
    description: '현재 로그인한 사용자의 AI 견적 목록을 조회합니다.',
  })
  @ApiResponse({ status: 200, description: '조회 성공' })
  @ApiResponse({
    status: 401,
    description: '인증 필요',
    type: ErrorResponseDto,
  })
  async getMyEstimates(@CurrentUser('id') userId: string) {
    return this.userService.getMyEstimates(userId);
  }

  @Get(':id/estimates')
  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @ApiOperation({
    summary: '사용자 견적 목록',
    description: '특정 사용자의 견적 목록을 조회합니다.',
  })
  @ApiParam({ name: 'id', description: '사용자 ID (Supabase UUID)' })
  @ApiResponse({ status: 200, description: '조회 성공' })
  async getUserEstimates(@Param('id') id: string) {
    return this.userService.getUserEstimates(id);
  }

  @Get(':id/chatbot-flows')
  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @ApiOperation({
    summary: '사용자 챗봇 상담 목록',
    description: '특정 사용자의 챗봇 상담 목록을 조회합니다.',
  })
  @ApiParam({ name: 'id', description: '사용자 ID (Supabase UUID)' })
  @ApiResponse({ status: 200, description: '조회 성공' })
  async getUserChatbotFlows(@Param('id') id: string) {
    return this.userService.getUserChatbotFlows(id);
  }

  @Get(':id/payments')
  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @ApiOperation({
    summary: '사용자 결제 목록',
    description: '특정 사용자의 결제 목록을 조회합니다.',
  })
  @ApiParam({ name: 'id', description: '사용자 ID (Supabase UUID)' })
  @ApiResponse({ status: 200, description: '조회 성공' })
  async getUserPayments(@Param('id') id: string) {
    return this.userService.getUserPayments(id);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @ApiOperation({
    summary: '사용자 상세 조회',
    description: '특정 사용자의 상세 정보를 조회합니다.',
  })
  @ApiParam({ name: 'id', description: '사용자 ID' })
  @ApiResponse({ status: 200, description: '조회 성공', type: UserDetailDto })
  @ApiResponse({
    status: 403,
    description: '권한 없음',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '사용자 없음',
    type: ErrorResponseDto,
  })
  async getUserById(@Param('id') id: string) {
    return this.userService.getUserById(id);
  }

  @Patch(':id/status')
  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @ApiOperation({
    summary: '사용자 상태 변경',
    description: '사용자의 활성화/비활성화 상태를 변경합니다.',
  })
  @ApiParam({ name: 'id', description: '사용자 ID' })
  @ApiResponse({ status: 200, description: '변경 성공', type: UserDetailDto })
  @ApiResponse({
    status: 403,
    description: '권한 없음',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '사용자 없음',
    type: ErrorResponseDto,
  })
  async updateUserStatus(
    @Param('id') id: string,
    @Body() body: UpdateUserStatusDto,
  ) {
    return this.userService.updateUserStatus(id, body.isActive);
  }

  @Patch(':id/role')
  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @ApiOperation({
    summary: '사용자 역할 변경',
    description: '사용자의 역할 (user/admin/agent)을 변경합니다.',
  })
  @ApiParam({ name: 'id', description: '사용자 ID' })
  @ApiResponse({ status: 200, description: '변경 성공', type: UserDetailDto })
  @ApiResponse({
    status: 403,
    description: '권한 없음',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '사용자 없음',
    type: ErrorResponseDto,
  })
  async updateUserRole(
    @Param('id') id: string,
    @Body() body: UpdateUserRoleDto,
  ) {
    return this.userService.updateUserRole(id, body.role);
  }
}
