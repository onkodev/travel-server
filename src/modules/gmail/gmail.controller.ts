import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/types';
import { GmailSyncService } from './gmail-sync.service';
import { BatchSyncDto, ThreadQueryDto } from './dto';

@ApiTags('Gmail')
@ApiBearerAuth('access-token')
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN)
@SkipThrottle({ default: true, strict: true })
@Controller('gmail/admin')
export class GmailController {
  constructor(private gmailSyncService: GmailSyncService) {}

  @Get('status')
  @ApiOperation({ summary: 'Gmail 동기화 상태 조회' })
  async getSyncStatus() {
    return this.gmailSyncService.getSyncStatus();
  }

  @Post('refresh-count')
  @ApiOperation({ summary: '전체 이메일 수 갱신' })
  async refreshMessageCount() {
    return this.gmailSyncService.refreshMessageCount();
  }

  @Post('reset')
  @ApiOperation({ summary: '동기화 상태 초기화 (pageToken, 에러 등)' })
  async resetSync() {
    return this.gmailSyncService.resetSync();
  }

  @Post('batch')
  @ApiOperation({ summary: 'Gmail 일괄 가져오기 (백그라운드 실행)' })
  async batchSync(@Body() body: BatchSyncDto) {
    return this.gmailSyncService.startBatchSync({
      maxResults: body.maxResults,
      query: body.query,
    });
  }

  @Get('threads')
  @ApiOperation({ summary: '처리된 이메일 스레드 목록' })
  async getThreads(@Query() query: ThreadQueryDto) {
    return this.gmailSyncService.getThreads({
      page: query.page,
      limit: query.limit,
      processed: query.processed,
      search: query.search,
    });
  }

  @Get('threads/:gmailThreadId')
  @ApiOperation({ summary: 'Gmail 스레드 ID로 이메일 스레드 조회' })
  async getThreadByGmailId(@Param('gmailThreadId') gmailThreadId: string) {
    return this.gmailSyncService.getThreadByGmailId(gmailThreadId);
  }
}
