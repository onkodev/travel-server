/**
 * FAQ 중복 정리 스크립트
 * 임베딩 코사인 유사도 >= 0.97 인 FAQ 그룹을 찾아서, 그룹 당 하나만 남기고 삭제
 *
 * 우선순위: approved > pending > rejected, confidence 높은 순, id 낮은 순
 *
 * 실행: npx ts-node scripts/dedup-faqs.ts
 * 드라이런: npx ts-node scripts/dedup-faqs.ts --dry-run
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasourceUrl: process.env.DIRECT_URL || process.env.DATABASE_URL,
});

const SIMILARITY_THRESHOLD = 0.95;
const BATCH_SIZE = 500;
const DRY_RUN = process.argv.includes('--dry-run');
const SCAN_LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '0') || 0;

async function main() {
  console.log(`\n=== FAQ 중복 정리 스크립트 ===`);
  console.log(`유사도 임계값: ${SIMILARITY_THRESHOLD}`);
  console.log(`모드: ${DRY_RUN ? '드라이런 (삭제 안함)' : '실제 삭제'}`);
  if (SCAN_LIMIT) console.log(`스캔 제한: ${SCAN_LIMIT}개`);
  console.log();

  // 1. 임베딩이 있는 FAQ ID 조회
  const embeddedRows = await prisma.$queryRawUnsafe<Array<{ id: number }>>(
    `SELECT id FROM faqs
     WHERE embedding IS NOT NULL
     ORDER BY id
     ${SCAN_LIMIT ? `LIMIT ${SCAN_LIMIT}` : ''}`,
  );
  console.log(`임베딩 보유 FAQ 수: ${embeddedRows.length}`);

  // 2. 배치별로 유사 페어 탐색
  const pairs: Array<{ id1: number; id2: number; similarity: number }> = [];

  for (let i = 0; i < embeddedRows.length; i += BATCH_SIZE) {
    const batchIds = embeddedRows.slice(i, i + BATCH_SIZE).map((r) => r.id);
    const batchEnd = Math.min(i + BATCH_SIZE, embeddedRows.length);
    process.stdout.write(`  배치 ${i + 1}~${batchEnd} / ${embeddedRows.length} 처리 중...`);

    const batchPairs = await prisma.$queryRawUnsafe<
      Array<{ id1: number; id2: number; similarity: number }>
    >(
      `SELECT f1.id as id1, f2.id as id2,
              1 - (f1.embedding <=> f2.embedding) as similarity
       FROM faqs f1
       CROSS JOIN LATERAL (
         SELECT id, embedding
         FROM faqs
         WHERE id > f1.id
           AND embedding IS NOT NULL
         ORDER BY embedding <=> f1.embedding
         LIMIT 5
       ) f2
       WHERE f1.id = ANY($1::int[])
         AND 1 - (f1.embedding <=> f2.embedding) >= $2`,
      batchIds,
      SIMILARITY_THRESHOLD,
    );

    pairs.push(...batchPairs);
    console.log(` ${batchPairs.length}개 페어 발견`);
  }

  console.log(`\n총 유사 페어: ${pairs.length}개`);

  if (pairs.length === 0) {
    console.log('중복 없음. 종료.');
    return;
  }

  // 3. Union-Find로 그룹 클러스터링
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    if (!parent.has(x)) parent.set(x, x);
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
    return parent.get(x)!;
  };
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const { id1, id2 } of pairs) {
    union(id1, id2);
  }

  // 그룹별 ID 수집 + 최대 유사도
  const groupMap = new Map<number, Set<number>>();
  const groupSim = new Map<number, number>();
  for (const { id1, id2, similarity } of pairs) {
    const root = find(id1);
    if (!groupMap.has(root)) groupMap.set(root, new Set());
    groupMap.get(root)!.add(id1).add(id2);
    groupSim.set(root, Math.max(groupSim.get(root) || 0, Number(similarity)));
  }

  const groups = [...groupMap.entries()]
    .map(([root, ids]) => ({ ids: [...ids], maxSim: groupSim.get(root) || 0 }))
    .filter((g) => g.ids.length >= 2)
    .sort((a, b) => b.maxSim - a.maxSim);

  console.log(`중복 그룹 수: ${groups.length}개\n`);

  // 4. 각 그룹에서 보존할 FAQ 선택, 나머지 삭제 대상
  const allIds = groups.flatMap((g) => g.ids);
  const faqDetails = await prisma.faq.findMany({
    where: { id: { in: allIds } },
    select: {
      id: true,
      question: true,
      answer: true,
      status: true,
      confidence: true,
      source: true,
    },
  });
  const faqMap = new Map(faqDetails.map((f) => [f.id, f]));

  const statusPriority: Record<string, number> = {
    approved: 3,
    pending: 2,
    rejected: 1,
  };

  const idsToDelete: number[] = [];
  let keptCount = 0;

  for (const { ids: groupIds, maxSim } of groups) {
    const faqs = groupIds
      .map((id) => faqMap.get(id))
      .filter(Boolean)
      .sort((a, b) => {
        // 1. approved > pending > rejected
        const sPri = (statusPriority[b!.status] || 0) - (statusPriority[a!.status] || 0);
        if (sPri !== 0) return sPri;
        // 2. confidence 높은 순
        const confA = a!.confidence ? Number(a!.confidence) : 0;
        const confB = b!.confidence ? Number(b!.confidence) : 0;
        if (confB !== confA) return confB - confA;
        // 3. id 낮은 순 (오래된 것 유지)
        return a!.id - b!.id;
      });

    if (faqs.length === 0) continue;

    const keep = faqs[0]!;
    const deleteIds = faqs.slice(1).map((f) => f!.id);
    idsToDelete.push(...deleteIds);
    keptCount++;

    console.log(`\n── 그룹 #${keptCount} (${faqs.length}개 FAQ, 유사도 ${(maxSim * 100).toFixed(1)}%) ──`);
    console.log(`  ✅ 보존: id=${keep.id} [${keep.status}]`);
    console.log(`     Q: ${keep.question.slice(0, 80)}`);
    console.log(`     A: ${keep.answer.slice(0, 80)}`);
    for (const del of faqs.slice(1)) {
      console.log(`  ❌ 삭제: id=${del!.id} [${del!.status}]`);
      console.log(`     Q: ${del!.question.slice(0, 80)}`);
      console.log(`     A: ${del!.answer.slice(0, 80)}`);
    }
  }

  console.log(`\n=== 요약 ===`);
  console.log(`  중복 그룹: ${groups.length}개`);
  console.log(`  보존: ${keptCount}개`);
  console.log(`  삭제 대상: ${idsToDelete.length}개`);

  // 5. 삭제 실행
  if (DRY_RUN) {
    console.log(`\n[드라이런] 삭제를 실행하지 않았습니다.`);
  } else if (idsToDelete.length > 0) {
    console.log(`\n삭제 실행 중...`);

    // 500개씩 배치 삭제
    let deleted = 0;
    for (let i = 0; i < idsToDelete.length; i += 500) {
      const batch = idsToDelete.slice(i, i + 500);
      const result = await prisma.faq.deleteMany({
        where: { id: { in: batch } },
      });
      deleted += result.count;
      console.log(`  ${deleted} / ${idsToDelete.length} 삭제 완료`);
    }

    console.log(`\n삭제 완료: ${deleted}건`);
  } else {
    console.log('\n삭제할 항목이 없습니다.');
  }

  // 6. 최종 통계
  const remaining = await prisma.faq.count();
  console.log(`\n남은 FAQ 수: ${remaining}개\n`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
