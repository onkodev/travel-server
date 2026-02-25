import {
  Injectable,
  Logger,
  OnModuleInit,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MemoryCache } from '../../common/utils';
import {
  PromptKey,
  PROMPT_REGISTRY,
  type PromptDefinition,
} from './prompt-registry';
import { resolveTemplate } from './prompt-resolver';

export interface BuiltPrompt {
  text: string;
  temperature: number;
  maxOutputTokens: number;
}


@Injectable()
export class AiPromptService implements OnModuleInit {
  private readonly logger = new Logger(AiPromptService.name);
  private cache = new MemoryCache(10 * 60 * 1000); // 10분 캐시

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    await this.seedMissingPrompts();
    await this.migrateNullPrompts();
  }

  /**
   * DB-First Migration: 기존에 null(기본값 사용)로 설정된 프롬프트를 실제 텍스트로 채움
   */
  private async migrateNullPrompts() {
    const nullPrompts = await this.prisma.aiPromptTemplate.findMany({
      where: { promptText: null },
    });

    if (nullPrompts.length === 0) return;

    this.logger.log(
      `DB-First 마이그레이션 시작: ${nullPrompts.length}개 프롬프트 업데이트`,
    );

    for (const row of nullPrompts) {
      const def = PROMPT_REGISTRY[row.key as PromptKey];
      if (!def) continue;

      await this.prisma.aiPromptTemplate.update({
        where: { id: row.id },
        data: {
          promptText: def.defaultText,
          temperature: row.temperature ?? def.defaultTemperature,
          maxOutputTokens: row.maxOutputTokens ?? def.defaultMaxOutputTokens,
        },
      });
    }

    this.logger.log('DB-First 마이그레이션 완료');
  }

  /**
   * DB에 없는 키 자동 seed
   */
  private async seedMissingPrompts() {
    const existing = await this.prisma.aiPromptTemplate.findMany({
      select: { key: true },
    });
    const existingKeys = new Set(existing.map((e) => e.key));

    const missing = Object.values(PROMPT_REGISTRY).filter(
      (def) => !existingKeys.has(def.key),
    );

    if (missing.length === 0) return;

    await this.prisma.aiPromptTemplate.createMany({
      data: missing.map((def) => ({
        key: def.key,
        name: def.name,
        description: def.description,
        category: def.category,
        promptText: def.defaultText, // DB-First: 기본값 저장
        temperature: def.defaultTemperature,
        maxOutputTokens: def.defaultMaxOutputTokens,
      })),
      skipDuplicates: true,
    });

    this.logger.log(`AI 프롬프트 ${missing.length}개 seed 완료`);
  }

  /**
   * DB 우선, null이면 레지스트리 기본값 반환
   */
  async getTemplate(key: PromptKey): Promise<{
    text: string;
    temperature: number;
    maxOutputTokens: number;
    isCustomized: boolean;
  }> {
    const cacheKey = `prompt:${key}`;
    const cached = this.cache.get<{
      text: string;
      temperature: number;
      maxOutputTokens: number;
      isCustomized: boolean;
    }>(cacheKey);
    if (cached) return cached;

    const def = PROMPT_REGISTRY[key];
    if (!def)
      throw new NotFoundException(`프롬프트 키를 찾을 수 없습니다: ${key}`);

    const row = await this.prisma.aiPromptTemplate.findUnique({
      where: { key },
    });

    const result = {
      text: row?.promptText ?? def.defaultText,
      temperature: row?.temperature ?? def.defaultTemperature,
      maxOutputTokens: row?.maxOutputTokens ?? def.defaultMaxOutputTokens,
      isCustomized:
        row?.promptText != null ||
        row?.temperature != null ||
        row?.maxOutputTokens != null,
    };

    this.cache.set(cacheKey, result);
    return result;
  }

  /**
   * 템플릿 + 변수 치환 + config 반환
   * FAQ 답변 프롬프트의 경우 프리셋 오버라이드 적용
   */
  async buildPrompt(
    key: PromptKey,
    variables: Record<string, string> = {},
  ): Promise<BuiltPrompt> {
    const tpl = await this.getTemplate(key);
    // Auto-inject currentDate for all prompts
    const vars: Record<string, string> = {
      currentDate: new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
      ...variables,
    };

    return {
      text: resolveTemplate(tpl.text, vars),
      temperature: tpl.temperature,
      maxOutputTokens: tpl.maxOutputTokens,
    };
  }

  /**
   * 관리자 목록 (isCustomized 계산)
   */
  async getAllPrompts(category?: string) {
    const where = category ? { category } : {};
    const rows = await this.prisma.aiPromptTemplate.findMany({
      where,
      orderBy: [{ category: 'asc' }, { key: 'asc' }],
    });

    return rows.map((row) => {
      const def = PROMPT_REGISTRY[row.key as PromptKey];
      return {
        key: row.key,
        name: row.name,
        description: row.description,
        category: row.category,
        temperature: row.temperature ?? def?.defaultTemperature ?? 0.7,
        maxOutputTokens:
          row.maxOutputTokens ?? def?.defaultMaxOutputTokens ?? 1024,
        isCustomized:
          row.promptText != null ||
          row.temperature != null ||
          row.maxOutputTokens != null,
        isActive: row.isActive,
        updatedAt: row.updatedAt,
      };
    });
  }

  /**
   * 관리자 상세 — currentText + defaultText + variables
   */
  async getPromptDetail(key: string) {
    const def = PROMPT_REGISTRY[key as PromptKey];
    if (!def)
      throw new NotFoundException(`프롬프트 키를 찾을 수 없습니다: ${key}`);

    const row = await this.prisma.aiPromptTemplate.findUnique({
      where: { key },
    });

    if (!row)
      throw new NotFoundException(`DB에서 프롬프트를 찾을 수 없습니다: ${key}`);

    return {
      key: row.key,
      name: row.name,
      description: row.description,
      category: row.category,
      currentText: row.promptText ?? def.defaultText,
      defaultText: def.defaultText,
      variables: def.variables,
      temperature: row.temperature ?? def.defaultTemperature,
      maxOutputTokens: row.maxOutputTokens ?? def.defaultMaxOutputTokens,
      defaultTemperature: def.defaultTemperature,
      defaultMaxOutputTokens: def.defaultMaxOutputTokens,
      isCustomized:
        row.promptText != null ||
        row.temperature != null ||
        row.maxOutputTokens != null,
      isActive: row.isActive,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * 프롬프트 수정
   */
  async updatePrompt(
    key: string,
    data: {
      promptText?: string | null;
      temperature?: number | null;
      maxOutputTokens?: number | null;
    },
  ) {
    const def = PROMPT_REGISTRY[key as PromptKey];
    if (!def)
      throw new NotFoundException(`프롬프트 키를 찾을 수 없습니다: ${key}`);

    const updated = await this.prisma.aiPromptTemplate.update({
      where: { key },
      data: {
        promptText: data.promptText,
        temperature: data.temperature,
        maxOutputTokens: data.maxOutputTokens,
      },
    });

    this.cache.delete(`prompt:${key}`);
    return { key: updated.key, updatedAt: updated.updatedAt };
  }

  /**
   * 기본값 복원
   */
  async resetPrompt(key: string) {
    const def = PROMPT_REGISTRY[key as PromptKey];
    if (!def)
      throw new NotFoundException(`프롬프트 키를 찾을 수 없습니다: ${key}`);

    const updated = await this.prisma.aiPromptTemplate.update({
      where: { key },
      data: {
        promptText: def.defaultText, // DB-First: 기본값으로 덮어쓰기
        temperature: def.defaultTemperature,
        maxOutputTokens: def.defaultMaxOutputTokens,
      },
    });

    this.cache.delete(`prompt:${key}`);
    return { key: updated.key, updatedAt: updated.updatedAt };
  }

  // ============================================================================
  // FaqChatConfig
  // ============================================================================

  async getFaqChatConfig() {
    const defaultText =
      PROMPT_REGISTRY[PromptKey.FAQ_NO_MATCH_RESPONSE].defaultText;
    const config = await this.prisma.aiGenerationConfig.findFirst({
      where: { id: 1 },
      select: {
        id: true,
        noMatchResponse: true,
        updatedAt: true,
      },
    });
    return {
      id: config?.id ?? 1,
      noMatchResponse: config?.noMatchResponse ?? defaultText,
      updatedAt: config?.updatedAt ?? new Date(),
    };
  }

  // ============================================================================
  // EstimateConfig
  // ============================================================================

  async getEstimateConfig() {
    const config = await this.prisma.aiGenerationConfig.findFirst({
      where: { id: 1 },
      select: {
        id: true,
        geminiModel: true,
        geminiTemperature: true,
        geminiMaxTokens: true,
        ragSearchLimit: true,
        ragEstimateLimit: true,
        ragSimilarityMin: true,
        ragTimeout: true,
        placesPerDay: true,
        fuzzyMatchThreshold: true,
        customPromptAddon: true,
        aiEstimateValidityDays: true,
        includeTbdItems: true,
        updatedAt: true,
      },
    });
    return (
      config ?? {
        id: 1,
        geminiModel: 'gemini-2.5-flash',
        geminiTemperature: 0.7,
        geminiMaxTokens: 8192,
        ragSearchLimit: 5,
        ragEstimateLimit: 3,
        ragSimilarityMin: 0.3,
        ragTimeout: 30000,
        placesPerDay: 4,
        fuzzyMatchThreshold: 0.6,
        customPromptAddon: null,
        aiEstimateValidityDays: 7,
        includeTbdItems: true,
        updatedAt: new Date(),
      }
    );
  }

  async updateEstimateConfig(data: {
    geminiModel?: string;
    geminiTemperature?: number;
    geminiMaxTokens?: number;
    ragSearchLimit?: number;
    ragEstimateLimit?: number;
    ragSimilarityMin?: number;
    ragTimeout?: number;
    placesPerDay?: number;
    fuzzyMatchThreshold?: number;
    customPromptAddon?: string | null;
    aiEstimateValidityDays?: number;
    includeTbdItems?: boolean;
  }) {
    const updated = await this.prisma.aiGenerationConfig.upsert({
      where: { id: 1 },
      create: { id: 1, ...data },
      update: data,
    });

    // estimate config 캐시 무효화
    this.cache.delete('estimate-config');

    return {
      id: updated.id,
      geminiModel: updated.geminiModel,
      geminiTemperature: updated.geminiTemperature,
      geminiMaxTokens: updated.geminiMaxTokens,
      ragSearchLimit: updated.ragSearchLimit,
      ragEstimateLimit: updated.ragEstimateLimit,
      ragSimilarityMin: updated.ragSimilarityMin,
      ragTimeout: updated.ragTimeout,
      placesPerDay: updated.placesPerDay,
      fuzzyMatchThreshold: updated.fuzzyMatchThreshold,
      customPromptAddon: updated.customPromptAddon,
      aiEstimateValidityDays: updated.aiEstimateValidityDays,
      includeTbdItems: updated.includeTbdItems,
      updatedAt: updated.updatedAt,
    };
  }

  async updateFaqChatConfig(data: { noMatchResponse?: string | null }) {
    const updated = await this.prisma.aiGenerationConfig.upsert({
      where: { id: 1 },
      create: { id: 1, noMatchResponse: data.noMatchResponse ?? null },
      update: { noMatchResponse: data.noMatchResponse },
    });

    return {
      id: updated.id,
      noMatchResponse: updated.noMatchResponse,
      updatedAt: updated.updatedAt,
    };
  }
}
