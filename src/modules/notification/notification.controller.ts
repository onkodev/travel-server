import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { NotificationService } from './notification.service';
import {
  NotificationListDto,
  NotificationQueryDto,
  MarkAsReadDto,
  UnreadCountDto,
  DeleteNotificationDto,
  DeleteNotificationsDto,
  NotificationSuccessDto,
} from './dto/notification.dto';
import { SkipThrottle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/user.decorator';
import { ErrorResponseDto } from '../../common/dto';

@ApiTags('알림')
@ApiBearerAuth('access-token')
@SkipThrottle()
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  @ApiOperation({
    summary: '알림 목록 조회',
    description: '현재 사용자의 알림 목록을 조회합니다. 관리자만 접근 가능합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '알림 목록 조회 성공',
    type: NotificationListDto,
  })
  @ApiUnauthorizedResponse({
    description: '인증 실패',
    type: ErrorResponseDto,
  })
  async getNotifications(
    @CurrentUser('role') role: string,
    @Query() query: NotificationQueryDto,
  ): Promise<NotificationListDto> {
    // 관리자만 알림 조회 가능
    if (role !== 'admin') {
      return { notifications: [], total: 0, unreadCount: 0 };
    }

    // 기본 관리자 ID (실제 환경에서는 사용자 ID 기반으로 조회)
    const agentId = 1;
    return this.notificationService.getNotifications(agentId, query);
  }

  @Get('unread-count')
  @ApiOperation({
    summary: '읽지 않은 알림 수 조회',
    description: '읽지 않은 알림의 개수를 반환합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '읽지 않은 알림 수 조회 성공',
    type: UnreadCountDto,
  })
  @ApiUnauthorizedResponse({
    description: '인증 실패',
    type: ErrorResponseDto,
  })
  async getUnreadCount(
    @CurrentUser('role') role: string,
  ): Promise<UnreadCountDto> {
    if (role !== 'admin') {
      return { count: 0 };
    }

    const agentId = 1;
    const count = await this.notificationService.getUnreadCount(agentId);
    return { count };
  }

  @Post('mark-as-read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '선택한 알림 읽음 처리',
    description: '지정한 알림 ID들을 읽음 상태로 변경합니다.',
  })
  @ApiBody({ type: MarkAsReadDto })
  @ApiResponse({
    status: 200,
    description: '알림 읽음 처리 성공',
    type: NotificationSuccessDto,
  })
  @ApiUnauthorizedResponse({
    description: '인증 실패',
    type: ErrorResponseDto,
  })
  async markAsRead(
    @CurrentUser('role') role: string,
    @Body() dto: MarkAsReadDto,
  ): Promise<NotificationSuccessDto> {
    if (role !== 'admin') {
      return { success: false };
    }

    const agentId = 1;
    await this.notificationService.markAsRead(agentId, dto.notificationIds);
    return { success: true };
  }

  @Post('mark-all-as-read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '모든 알림 읽음 처리',
    description: '현재 사용자의 모든 알림을 읽음 상태로 변경합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '모든 알림 읽음 처리 성공',
    type: NotificationSuccessDto,
  })
  @ApiUnauthorizedResponse({
    description: '인증 실패',
    type: ErrorResponseDto,
  })
  async markAllAsRead(
    @CurrentUser('role') role: string,
  ): Promise<NotificationSuccessDto> {
    if (role !== 'admin') {
      return { success: false };
    }

    const agentId = 1;
    await this.notificationService.markAllAsRead(agentId);
    return { success: true };
  }

  @Post('delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '알림 삭제',
    description: '지정한 알림을 삭제합니다.',
  })
  @ApiBody({ type: DeleteNotificationDto })
  @ApiResponse({
    status: 200,
    description: '알림 삭제 성공',
    type: NotificationSuccessDto,
  })
  @ApiUnauthorizedResponse({
    description: '인증 실패',
    type: ErrorResponseDto,
  })
  async deleteNotification(
    @CurrentUser('role') role: string,
    @Body() dto: DeleteNotificationDto,
  ): Promise<NotificationSuccessDto> {
    if (role !== 'admin') {
      return { success: false };
    }

    const agentId = 1;
    await this.notificationService.deleteNotification(agentId, dto.notificationId);
    return { success: true };
  }

  @Post('delete-batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '알림 대량 삭제',
    description: '여러 알림을 한 번에 삭제합니다.',
  })
  @ApiBody({ type: DeleteNotificationsDto })
  @ApiResponse({
    status: 200,
    description: '알림 대량 삭제 성공',
    type: NotificationSuccessDto,
  })
  @ApiUnauthorizedResponse({
    description: '인증 실패',
    type: ErrorResponseDto,
  })
  async deleteNotifications(
    @CurrentUser('role') role: string,
    @Body() dto: DeleteNotificationsDto,
  ): Promise<NotificationSuccessDto> {
    if (role !== 'admin') {
      return { success: false };
    }

    const agentId = 1;
    await this.notificationService.deleteNotifications(agentId, dto.notificationIds);
    return { success: true };
  }
}
