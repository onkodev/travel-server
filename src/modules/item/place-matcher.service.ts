import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

// ── 공통 타입 ──

/** DB 아이템 기본 필드 (매칭 결과 공통) */
export interface MatchedItemBase {
  id: number;
  nameKor: string;
  nameEng: string;
}

/** DB 아이템 전체 필드 (견적 아이템 빌드용) */
export interface MatchedItemFull extends MatchedItemBase {
  descriptionEng: string | null;
  images: unknown;
  lat: unknown;
  lng: unknown;
  addressEnglish: string | null;
  price: unknown;
  region: string | null;
}

export type MatchTier = 'exact' | 'partial' | 'fuzzy' | 'unmatched';

/** 매칭 입력 */
export interface PlaceMatchInput {
  name: string;
  nameKor?: string;
}

/** 매칭 결과 */
export interface PlaceMatchResult<T extends MatchedItemBase = MatchedItemBase> {
  input: PlaceMatchInput;
  tier: MatchTier;
  item?: T;
  score?: number; // fuzzy 매칭 유사도
}

/** 매칭 옵션 */
export interface PlaceMatchOptions {
  fuzzyThreshold?: number;
  /** true면 full 필드 반환 (images, lat, lng 등) */
  fullSelect?: boolean;
  /** fuzzy 매칭 시 지역 필터 (e.g. 'Seoul') */
  region?: string;
}

// ── Prisma select 상수 ──

const ITEM_SELECT_BASE = {
  id: true,
  nameKor: true,
  nameEng: true,
} as const;

const ITEM_SELECT_FULL = {
  ...ITEM_SELECT_BASE,
  descriptionEng: true,
  images: true,
  lat: true,
  lng: true,
  addressEnglish: true,
  price: true,
  region: true,
} as const;

@Injectable()
export class PlaceMatcherService {
  private readonly logger = new Logger(PlaceMatcherService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * 장소명 배열 → DB 매칭 (exact → partial → fuzzy 3단계)
   * fullSelect=true 시 MatchedItemFull 반환
   */
  async matchPlaces(
    inputs: PlaceMatchInput[],
    options?: PlaceMatchOptions & { fullSelect: true },
  ): Promise<PlaceMatchResult<MatchedItemFull>[]>;
  async matchPlaces(
    inputs: PlaceMatchInput[],
    options?: PlaceMatchOptions,
  ): Promise<PlaceMatchResult<MatchedItemBase>[]>;
  async matchPlaces(
    inputs: PlaceMatchInput[],
    options?: PlaceMatchOptions,
  ): Promise<PlaceMatchResult[]> {
    if (inputs.length === 0) return [];

    const threshold = options?.fuzzyThreshold ?? 0.3;
    const select = options?.fullSelect ? ITEM_SELECT_FULL : ITEM_SELECT_BASE;

    // ── 1. DB 정확(contains) 검색 ──
    const orConditions = inputs.flatMap((input) => {
      const conditions = [
        {
          OR: [
            { nameEng: { contains: input.name, mode: 'insensitive' as const } },
            { nameKor: { contains: input.name } },
          ],
        },
      ];
      if (input.nameKor) {
        conditions.push({
          OR: [
            { nameKor: { contains: input.nameKor } },
            {
              nameEng: {
                contains: input.nameKor,
                mode: 'insensitive' as const,
              },
            },
          ],
        });
      }
      return conditions;
    });

    const dbItems = await this.prisma.item.findMany({
      where: { type: 'place', aiEnabled: true, OR: orConditions },
      select,
    });

    // 이름 → DB 아이템 맵 (소문자)
    const nameMap = new Map<string, (typeof dbItems)[0]>();
    for (const item of dbItems) {
      const engKey = (item as MatchedItemBase).nameEng.toLowerCase().trim();
      const korKey = (item as MatchedItemBase).nameKor.toLowerCase().trim();
      if (engKey) nameMap.set(engKey, item);
      if (korKey) nameMap.set(korKey, item);
    }

    // ── 2. 매칭 루프 (exact → partial) ──
    const results: PlaceMatchResult[] = [];
    const unmatchedIndices: number[] = [];

    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      const keyEng = input.name.toLowerCase().trim();
      const keyKor = input.nameKor?.toLowerCase();

      // Exact: 이름 맵 직접 조회
      const exact =
        nameMap.get(keyEng) || (keyKor ? nameMap.get(keyKor) : undefined);
      if (exact) {
        results.push({
          input,
          tier: 'exact',
          item: this.toItem(exact, options?.fullSelect),
        });
        continue;
      }

      // Partial: 양방향 contains (가장 짧은 이름 차이 = best match 선택)
      let bestPartial: (typeof dbItems)[0] | undefined;
      let bestPartialDiff = Infinity;
      for (const db of dbItems) {
        const eng = (db as MatchedItemBase).nameEng.toLowerCase();
        let matched = false;
        if (eng.includes(keyEng) || keyEng.includes(eng)) matched = true;
        if (!matched && keyKor) {
          const kor = (db as MatchedItemBase).nameKor.toLowerCase();
          if (kor.includes(keyKor) || keyKor.includes(kor)) matched = true;
        }
        if (matched) {
          const diff = Math.abs(eng.length - keyEng.length);
          if (diff < bestPartialDiff) {
            bestPartialDiff = diff;
            bestPartial = db;
          }
        }
      }

      if (bestPartial) {
        results.push({
          input,
          tier: 'partial',
          item: this.toItem(bestPartial, options?.fullSelect),
        });
      } else {
        results.push({ input, tier: 'unmatched' }); // placeholder
        unmatchedIndices.push(i);
      }
    }

    // ── 3. Fuzzy 배치 매칭 (pg_trgm, 1회 SQL) ──
    if (unmatchedIndices.length > 0) {
      const fuzzyNames = unmatchedIndices.map((i) => inputs[i].name);
      const fuzzyMap = await this.fuzzyMatchBatch(
        fuzzyNames,
        threshold,
        options?.region,
      );

      for (const idx of unmatchedIndices) {
        const fuzzy = fuzzyMap.get(inputs[idx].name);
        if (fuzzy) {
          results[idx] = {
            input: inputs[idx],
            tier: 'fuzzy',
            item: options?.fullSelect
              ? fuzzy
              : {
                  id: fuzzy.id,
                  nameKor: fuzzy.nameKor,
                  nameEng: fuzzy.nameEng,
                },
            score: fuzzy.sim,
          };
        }
      }
    }

    const tiers = { exact: 0, partial: 0, fuzzy: 0, unmatched: 0 };
    for (const r of results) tiers[r.tier]++;
    this.logger.log(
      `[matchPlaces] ${inputs.length} inputs → exact:${tiers.exact} partial:${tiers.partial} fuzzy:${tiers.fuzzy} unmatched:${tiers.unmatched}`,
    );

    return results;
  }

  /**
   * ID 배열로 아이템 일괄 조회 (Gemini 직접 매칭용)
   */
  async findItemsByIds(ids: number[]): Promise<Map<number, MatchedItemFull>> {
    if (ids.length === 0) return new Map();

    const items = await this.prisma.item.findMany({
      where: { id: { in: ids }, type: 'place', aiEnabled: true },
      select: ITEM_SELECT_FULL,
    });

    return new Map(
      items.map((item) => [
        item.id,
        {
          id: item.id,
          nameKor: item.nameKor,
          nameEng: item.nameEng,
          descriptionEng: item.descriptionEng,
          images: item.images,
          lat: item.lat,
          lng: item.lng,
          addressEnglish: item.addressEnglish,
          price: item.price,
          region: item.region,
        },
      ]),
    );
  }

  /**
   * aiEnabled=false 아이템과 매칭되는 이름 찾기
   * Gemini가 자체 지식으로 추천한 장소가 disabled 아이템인지 체크
   * exact + partial + fuzzy(pg_trgm) 3단계 매칭 사용
   */
  async findDisabledMatches(names: string[]): Promise<Set<string>> {
    if (names.length === 0) return new Set();

    const disabledNames = new Set<string>();

    // 1. Prisma exact/partial 매칭
    const orConditions = names.flatMap((name) => [
      { nameEng: { contains: name, mode: 'insensitive' as const } },
      { nameKor: { contains: name } },
    ]);

    const dbItems = await this.prisma.item.findMany({
      where: { type: 'place', aiEnabled: false, OR: orConditions },
      select: { nameEng: true, nameKor: true },
    });

    if (dbItems.length > 0) {
      for (const name of names) {
        const lower = name.toLowerCase().trim();
        for (const db of dbItems) {
          const eng = db.nameEng.toLowerCase();
          const kor = db.nameKor.toLowerCase();
          if (
            eng.includes(lower) ||
            lower.includes(eng) ||
            kor.includes(lower) ||
            lower.includes(kor)
          ) {
            disabledNames.add(name);
            break;
          }
        }
      }
    }

    // 2. Fuzzy 매칭 (exact/partial로 안 잡힌 나머지)
    const remaining = names.filter((n) => !disabledNames.has(n));
    if (remaining.length > 0) {
      try {
        const fuzzyResults = await this.prisma.$queryRaw<
          Array<{ query_name: string; sim: number }>
        >`
          SELECT DISTINCT ON (query_name)
            query_name,
            GREATEST(similarity(name_eng, query_name), similarity(name_kor, query_name)) AS sim
          FROM items
          CROSS JOIN unnest(${remaining}::text[]) AS query_name
          WHERE type = 'place'
            AND ai_enabled = false
            AND GREATEST(similarity(name_eng, query_name), similarity(name_kor, query_name)) > 0.3
          ORDER BY query_name, sim DESC
        `;
        for (const r of fuzzyResults) {
          disabledNames.add(r.query_name);
        }
      } catch (e) {
        this.logger.warn(
          `[findDisabledMatches] fuzzy 검색 실패: ${(e as Error).message}`,
        );
      }
    }

    if (disabledNames.size > 0) {
      this.logger.log(
        `[findDisabledMatches] ${names.length}개 중 ${disabledNames.size}개 disabled 매칭: ${[...disabledNames].join(', ')}`,
      );
    }

    return disabledNames;
  }

  // ── Private helpers ──

  /** pg_trgm 배치 퍼지 매칭 — 항상 full columns 조회 (SQL 단순화) */
  private async fuzzyMatchBatch(
    names: string[],
    threshold: number,
    region?: string,
  ): Promise<Map<string, MatchedItemFull & { sim: number }>> {
    if (names.length === 0) return new Map();

    // 지역 필터가 있으면 해당 지역 우선, 없으면 전체 검색
    const results = region
      ? await this.prisma.$queryRaw<
          Array<{
            query_name: string;
            id: number;
            name_kor: string;
            name_eng: string;
            description_eng: string | null;
            images: unknown;
            lat: number;
            lng: number;
            address_english: string | null;
            price: number;
            region: string | null;
            sim: number;
          }>
        >`
          SELECT DISTINCT ON (query_name)
            query_name, id, name_kor, name_eng, description_eng, images, lat, lng, address_english, price, region,
            GREATEST(similarity(name_eng, query_name), similarity(name_kor, query_name)) AS sim
          FROM items
          CROSS JOIN unnest(${names}::text[]) AS query_name
          WHERE type = 'place'
            AND ai_enabled = true
            AND (region ILIKE ${'%' + region + '%'} OR address_english ILIKE ${'%' + region + '%'})
            AND GREATEST(similarity(name_eng, query_name), similarity(name_kor, query_name)) > ${threshold}
          ORDER BY query_name, sim DESC
        `
      : await this.prisma.$queryRaw<
          Array<{
            query_name: string;
            id: number;
            name_kor: string;
            name_eng: string;
            description_eng: string | null;
            images: unknown;
            lat: number;
            lng: number;
            address_english: string | null;
            price: number;
            region: string | null;
            sim: number;
          }>
        >`
          SELECT DISTINCT ON (query_name)
            query_name, id, name_kor, name_eng, description_eng, images, lat, lng, address_english, price, region,
            GREATEST(similarity(name_eng, query_name), similarity(name_kor, query_name)) AS sim
          FROM items
          CROSS JOIN unnest(${names}::text[]) AS query_name
          WHERE type = 'place'
            AND ai_enabled = true
            AND GREATEST(similarity(name_eng, query_name), similarity(name_kor, query_name)) > ${threshold}
          ORDER BY query_name, sim DESC
        `;

    const map = new Map<string, MatchedItemFull & { sim: number }>();
    for (const r of results) {
      map.set(r.query_name, {
        id: r.id,
        nameKor: r.name_kor,
        nameEng: r.name_eng,
        descriptionEng: r.description_eng,
        images: r.images,
        lat: r.lat,
        lng: r.lng,
        addressEnglish: r.address_english,
        price: r.price,
        region: r.region,
        sim: Number(r.sim),
      });
    }

    this.logger.log(
      `[fuzzyMatchBatch] ${names.length} queries → ${map.size} matches`,
    );
    return map;
  }

  /** DB row → MatchedItemBase | MatchedItemFull */
  private toItem(
    row: Record<string, unknown>,
    full?: boolean,
  ): MatchedItemBase | MatchedItemFull {
    const base: MatchedItemBase = {
      id: row.id as number,
      nameKor: row.nameKor as string,
      nameEng: row.nameEng as string,
    };
    if (!full) return base;
    return {
      ...base,
      descriptionEng: (row.descriptionEng as string | null) ?? null,
      images: row.images,
      lat: row.lat,
      lng: row.lng,
      addressEnglish: (row.addressEnglish as string | null) ?? null,
      price: row.price,
      region: (row.region as string | null) ?? null,
    };
  }
}
