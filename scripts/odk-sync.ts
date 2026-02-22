/**
 * ODK 투어 sitemap 기반 동기화 스크립트
 * 실행: npx ts-node scripts/odk-sync.ts
 *
 * 1) product-sitemap.xml → 투어 URL 목록 추출
 * 2) 각 URL HTML → JSON-LD 파싱 (name, description, rating, reviewCount, category, image)
 * 3) DB 매칭 (slug 기준): 업데이트 / 신규 생성 / stale 비활성화
 * 4) description 변경 시 임베딩 재생성
 */

import { PrismaClient } from '@prisma/client';
import * as cheerio from 'cheerio';

const prisma = new PrismaClient();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const EMBEDDING_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent';
const BASE_URL = 'https://onedaykorea.com';
const SITEMAP_URL = `${BASE_URL}/product-sitemap.xml`;
const CONCURRENCY = 5;
const DELAY_MS = 1000;

// ============================================================================
// Types
// ============================================================================

interface SiteProduct {
  slug: string;
  url: string;
  name: string;
  description: string | null;
  thumbnailUrl: string | null;
  rating: number | null;
  reviewCount: number | null;
  category: string | null;
  tags: string[];
}

interface DbTour {
  id: number;
  slug: string;
  description: string | null;
  rating: number | null;
  review_count: number | null;
  category: string | null;
  is_active: boolean;
}

// ============================================================================
// Sitemap Parsing
// ============================================================================

async function fetchSitemapUrls(): Promise<string[]> {
  console.log(`📡 Fetching sitemap: ${SITEMAP_URL}`);
  const html = await fetchPage(SITEMAP_URL);
  if (!html) throw new Error('Sitemap fetch failed');

  const $ = cheerio.load(html, { xmlMode: true });
  const urls: string[] = [];

  $('url > loc').each((_, el) => {
    const loc = $(el).text().trim();
    if (loc.includes('/tours/') && !loc.endsWith('/tours/')) {
      urls.push(loc);
    }
  });

  console.log(`  Found ${urls.length} tour URLs in sitemap`);
  return urls;
}

// ============================================================================
// JSON-LD Parsing
// ============================================================================

function extractSlug(url: string): string | null {
  const match = url.match(/\/tours\/([^/]+)\/?$/);
  return match ? match[1] : null;
}

function parseJsonLd(html: string, url: string): SiteProduct | null {
  const $ = cheerio.load(html);
  const slug = extractSlug(url);
  if (!slug) return null;

  // JSON-LD에서 Product 추출
  let product: Record<string, unknown> | null = null;

  $('script[type="application/ld+json"]').each((_, el) => {
    if (product) return;
    try {
      const data = JSON.parse($(el).html() || '');
      // @graph 배열에서 Product 타입 찾기
      if (data['@graph'] && Array.isArray(data['@graph'])) {
        const found = data['@graph'].find(
          (item: Record<string, unknown>) => item['@type'] === 'Product',
        );
        if (found) product = found;
      }
      // 직접 Product인 경우
      if (data['@type'] === 'Product') {
        product = data;
      }
    } catch {
      // JSON 파싱 실패 무시
    }
  });

  if (!product) {
    // JSON-LD 없으면 og:meta 폴백
    const name =
      $('h1').first().text().trim() ||
      $('meta[property="og:title"]').attr('content') ||
      '';
    if (!name) return null;

    return {
      slug,
      url,
      name,
      description:
        $('meta[property="og:description"]').attr('content') || null,
      thumbnailUrl: $('meta[property="og:image"]').attr('content') || null,
      rating: null,
      reviewCount: null,
      category: null,
      tags: [],
    };
  }

  // Product에서 데이터 추출
  const name = (product['name'] as string) || '';
  const description = (product['description'] as string) || null;

  // aggregateRating
  const aggRating = product['aggregateRating'] as Record<string, unknown> | undefined;
  const rating = aggRating?.ratingValue
    ? parseFloat(String(aggRating.ratingValue))
    : null;
  const reviewCount = aggRating?.ratingCount
    ? parseInt(String(aggRating.ratingCount), 10)
    : aggRating?.reviewCount
      ? parseInt(String(aggRating.reviewCount), 10)
      : null;

  // category
  const category = (product['category'] as string) || null;

  // image
  let thumbnailUrl: string | null = null;
  const images = product['image'] as unknown;
  if (Array.isArray(images) && images.length > 0) {
    const first = images[0];
    if (typeof first === 'string') {
      thumbnailUrl = first;
    } else if (first && typeof first === 'object' && 'url' in first) {
      thumbnailUrl = (first as Record<string, string>).url;
    }
  } else if (typeof images === 'string') {
    thumbnailUrl = images;
  }

  // tags from category
  const tags: string[] = [];
  if (category) {
    tags.push(
      ...category
        .split(/[,/&]/)
        .map((t) => t.trim())
        .filter(Boolean),
    );
  }

  return {
    slug,
    url,
    name,
    description,
    thumbnailUrl,
    rating: rating !== null && !isNaN(rating) ? rating : null,
    reviewCount:
      reviewCount !== null && !isNaN(reviewCount) ? reviewCount : null,
    category,
    tags,
  };
}

// ============================================================================
// Concurrent Crawling
// ============================================================================

async function crawlProducts(urls: string[]): Promise<SiteProduct[]> {
  const products: SiteProduct[] = [];
  const chunks: string[][] = [];

  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    chunks.push(urls.slice(i, i + CONCURRENCY));
  }

  for (const chunk of chunks) {
    const results = await Promise.all(
      chunk.map(async (url) => {
        const html = await fetchPage(url);
        if (!html) return null;
        return parseJsonLd(html, url);
      }),
    );

    for (const p of results) {
      if (p) products.push(p);
    }

    console.log(`  Crawled ${Math.min(products.length + CONCURRENCY, urls.length)}/${urls.length}...`);
    await delay(DELAY_MS);
  }

  return products;
}

// ============================================================================
// DB Sync
// ============================================================================

async function syncToDb(products: SiteProduct[]): Promise<{
  updated: number;
  created: number;
  deactivated: number;
  embeddingsUpdated: number;
}> {
  const stats = { updated: 0, created: 0, deactivated: 0, embeddingsUpdated: 0 };

  // 현재 DB 투어 조회
  const dbTours = await prisma.$queryRawUnsafe<DbTour[]>(
    `SELECT id, slug, description, rating, review_count, category, is_active FROM odk_tours`,
  );
  const dbMap = new Map(dbTours.map((t) => [t.slug, t]));
  const siteSlugSet = new Set(products.map((p) => p.slug));

  // 업데이트 / 신규 생성
  for (const p of products) {
    const existing = dbMap.get(p.slug);

    if (existing) {
      // 업데이트
      await prisma.$executeRawUnsafe(
        `UPDATE odk_tours SET
          name = $1,
          description = COALESCE($2, description),
          thumbnail_url = COALESCE($3, thumbnail_url),
          website_url = $4,
          rating = COALESCE($5, rating),
          review_count = COALESCE($6, review_count),
          category = COALESCE($7, category),
          tags = CASE WHEN cardinality($8::text[]) > 0 THEN $8::text[] ELSE tags END,
          is_active = true,
          last_synced_at = now(),
          updated_at = now()
        WHERE id = $9`,
        p.name,
        p.description,
        p.thumbnailUrl,
        p.url,
        p.rating,
        p.reviewCount,
        p.category,
        p.tags,
        existing.id,
      );
      stats.updated++;

      // description 변경 시 임베딩 재생성
      if (p.description && p.description !== existing.description) {
        const embeddingText = buildEmbeddingText(p);
        const embedding = await generateEmbedding(embeddingText);
        if (embedding) {
          const vectorStr = `[${embedding.join(',')}]`;
          await prisma.$executeRawUnsafe(
            `UPDATE odk_tours SET embedding = $1::vector WHERE id = $2`,
            vectorStr,
            existing.id,
          );
          stats.embeddingsUpdated++;
          console.log(`  🧠 Embedding updated: ${p.name}`);
        }
        await delay(500);
      }
    } else {
      // 신규 생성
      const region = inferRegion(p.name, p.description);
      await prisma.$executeRawUnsafe(
        `INSERT INTO odk_tours (name, slug, description, thumbnail_url, website_url, rating, review_count, category, tags, region, is_active, last_synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, now())`,
        p.name,
        p.slug,
        p.description,
        p.thumbnailUrl,
        p.url,
        p.rating,
        p.reviewCount,
        p.category,
        p.tags,
        region,
      );
      stats.created++;
      console.log(`  ✨ Created: ${p.name}`);

      // 신규 투어 임베딩 생성
      const embeddingText = buildEmbeddingText(p);
      const embedding = await generateEmbedding(embeddingText);
      if (embedding) {
        const vectorStr = `[${embedding.join(',')}]`;
        await prisma.$executeRawUnsafe(
          `UPDATE odk_tours SET embedding = $1::vector WHERE slug = $2`,
          vectorStr,
          p.slug,
        );
        stats.embeddingsUpdated++;
      }
      await delay(500);
    }
  }

  // Stale 투어 비활성화 (DB에 있지만 사이트에 없는 것)
  for (const [slug, dbTour] of dbMap) {
    if (!siteSlugSet.has(slug) && dbTour.is_active) {
      await prisma.$executeRawUnsafe(
        `UPDATE odk_tours SET is_active = false, updated_at = now() WHERE id = $1`,
        dbTour.id,
      );
      stats.deactivated++;
      console.log(`  ❌ Deactivated: ${slug}`);
    }
  }

  return stats;
}

// ============================================================================
// Embedding
// ============================================================================

function buildEmbeddingText(p: SiteProduct): string {
  const parts = [p.name];
  if (p.category) parts.push(p.category);
  const region = inferRegion(p.name, p.description);
  if (region) parts.push(region);
  if (p.description) parts.push(p.description);
  return parts.join(' | ');
}

async function generateEmbedding(text: string): Promise<number[] | null> {
  if (!GEMINI_API_KEY) return null;

  const truncated = text.length > 8000 ? text.slice(0, 8000) : text;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${EMBEDDING_URL}?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'models/gemini-embedding-001',
          content: { parts: [{ text: truncated }] },
          outputDimensionality: 768,
        }),
      });

      if (res.status === 429) {
        const wait = 2000 * Math.pow(2, attempt) + Math.random() * 1000;
        console.log(`  ⏳ Rate limited, waiting ${Math.round(wait / 1000)}s...`);
        await delay(wait);
        continue;
      }

      if (!res.ok) {
        console.error(`  ❌ Embedding API error: ${res.status}`);
        return null;
      }

      const data = await res.json();
      return data.embedding?.values || null;
    } catch (error) {
      console.error(`  ❌ Embedding error:`, error);
      return null;
    }
  }
  return null;
}

// ============================================================================
// Helpers
// ============================================================================

async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'TumakrBot/1.0 (odk-sync)' },
    });
    if (!res.ok) {
      console.warn(`  ⚠️  HTTP ${res.status} for ${url}`);
      return null;
    }
    return await res.text();
  } catch (error) {
    console.error(`  ❌ Fetch failed: ${url}`, error);
    return null;
  }
}

function inferRegion(name: string, description: string | null): string | null {
  const text = `${name} ${description || ''}`.toLowerCase();
  if (text.includes('dmz') || text.includes('korean war') || text.includes('imjingak')) return 'DMZ';
  if (text.includes('nami') || text.includes('gapyeong') || text.includes('gangchon')) return 'Gapyeong';
  if (text.includes('pocheon')) return 'Pocheon';
  if (text.includes('busan') || text.includes('jinhae')) return 'Busan';
  if (text.includes('jeju')) return 'Jeju';
  if (text.includes('gangnam') || text.includes('hallyu')) return 'Gangnam';
  if (text.includes('suwon') || text.includes('folk village')) return 'Suwon';
  if (text.includes('incheon')) return 'Incheon';
  if (text.includes('gyeongju')) return 'Gyeongju';
  if (text.includes('seorak')) return 'Seoraksan';
  if (text.includes('danyang')) return 'Danyang';
  if (text.includes('gangneung') || text.includes('east sea')) return 'Gangneung';
  if (text.includes('jeonju')) return 'Jeonju';
  if (text.includes('seoul') || text.includes('bukhansan') || text.includes('inwang')) return 'Seoul';
  return 'Seoul';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('🚀 ODK 투어 Sitemap 동기화 시작\n');

  try {
    // 1. Sitemap에서 URL 추출
    const urls = await fetchSitemapUrls();
    if (urls.length === 0) {
      console.log('⚠️  No tour URLs found in sitemap');
      return;
    }

    // 2. 각 URL 크롤링 + JSON-LD 파싱
    console.log(`\n🔍 Crawling ${urls.length} tour pages...`);
    const products = await crawlProducts(urls);
    console.log(`\n📊 Parsed ${products.length}/${urls.length} products`);

    // 3. DB 동기화
    console.log('\n💾 Syncing to database...');
    const stats = await syncToDb(products);

    // 4. 결과 요약
    console.log('\n' + '='.repeat(50));
    console.log('🎉 동기화 완료!');
    console.log(`  Updated:     ${stats.updated}`);
    console.log(`  Created:     ${stats.created}`);
    console.log(`  Deactivated: ${stats.deactivated}`);
    console.log(`  Embeddings:  ${stats.embeddingsUpdated}`);
    console.log('='.repeat(50));

    // DB 통계
    const dbStats = await prisma.$queryRawUnsafe<
      Array<{ total: bigint; active: bigint; with_rating: bigint; with_embed: bigint }>
    >(
      `SELECT
         COUNT(*)::bigint as total,
         COUNT(*) FILTER (WHERE is_active = true)::bigint as active,
         COUNT(*) FILTER (WHERE rating IS NOT NULL)::bigint as with_rating,
         COUNT(*) FILTER (WHERE embedding IS NOT NULL)::bigint as with_embed
       FROM odk_tours`,
    );
    const s = dbStats[0];
    console.log(`\n📈 DB 현황:`);
    console.log(`  전체: ${s.total} | 활성: ${s.active} | 별점: ${s.with_rating} | 임베딩: ${s.with_embed}`);
  } catch (error) {
    console.error('❌ 동기화 실패:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
