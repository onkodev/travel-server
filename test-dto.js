// 실제 서비스 로직과 동일하게 sortBy → orderBy 변환 테스트
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({ log: ['query'] }); // SQL 쿼리 로깅

async function main() {
  const sortBy = 'amount';
  const sortOrder = 'asc';
  const source = undefined; // "전체" 탭

  // 서비스 코드와 동일한 로직
  let orderBy = [{ isPinned: 'desc' }, { createdAt: 'desc' }];

  if (sortBy) {
    const dir = sortOrder === 'asc' ? 'asc' : 'desc';
    let sortConfig = null;
    switch (sortBy) {
      case 'amount': sortConfig = { totalAmount: dir }; break;
      case 'pax': sortConfig = { totalTravelers: dir }; break;
      case 'createdAt': sortConfig = { createdAt: dir }; break;
    }
    if (sortConfig) {
      orderBy = [{ isPinned: 'desc' }, sortConfig, { id: 'desc' }];
    }
  }

  console.log('orderBy:', JSON.stringify(orderBy));

  const result = await p.estimate.findMany({
    orderBy,
    take: 5,
    select: { id: true, totalAmount: true, totalTravelers: true, isPinned: true },
  });

  console.log('\nResults (amount asc):');
  result.forEach(e => console.log(`  id=${e.id} amount=${e.totalAmount} pax=${e.totalTravelers} pinned=${e.isPinned}`));

  // 비교: 기본 정렬
  const defaultResult = await p.estimate.findMany({
    orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
    take: 5,
    select: { id: true, totalAmount: true, totalTravelers: true, isPinned: true },
  });

  console.log('\nResults (default createdAt desc):');
  defaultResult.forEach(e => console.log(`  id=${e.id} amount=${e.totalAmount} pax=${e.totalTravelers} pinned=${e.isPinned}`));

  console.log('\nSame order?', JSON.stringify(result.map(e=>e.id)) === JSON.stringify(defaultResult.map(e=>e.id)));
}

main().catch(console.error).finally(() => p.$disconnect());
