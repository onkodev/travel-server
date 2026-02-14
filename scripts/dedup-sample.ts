/**
 * 임계값별 중복 품질 비교 (샘플 1000개)
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasourceUrl: process.env.DIRECT_URL || process.env.DATABASE_URL,
});

async function main() {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id FROM faqs WHERE embedding IS NOT NULL ORDER BY id LIMIT 1000`,
  );
  const ids = rows.map((r) => r.id);
  console.log(`샘플: ${ids.length}개 FAQ\n`);

  for (const th of [0.96, 0.95, 0.93, 0.90]) {
    // 배치로 나눠서 타임아웃 회피
    const allPairs: any[] = [];
    for (let i = 0; i < ids.length; i += 500) {
      const batch = ids.slice(i, i + 500);
      const pairs = await prisma.$queryRawUnsafe<any[]>(
        `SELECT f1.id as id1, f2.id as id2,
                1 - (f1.embedding <=> f2.embedding) as similarity
         FROM faqs f1
         CROSS JOIN LATERAL (
           SELECT id, embedding FROM faqs
           WHERE id > f1.id AND embedding IS NOT NULL
           ORDER BY embedding <=> f1.embedding LIMIT 5
         ) f2
         WHERE f1.id = ANY($1::int[])
           AND 1 - (f1.embedding <=> f2.embedding) >= $2`,
        batch,
        th,
      );
      allPairs.push(...pairs);
    }

    console.log(`=== 유사도 >= ${(th * 100).toFixed(0)}%: ${allPairs.length}개 페어 ===`);

    // 가장 낮은 유사도 페어 3개 (경계선 품질)
    const sorted = allPairs.sort((a, b) => Number(a.similarity) - Number(b.similarity));
    const bottom = sorted.slice(0, 3);
    const bottomIds = [...new Set(bottom.flatMap((p) => [p.id1, p.id2]))];

    if (bottomIds.length > 0) {
      const faqs = await prisma.faq.findMany({
        where: { id: { in: bottomIds } },
        select: { id: true, question: true, answer: true },
      });
      const fm = new Map(faqs.map((f) => [f.id, f]));

      for (const pair of bottom) {
        const a = fm.get(pair.id1);
        const b = fm.get(pair.id2);
        if (!a || !b) continue;
        console.log(`  ${(Number(pair.similarity) * 100).toFixed(1)}%:`);
        console.log(`    Q1: ${a.question.slice(0, 90)}`);
        console.log(`    Q2: ${b.question.slice(0, 90)}`);
      }
    }
    console.log();
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
