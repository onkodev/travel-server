import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../prisma/prisma.service';

@ApiTags('헬스체크')
@Controller('health')
export class HealthController {
  constructor(private prisma: PrismaService) {}

  @Get()
  @Public()
  @SkipThrottle({ default: true, strict: true })
  @ApiOperation({
    summary: '헬스 체크',
    description: '서버 및 데이터베이스 상태를 확인합니다.',
  })
  @ApiResponse({ status: 200, description: '서버 정상' })
  async check() {
    const timestamp = new Date().toISOString();

    try {
      await this.prisma.$queryRaw(Prisma.sql`SELECT 1`);
      return { status: 'ok', database: 'connected', timestamp };
    } catch {
      return { status: 'degraded', database: 'disconnected', timestamp };
    }
  }
}
