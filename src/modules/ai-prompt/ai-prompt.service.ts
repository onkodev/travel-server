import { Injectable, Logger, OnModuleInit, NotFoundException } from '@nestjs/common';
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
        promptText: null, // null = 코드 기본값 사용
        temperature: null,
        maxOutputTokens: null,
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
    if (!def) throw new NotFoundException(`프롬프트 키를 찾을 수 없습니다: ${key}`);

    const row = await this.prisma.aiPromptTemplate.findUnique({
      where: { key },
    });

    const result = {
      text: row?.promptText ?? def.defaultText,
      temperature: row?.temperature ?? def.defaultTemperature,
      maxOutputTokens: row?.maxOutputTokens ?? def.defaultMaxOutputTokens,
      isCustomized: row?.promptText != null || row?.temperature != null || row?.maxOutputTokens != null,
    };

    this.cache.set(cacheKey, result);
    return result;
  }

  /**
   * 템플릿 + 변수 치환 + config 반환
   */
  async buildPrompt(
    key: PromptKey,
    variables: Record<string, string> = {},
  ): Promise<BuiltPrompt> {
    const tpl = await this.getTemplate(key);
    return {
      text: resolveTemplate(tpl.text, variables),
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
        maxOutputTokens: row.maxOutputTokens ?? def?.defaultMaxOutputTokens ?? 1024,
        isCustomized: row.promptText != null || row.temperature != null || row.maxOutputTokens != null,
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
    if (!def) throw new NotFoundException(`프롬프트 키를 찾을 수 없습니다: ${key}`);

    const row = await this.prisma.aiPromptTemplate.findUnique({
      where: { key },
    });

    if (!row) throw new NotFoundException(`DB에서 프롬프트를 찾을 수 없습니다: ${key}`);

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
      isCustomized: row.promptText != null || row.temperature != null || row.maxOutputTokens != null,
      isActive: row.isActive,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * 프롬프트 수정
   */
  async updatePrompt(key: string, data: {
    promptText?: string | null;
    temperature?: number | null;
    maxOutputTokens?: number | null;
  }) {
    const def = PROMPT_REGISTRY[key as PromptKey];
    if (!def) throw new NotFoundException(`프롬프트 키를 찾을 수 없습니다: ${key}`);

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
    if (!def) throw new NotFoundException(`프롬프트 키를 찾을 수 없습니다: ${key}`);

    const updated = await this.prisma.aiPromptTemplate.update({
      where: { key },
      data: {
        promptText: null,
        temperature: null,
        maxOutputTokens: null,
      },
    });

    this.cache.delete(`prompt:${key}`);
    return { key: updated.key, updatedAt: updated.updatedAt };
  }

  // ============================================================================
  // FaqChatConfig
  // ============================================================================

  async getFaqChatConfig() {
    const config = await this.prisma.aiGenerationConfig.findFirst({
      where: { id: 1 },
      select: {
        id: true,
        directThreshold: true,
        ragThreshold: true,
        noMatchResponse: true,
        updatedAt: true,
      },
    });
    return config ?? {
      id: 1,
      directThreshold: 0.7,
      ragThreshold: 0.5,
      noMatchResponse: null,
      updatedAt: new Date(),
    };
  }

  async updateFaqChatConfig(data: {
    directThreshold?: number;
    ragThreshold?: number;
    noMatchResponse?: string | null;
  }) {
    const updated = await this.prisma.aiGenerationConfig.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        directThreshold: data.directThreshold ?? 0.7,
        ragThreshold: data.ragThreshold ?? 0.5,
        noMatchResponse: data.noMatchResponse ?? null,
      },
      update: data,
    });
    return {
      id: updated.id,
      directThreshold: updated.directThreshold,
      ragThreshold: updated.ragThreshold,
      noMatchResponse: updated.noMatchResponse,
      updatedAt: updated.updatedAt,
    };
  }
}
