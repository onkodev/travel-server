import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('헬스체크')
@Controller('health')
export class HealthController {
  @Get()
  @Public()
  @SkipThrottle({ default: true, strict: true })
  @ApiOperation({
    summary: '헬스 체크',
    description: '서버 상태를 확인합니다.',
  })
  @ApiResponse({ status: 200, description: '서버 정상' })
  check() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
