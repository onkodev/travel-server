import { Controller, Post, Get, Body, Logger, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { EmailEmbeddingService } from './email-embedding.service';
import { EmailRagService } from './email-rag.service';
import { SearchEmailRagDto, SyncEmailRagDto, AnalyzePlacesDto, EmbedEstimatesDto } from './dto';

@SkipThrottle({ default: true, strict: true })
@Controller('email-rag/admin')
export class EmailRagController {
  private readonly logger = new Logger(EmailRagController.name);

  constructor(
    private embeddingService: EmailEmbeddingService,
    private ragService: EmailRagService,
  ) {}

  /**
   * 이메일 임베딩 동기화
   * POST /api/email-rag/admin/sync
   */
  @Public()
  @Post('sync')
  async sync(@Body() dto: SyncEmailRagDto) {
    this.logger.log(`Starting email embedding sync (batchSize: ${dto.batchSize || 50})`);
    const result = await this.embeddingService.syncAll(dto.batchSize);
    return result;
  }

  /**
   * 동기화 상태 조회
   * GET /api/email-rag/admin/sync-status
   */
  @Public()
  @Get('sync-status')
  async syncStatus() {
    return this.embeddingService.getSyncStatus();
  }

  /**
   * 유사 이메일 검색
   * POST /api/email-rag/admin/search
   */
  @Public()
  @Post('search')
  async search(@Body() dto: SearchEmailRagDto) {
    const results = await this.ragService.searchSimilarEmails(
      dto.query,
      dto.limit || 5,
    );
    return { results, count: results.length };
  }

  /**
   * 이메일 분석 → 장소 추출 + DB 매칭
   * POST /api/email-rag/admin/analyze-places
   */
  @UseGuards(AuthGuard)
  @Post('analyze-places')
  async analyzePlaces(@Body() dto: AnalyzePlacesDto) {
    this.logger.log(`Analyzing places for query: "${dto.query}"`);
    return this.ragService.analyzePlaces(
      dto.query,
      dto.limit,
      dto.similarityMin,
    );
  }

  /**
   * 노이즈 이메일 일괄 마킹
   * POST /api/email-rag/admin/mark-noise
   */
  @Public()
  @Post('mark-noise')
  async markNoise() {
    this.logger.log('Starting noise email marking');
    return this.embeddingService.batchMarkNoise();
  }

  /**
   * 노이즈 통계 조회
   * GET /api/email-rag/admin/noise-stats
   */
  @Public()
  @Get('noise-stats')
  async noiseStats() {
    return this.embeddingService.getNoiseStats();
  }

  /**
   * 견적 일괄 임베딩
   * POST /api/email-rag/admin/sync-estimate-embeddings
   */
  @Public()
  @Post('sync-estimate-embeddings')
  async syncEstimateEmbeddings(@Body() dto: SyncEmailRagDto) {
    this.logger.log(`Starting estimate embedding sync (batchSize: ${dto.batchSize || 100})`);
    return this.embeddingService.syncEstimateEmbeddings(dto.batchSize);
  }

  /**
   * 견적 임베딩 상태 조회
   * GET /api/email-rag/admin/estimate-embedding-status
   */
  @Public()
  @Get('estimate-embedding-status')
  async estimateEmbeddingStatus() {
    return this.embeddingService.getEstimateEmbeddingStatus();
  }

  /**
   * 선택한 견적 임베딩
   * POST /api/email-rag/admin/embed-estimates
   */
  @Public()
  @Post('embed-estimates')
  async embedEstimates(@Body() dto: EmbedEstimatesDto) {
    this.logger.log(`Selected estimate embedding: ${dto.ids.length}건`);
    return this.embeddingService.embedEstimatesByIds(dto.ids);
  }
}
