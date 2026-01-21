import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { DashboardService } from './dashboard.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { DashboardDataDto } from './dto';
import { ErrorResponseDto } from '../../common/dto';

@ApiTags('대시보드')
@ApiBearerAuth('access-token')
@SkipThrottle()
@Controller('dashboard')
@Roles('admin')
@UseGuards(RolesGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  @ApiOperation({
    summary: '대시보드 데이터 조회',
    description: '관리자 대시보드에 표시할 전체 통계 데이터를 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '조회 성공',
    type: DashboardDataDto,
  })
  @ApiResponse({
    status: 401,
    description: '인증 필요',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: '권한 없음 (Admin만 접근 가능)',
    type: ErrorResponseDto,
  })
  async getDashboardData() {
    return this.dashboardService.getDashboardData();
  }
}
