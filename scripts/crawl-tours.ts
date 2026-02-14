/**
 * OneDayKorea 투어 크롤링 + 임베딩 생성 스크립트
 * 실행: npx ts-node scripts/crawl-tours.ts
 *
 * 1) 카테고리 페이지 → 페이지네이션 순회 → 카드에서 기본 정보 추출
 * 2) 개별 투어 페이지 → og:image, og:description 보충
 * 3) DB upsert (slug 기준 중복 방지)
 * 4) Gemini 임베딩 생성
 */

import { PrismaClient } from '@prisma/client';
import * as cheerio from 'cheerio';

const prisma = new PrismaClient();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const EMBEDDING_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent';
const BASE_URL = 'https://onedaykorea.com';

// 카테고리 페이지 목록 (오타 포함 — 사이트 원본 URL 그대로)
const CATEGORY_PAGES = [
  '/tours/',
  '/tour-pakcages/daily-city-tour/',
  '/tour-pakcages/multi-day-tour/',
  '/tour-pakcages/seasonal-tour/',
  '/tour-pakcages/theme-tour/',
  '/tour-pakcages/other-services/',
  '/tour-pakcages/recommended-tour/',
];

// ============================================================================
// Types
// ============================================================================

interface TourData {
  name: string;
  slug: string;
  description: string | null;
  thumbnailUrl: string | null;
  websiteUrl: string;
  duration: string | null;
  region: string | null;
}

// ============================================================================
// Crawling — 카테고리 목록 페이지
// ============================================================================

/** 단일 목록 페이지에서 투어 카드 파싱 */
function parseListingPage(html: string): TourData[] {
  const $ = cheerio.load(html);
  const tours: TourData[] = [];

  $('.tour-card').each((_, card) => {
    const $card = $(card);
    const link = $card.find('a[href*="/tours/"]').first().attr('href') || '';
    const slugMatch = link.match(/\/tours\/([^/]+)\/?/);
    if (!slugMatch) return;

    const slug = slugMatch[1];
    const name = $card.find('.tour-title a, .tour-title').first().text().trim();
    if (!name) return;

    const $img = $card.find('.tour-image-area img, img').first();
    let thumb =
      $img.attr('src') ||
      $img.attr('data-src') ||
      $img.attr('data-lazy-src') ||
      $img.attr('data-original') ||
      null;
    // CSS background-image fallback
    if (!thumb) {
      const style = $card.find('.tour-image-area, .tour-image').first().attr('style') || '';
      const bgMatch = style.match(/url\(['"]?([^'")\s]+)['"]?\)/);
      if (bgMatch) thumb = bgMatch[1];
    }
    if (thumb && !thumb.startsWith('http')) thumb = `${BASE_URL}${thumb}`;

    const desc = $card.find('.tour-short-desc').text().trim() || null;
    const duration = $card.find('.tour-meta').text().trim() || null;
    const region = inferRegion(name, desc);

    tours.push({
      name,
      slug,
      description: desc,
      thumbnailUrl: thumb,
      websiteUrl: `${BASE_URL}/tours/${slug}/`,
      duration,
      region,
    });
  });

  return tours;
}

/** 페이지네이션 총 페이지 수 파악 */
function getMaxPage(html: string): number {
  const $ = cheerio.load(html);
  let max = 1;
  $('a.page-numbers').each((_, el) => {
    const text = $(el).text().trim();
    const num = parseInt(text, 10);
    if (!isNaN(num) && num > max) max = num;
  });
  return max;
}

/** 모든 카테고리 + 페이지네이션 순회하여 투어 수집 */
async function crawlAllListings(): Promise<Map<string, TourData>> {
  const tourMap = new Map<string, TourData>(); // slug → TourData (중복 방지)

  for (const categoryPath of CATEGORY_PAGES) {
    const categoryUrl = `${BASE_URL}${categoryPath}`;
    console.log(`\n📂 ${categoryPath}`);

    // 첫 페이지
    const firstHtml = await fetchPage(categoryUrl);
    if (!firstHtml) continue;

    const firstTours = parseListingPage(firstHtml);
    for (const t of firstTours) tourMap.set(t.slug, t);
    console.log(`  Page 1: ${firstTours.length} tours`);

    // 페이지네이션
    const maxPage = getMaxPage(firstHtml);
    for (let page = 2; page <= maxPage; page++) {
      const pageUrl = `${categoryUrl}?paged=${page}`;
      const html = await fetchPage(pageUrl);
      if (!html) continue;

      const tours = parseListingPage(html);
      for (const t of tours) tourMap.set(t.slug, t);
      console.log(`  Page ${page}: ${tours.length} tours`);

      await delay(300);
    }
  }

  return tourMap;
}

// ============================================================================
// Crawling — 개별 투어 페이지 (빠진 데이터 보충)
// ============================================================================

/** 개별 투어 페이지에서 og:image, description 보충 */
async function enrichTourDetail(tour: TourData): Promise<TourData> {
  // 썸네일과 설명 둘 다 있으면 스킵
  if (tour.thumbnailUrl && tour.description) return tour;

  const html = await fetchPage(tour.websiteUrl);
  if (!html) return tour;

  const $ = cheerio.load(html);

  if (!tour.thumbnailUrl) {
    // 1) og:image
    tour.thumbnailUrl =
      $('meta[property="og:image"]').attr('content') || null;

    // 2) twitter:image
    if (!tour.thumbnailUrl) {
      tour.thumbnailUrl =
        $('meta[name="twitter:image"]').attr('content') || null;
    }

    // 3) 본문 첫 번째 큰 이미지 (lazy loading 대응)
    if (!tour.thumbnailUrl) {
      const $contentImg = $('.entry-content img, .tour-content img, article img').first();
      tour.thumbnailUrl =
        $contentImg.attr('src') ||
        $contentImg.attr('data-src') ||
        $contentImg.attr('data-lazy-src') ||
        null;
    }

    // 상대 경로 보정
    if (tour.thumbnailUrl && !tour.thumbnailUrl.startsWith('http')) {
      tour.thumbnailUrl = `${BASE_URL}${tour.thumbnailUrl}`;
    }
  }

  if (!tour.description) {
    tour.description =
      $('meta[property="og:description"]').attr('content') ||
      $('meta[name="description"]').attr('content') ||
      null;
  }

  // h1에서 이름 보정
  const h1 = $('h1').first().text().trim();
  if (h1 && h1.length > tour.name.length) {
    tour.name = h1;
  }

  return tour;
}

// ============================================================================
// Helpers
// ============================================================================

async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'TumakrBot/1.0 (tour-crawl)' },
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
// DB Upsert
// ============================================================================

async function saveTours(tours: TourData[]): Promise<void> {
  console.log(`\n💾 Saving ${tours.length} tours to database...`);

  let saved = 0;
  for (const tour of tours) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO odk_tour_list (name, slug, description, thumbnail_url, website_url, duration, region, tags)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (slug) DO UPDATE SET
         name = EXCLUDED.name,
         description = COALESCE(EXCLUDED.description, odk_tour_list.description),
         thumbnail_url = COALESCE(EXCLUDED.thumbnail_url, odk_tour_list.thumbnail_url),
         website_url = EXCLUDED.website_url,
         duration = COALESCE(EXCLUDED.duration, odk_tour_list.duration),
         region = COALESCE(EXCLUDED.region, odk_tour_list.region),
         updated_at = now()`,
      tour.name,
      tour.slug,
      tour.description,
      tour.thumbnailUrl,
      tour.websiteUrl,
      tour.duration,
      tour.region,
      [],
    );
    saved++;
  }

  console.log(`✅ Upserted ${saved} tours`);
}

// ============================================================================
// Embedding
// ============================================================================

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

async function generateAllEmbeddings(): Promise<void> {
  if (!GEMINI_API_KEY) {
    console.log('\n⚠️  GEMINI_API_KEY not set, skipping embeddings');
    return;
  }

  console.log('\n🧠 Generating embeddings...');

  const tours = await prisma.$queryRawUnsafe<
    Array<{
      id: number;
      name: string;
      description: string | null;
      region: string | null;
      duration: string | null;
    }>
  >(
    `SELECT id, name, description, region, duration
     FROM odk_tour_list
     WHERE is_active = true AND embedding IS NULL`,
  );

  console.log(`  Found ${tours.length} tours without embeddings`);

  let success = 0;
  for (const tour of tours) {
    const text = `Tour: ${tour.name}. ${tour.description || ''}. Region: ${tour.region || 'Seoul'}. Duration: ${tour.duration || 'Full day'}`;
    const embedding = await generateEmbedding(text);

    if (embedding) {
      const vectorStr = `[${embedding.join(',')}]`;
      await prisma.$executeRawUnsafe(
        `UPDATE odk_tour_list SET embedding = $1::vector WHERE id = $2`,
        vectorStr,
        tour.id,
      );
      success++;
      console.log(`  ✓ ${tour.name}`);
    } else {
      console.log(`  ✗ Failed: ${tour.name}`);
    }

    await delay(1000);
  }

  console.log(`✅ Generated ${success}/${tours.length} embeddings`);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('🚀 OneDayKorea 투어 크롤링 시작\n');

  try {
    // Step 1: 카테고리 페이지 순회 (목록에서 카드 파싱)
    const tourMap = await crawlAllListings();
    console.log(`\n📊 목록에서 수집된 고유 투어: ${tourMap.size}개`);

    // Step 2: 빠진 데이터 보충 (개별 페이지 og:image/description)
    console.log('\n🔍 개별 페이지에서 상세 정보 보충 중...');
    const tours: TourData[] = [];
    let enriched = 0;
    for (const [, tour] of tourMap) {
      if (!tour.thumbnailUrl || !tour.description) {
        const enrichedTour = await enrichTourDetail(tour);
        tours.push(enrichedTour);
        enriched++;
        await delay(300);
      } else {
        tours.push(tour);
      }
    }
    console.log(`  ${enriched}개 투어 상세 보충 완료`);

    // Step 2.5: DB에서 여전히 thumbnail_url이 NULL인 투어 재보충
    const nullThumbTours = await prisma.$queryRawUnsafe<
      Array<{ slug: string; website_url: string; name: string }>
    >(
      `SELECT slug, website_url, name FROM odk_tour_list
       WHERE is_active = true AND thumbnail_url IS NULL`,
    );
    if (nullThumbTours.length > 0) {
      console.log(`\n🔄 DB에서 썸네일 없는 투어 ${nullThumbTours.length}개 재보충 중...`);
      for (const row of nullThumbTours) {
        const tour: TourData = {
          name: row.name,
          slug: row.slug,
          description: null,
          thumbnailUrl: null,
          websiteUrl: row.website_url,
          duration: null,
          region: null,
        };
        const enrichedTour = await enrichTourDetail(tour);
        if (enrichedTour.thumbnailUrl) {
          await prisma.$executeRawUnsafe(
            `UPDATE odk_tour_list SET thumbnail_url = $1, updated_at = now() WHERE slug = $2`,
            enrichedTour.thumbnailUrl,
            row.slug,
          );
          console.log(`  ✓ ${row.name}: ${enrichedTour.thumbnailUrl}`);
        } else {
          console.log(`  ✗ ${row.name}: 여전히 썸네일 없음`);
        }
        await delay(300);
      }
    }

    // Step 3: DB 저장
    await saveTours(tours);

    // Step 4: 임베딩 생성
    await generateAllEmbeddings();

    // Summary
    const stats = await prisma.$queryRawUnsafe<
      Array<{ total: bigint; with_thumb: bigint; with_desc: bigint; with_embed: bigint }>
    >(
      `SELECT
         COUNT(*)::bigint as total,
         COUNT(thumbnail_url)::bigint as with_thumb,
         COUNT(description)::bigint as with_desc,
         COUNT(embedding)::bigint as with_embed
       FROM odk_tour_list
       WHERE is_active = true`,
    );
    const s = stats[0];
    console.log(`\n🎉 완료!`);
    console.log(`  총 투어: ${s.total}개`);
    console.log(`  썸네일: ${s.with_thumb}개`);
    console.log(`  설명: ${s.with_desc}개`);
    console.log(`  임베딩: ${s.with_embed}개`);
  } catch (error) {
    console.error('❌ 크롤링 실패:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
